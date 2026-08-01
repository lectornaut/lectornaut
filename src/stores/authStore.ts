/**
 * Auth Store — authentication, user profile, and selection preferences.
 *
 * Responsibilities:
 * - Surface the VueFire auth user and its readiness signal.
 * - Read/write the user-account profile doc (optimistic, via Cloud Function).
 * - Own the two pieces of selection state the rest of the app keys off:
 *     • `currentTeamId`     — user-scoped preference (users/{uid}/settings/preferences)
 *     • `currentWorkspaceId` — membership-scoped preference, per team
 *       (teams/{teamId}/memberships/{uid}/settings/preferences)
 *
 * Reads flow through TanStack Query (onSnapshot-backed); selection writes flow
 * through the offline-durable sync engine. A thin Pinia overlay sits in front of
 * each preference doc so a selection paints instantly and survives reload.
 */

import { updateOwnUserProfile as updateOwnUserProfileFn } from "@/composables/useFunctions"
import { queryClient } from "@/modules/queryClient"
import { clearPersistedQueryCache } from "@/modules/queryPersister"
import { syncCurrentUserAccountProfile } from "@/queries/userSettings"
import {
  membershipPreferencesHydrationSchema,
  userPreferencesHydrationSchema,
} from "@/schemas/domain"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamStore } from "@/stores/teamStore"
import type {
  IMembershipPreferences,
  IUser,
  IUserPreferences,
  IUserProfile,
} from "@/types/domain"
import { isUserMembership } from "@/types/membership"
import {
  getMembershipPreferencesRef,
  getUserPreferencesRef,
  getUserRef,
  uploadUserPhoto,
} from "@/utils/firebase/firebase-helpers"
import {
  clearHydrationCache,
  readHydrationCache,
  useLocalHydration,
  writeHydrationCache,
} from "@/utils/firebase/firebase-hydration"
import { useRunWrite } from "@/utils/firebase/firebase-mutation"
import {
  addPending,
  cloneState,
  createPendingSet,
  removePending,
} from "@/utils/firebase/firebase-optimistic"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { queryKeys } from "@/utils/firebase/firebase-query-keys"
import {
  buildUpdatedAtBaseVersion,
  mutate,
} from "@/utils/firebase/firebase-sync-engine"
import type { User } from "firebase/auth"
import { Timestamp } from "firebase/firestore"
import { defineStore } from "pinia"
import { toast } from "vue-sonner"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

// ── Default preference shapes ────────────────────────────────────────────────

const emptyUserPreferences = (): IUserPreferences => ({
  currentTeamId: null,
  onboarding: false,
})

const emptyMembershipPreferences = (): IMembershipPreferences => ({
  currentWorkspaceId: null,
})

/** localStorage cache key for a team's membership-preferences snapshot. */
const membershipPrefsCacheKey = (teamId: string) =>
  `membershipPreferences:${teamId}`

// ── Last-click-wins selection bookkeeping (pure, unit-tested) ────────────────

/**
 * Bookkeeping for serialized selection writes where the overlay is applied
 * synchronously per request (last-click-wins) and only the DURABLE writes are
 * chained behind each other.
 *
 * Rules:
 * - Only the latest request's write runs (`shouldWrite`); superseded slots
 *   settle as skipped — no write, no rollback.
 * - The rollback baseline is the state before the FIRST request of a run (the
 *   last known durable state), captured on `begin` while idle. Later requests
 *   in the same run never re-baseline: their overlays were never persisted,
 *   so restoring one would disagree with server state.
 * - A superseded write that was already in flight and SUCCEEDED re-baselines
 *   to its persisted state — the durable doc advanced, so a later failure
 *   must restore that, not the pre-run state.
 * - `settleFailure` returns the baseline to restore only when the failed
 *   request is still the latest; otherwise `null` — a newer overlay has been
 *   applied since and must never be clobbered by an older rollback.
 */
export interface SelectionWriteController<TSnapshot> {
  /** Register the new latest request; returns its id. */
  begin(snapshot: TSnapshot): number
  /** Whether this request is still the latest — its durable write should run. */
  shouldWrite(requestId: number): boolean
  /** Settle a superseded (or torn-down) slot that wrote nothing. */
  settleSkipped(requestId: number): void
  /** Settle a successful durable write of `persistedSnapshot`'s state. */
  settleSuccess(requestId: number, persistedSnapshot: TSnapshot): void
  /** Settle a failed write; returns the snapshot to restore, or null. */
  settleFailure(requestId: number): TSnapshot | null
  /** True once every request of the current run has settled. */
  isIdle(): boolean
}

export function createSelectionWriteController<
  TSnapshot,
>(): SelectionWriteController<TSnapshot> {
  let nextRequestId = 0
  let latestRequestId = 0
  let outstanding = 0
  // Boxed so a legitimately-falsy TSnapshot stays distinguishable from "unset".
  let baseline: { value: TSnapshot } | null = null

  return {
    begin(snapshot) {
      const requestId = ++nextRequestId
      latestRequestId = requestId
      if (outstanding === 0) baseline = { value: snapshot }
      outstanding++
      return requestId
    },
    shouldWrite(requestId) {
      return requestId === latestRequestId
    },
    settleSkipped() {
      outstanding = Math.max(0, outstanding - 1)
      // A drain via skip (teardown of the latest) leaves nothing to restore.
      if (outstanding === 0) baseline = null
    },
    settleSuccess(requestId, persistedSnapshot) {
      outstanding = Math.max(0, outstanding - 1)
      if (requestId === latestRequestId || outstanding === 0) {
        // Durable state now matches the latest overlay — run complete.
        baseline = null
      } else {
        // A superseded in-flight write landed: the durable doc advanced past
        // the pre-run baseline.
        baseline = { value: persistedSnapshot }
      }
    },
    settleFailure(requestId) {
      outstanding = Math.max(0, outstanding - 1)
      if (requestId !== latestRequestId) return null
      const restore = baseline ? baseline.value : null
      baseline = null
      return restore
    },
    isIdle() {
      return outstanding === 0
    },
  }
}

/**
 * A server `failed-precondition` rejection of a sync write — the OCC
 * base-version conflict verdict. The sync engine stamps the verdict code
 * onto the rejection error (see `applyRemoteSettlement`), so this is a
 * structural check, never message matching. Used as the self-correction
 * trigger for the cached ack stamp: a conflict means the cached token
 * disagreed with the doc (e.g. a skewed-high millis from an old-server
 * settlement), so the cache must be dropped in favor of the live listener.
 */
export function isFailedPreconditionRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "failed-precondition"
  )
}

/**
 * Freshest-of selection for an OCC token: epoch-ms candidates from a write
 * ack and the live listener; the largest finite number wins (per-doc
 * `updatedAt` stamps are monotonic across settlements). Non-numeric
 * candidates (absent doc, an old-server ack without millis) are ignored.
 */
export function selectFreshestUpdatedAtMillis(
  candidates: ReadonlyArray<number | string | null | undefined>
): number | null {
  let freshest: number | null = null
  for (const candidate of candidates) {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue
    if (freshest === null || candidate > freshest) freshest = candidate
  }
  return freshest
}

export const useAuthStore = defineStore("auth", () => {
  // ── Auth user (tri-state) ──────────────────────────────────────────────────
  // VueFire's currentUser is undefined while the persisted session restores,
  // null once confirmed signed-out, and User when signed in. The cast collapses
  // undefined→null for ergonomics only; `isCurrentUserLoaded` is the real
  // "auth has resolved" signal and is what we gate teardown / loading on so the
  // restoration window is never mistaken for a sign-out.
  const currentUser = useCurrentUser() as Ref<User | null>
  const isCurrentUserLoaded = useIsCurrentUserLoaded()

  // ── User profile doc ────────────────────────────────────────────────────────
  const userDocRef = computed(() =>
    currentUser.value ? getUserRef(currentUser.value.uid) : null
  )
  const userQuery = useDocumentQuery<IUser>(userDocRef)
  const firestoreUserProfile = computed(() => userQuery.data.value)
  const isUserProfileLoading = computed(() => userQuery.isLoading.value)

  // Profile is read straight from the realtime cache; updateUserProfile writes
  // its optimistic value into that same cache (held until the server ack).
  const userProfile = computed(() => firestoreUserProfile.value ?? null)

  // ── User preferences doc (carries currentTeamId + onboarding) ───────────────
  const userPreferencesDocRef = computed(() =>
    currentUser.value ? getUserPreferencesRef(currentUser.value.uid) : null
  )
  const userPreferencesQuery = useDocumentQuery<IUserPreferences>(
    userPreferencesDocRef
  )
  const firestoreUserPreferences = computed(
    () => userPreferencesQuery.data.value
  )
  const isUserPreferencesLoading = computed(
    () => userPreferencesQuery.isLoading.value
  )

  // Pinia overlays in front of the preference docs. They win only while a
  // selection mutation is in flight (tracked in pendingUserIds); otherwise
  // Firestore (incl. the surviving read-cache) is authoritative.
  const overlayUserPreferences = ref<IUserPreferences | null>(null)
  const overlayMembershipPreferences = ref<IMembershipPreferences | null>(null)
  // The team whose membership-preferences a live snapshot has confirmed. Drives
  // the bootstrap gate (`hasResolvedCurrentWorkspaceSelection`).
  const confirmedMembershipPrefsTeamId = ref<string | null>(null)

  const pendingUserIds = shallowRef(createPendingSet())
  const hasPendingForCurrentUser = () =>
    !!currentUser.value && pendingUserIds.value.has(currentUser.value.uid)

  const userPreferences = computed<IUserPreferences>({
    get: () => {
      // Mutation in flight → trust the overlay first; otherwise Firestore wins.
      if (hasPendingForCurrentUser()) {
        return (
          overlayUserPreferences.value ??
          firestoreUserPreferences.value ??
          emptyUserPreferences()
        )
      }
      return (
        firestoreUserPreferences.value ??
        overlayUserPreferences.value ??
        emptyUserPreferences()
      )
    },
    set: (value) => {
      overlayUserPreferences.value = value
    },
  })

  const currentTeamId = computed(
    () => userPreferences.value.currentTeamId ?? null
  )
  const onboarding = computed(() => userPreferences.value.onboarding ?? false)

  // ── Membership preferences doc (carries currentWorkspaceId, per team) ───────
  const membershipPreferencesDocRef = computed(() => {
    const uid = currentUser.value?.uid
    const teamId = currentTeamId.value
    return uid && teamId ? getMembershipPreferencesRef(teamId, uid) : null
  })
  const membershipPreferencesQuery = useDocumentQuery<IMembershipPreferences>(
    membershipPreferencesDocRef
  )
  const firestoreMembershipPreferences = computed(
    () => membershipPreferencesQuery.data.value
  )
  const isMembershipPreferencesLoading = computed(
    () => membershipPreferencesQuery.isLoading.value
  )
  // A terminal read error leaves data undefined with isLoading false — it must
  // be treated as a definitive (unhappy) answer so the bootstrap gate releases
  // instead of spinning forever.
  const isMembershipPreferencesError = computed(
    () => membershipPreferencesQuery.isError.value
  )
  // True while serving cache restored from localStorage that a live snapshot
  // hasn't reconfirmed. Stale data is non-null (passes `??`) but may be behind
  // the user's latest selection, so we must not treat it as authoritative.
  const isMembershipPreferencesStale = computed(
    () => membershipPreferencesQuery.isStale.value
  )

  const membershipPreferences = computed<IMembershipPreferences>({
    get: () => {
      // Overlay-first while a mutation is pending OR while the cache is stale —
      // in both cases the overlay reflects the most recent local selection,
      // which is more trustworthy than a stale/older cached value. Once a live
      // snapshot lands (no longer stale, no pending), Firestore wins.
      const overlayFirst =
        hasPendingForCurrentUser() || isMembershipPreferencesStale.value
      if (overlayFirst) {
        return (
          overlayMembershipPreferences.value ??
          firestoreMembershipPreferences.value ??
          emptyMembershipPreferences()
        )
      }
      return (
        firestoreMembershipPreferences.value ??
        overlayMembershipPreferences.value ??
        emptyMembershipPreferences()
      )
    },
    set: (value) => {
      overlayMembershipPreferences.value = value
    },
  })

  const currentWorkspaceId = computed(
    () => membershipPreferences.value.currentWorkspaceId ?? null
  )

  // Seed the membership-preferences overlay from localStorage so a team switch
  // paints the prior workspace instantly instead of flashing the app spinner.
  // The bootstrap gate is intentionally NOT released here — only a live
  // Firestore snapshot (the watch below) is allowed to confirm the selection,
  // since a cache from another device can disagree.
  const hydrateMembershipPrefsForTeam = (teamId: string | null) => {
    if (!teamId) {
      overlayMembershipPreferences.value = null
      confirmedMembershipPrefsTeamId.value = null
      return
    }
    const cached = readHydrationCache<IMembershipPreferences>(
      membershipPrefsCacheKey(teamId),
      {
        schema: membershipPreferencesHydrationSchema,
        context: `hydration:${membershipPrefsCacheKey(teamId)}`,
      }
    )
    overlayMembershipPreferences.value = cached ?? emptyMembershipPreferences()
  }

  const persistMembershipPrefsForTeam = (
    teamId: string | null,
    value: IMembershipPreferences | null
  ) => {
    if (!teamId) return
    writeHydrationCache(
      membershipPrefsCacheKey(teamId),
      value ?? emptyMembershipPreferences()
    )
  }

  // User preferences cold-start hydration is handled here (the doc lives behind
  // the still-Pinia-overlaid preference, not the persisted query cache).
  useLocalHydration(
    "userPreferences",
    overlayUserPreferences,
    () => userPreferences.value,
    { schema: userPreferencesHydrationSchema }
  )

  const hasResolvedCurrentWorkspaceSelection = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return true
    return confirmedMembershipPrefsTeamId.value === teamId
  })

  // ── Aggregate loading / pending / auth flags ────────────────────────────────
  // The auth-restoration window counts as loading, not signed-out, so the shell
  // doesn't flash landing right after login.
  const isLoading = computed(
    () =>
      !isCurrentUserLoaded.value ||
      ((isUserProfileLoading.value || isUserPreferencesLoading.value) &&
        !userProfile.value)
  )

  const isUserPending = computed(
    () => (id: string) => pendingUserIds.value.has(id)
  )
  const hasAnyPendingOperation = computed(() => pendingUserIds.value.size > 0)
  const isAuthenticated = computed(() => !!currentUser.value)

  // ── Profile mutation (optimistic, cache-held) ───────────────────────────────
  const runWrite = useRunWrite("auth.updateUserProfile")

  // ── Profile auto-provision ──────────────────────────────────────────────────
  // First sign-in with no profile doc → seed a default into the cache for an
  // instant paint, then create it server-side. Guard on `undefined` (no snapshot
  // yet) so the immediate watch fire doesn't "create" an existing profile.
  watch(
    [currentUser, firestoreUserProfile, isUserProfileLoading],
    async ([user, profile, loading]) => {
      if (!user || loading || profile === undefined || profile) return
      try {
        const now = Timestamp.now()
        const seeded: IUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          username: null,
          isPublic: false,
          createdAt: now,
          updatedAt: now,
        }
        queryClient.setQueryData(
          queryKeys.doc(getUserRef(user.uid).path),
          seeded
        )
        await syncCurrentUserAccountProfile()
      } catch (error) {
        console.error("[authStore] Failed to create user profile:", error)
        toast.error("Failed to create user profile. Please try again.")
      }
    },
    { immediate: true }
  )

  // Reconcile the user-preferences overlay from Firestore when idle (not
  // mid-mutation). `if (preferences)` only — a confirmed-missing doc must not
  // clobber the hydrated overlay.
  watch(
    firestoreUserPreferences,
    (preferences) => {
      if (preferences && !hasPendingForCurrentUser()) {
        overlayUserPreferences.value = preferences
      }
    },
    { immediate: true }
  )

  // Reconcile the membership-preferences overlay + mark the bootstrap gate.
  watch(
    [
      currentTeamId,
      firestoreMembershipPreferences,
      isMembershipPreferencesLoading,
      isMembershipPreferencesError,
      isMembershipPreferencesStale,
    ],
    ([teamId, preferences, loading, errored, stale]) => {
      if (!currentUser.value || !teamId || loading) return
      // undefined = still loading, EXCEPT when errored (a terminal failure is a
      // definitive answer that must release the gate, not spin forever).
      if (preferences === undefined && !errored) return
      // Don't act on stale cache — it could clobber a newer local selection and
      // its localStorage seed. The error escape hatch still applies.
      if (stale && !errored) return

      // Only a present value overwrites the overlay; a confirmed `null` leaves
      // the hydrated overlay intact (mirrors the team-selection path). The gate
      // is marked either way — an absent doc is still a definitive answer.
      if (preferences) {
        overlayMembershipPreferences.value = preferences
        persistMembershipPrefsForTeam(teamId, preferences)
      }
      confirmedMembershipPrefsTeamId.value = teamId
    },
    { immediate: true }
  )

  // Re-seed the membership-preferences overlay whenever the active team changes.
  watch(
    currentTeamId,
    (teamId, previousTeamId) => {
      if (teamId === previousTeamId && previousTeamId !== undefined) return
      hydrateMembershipPrefsForTeam(teamId)
    },
    { immediate: true }
  )

  // ── Teardown ────────────────────────────────────────────────────────────────
  function cleanup() {
    overlayUserPreferences.value = null
    overlayMembershipPreferences.value = null
    confirmedMembershipPrefsTeamId.value = null
    ackedPreferencesUpdatedAtMillis = null
    clearHydrationCache()
    void clearPersistedQueryCache()
  }

  // Only tear down on a CONFIRMED sign-out — never during the auth-restoration
  // window (undefined), which would wipe the cache mid-bootstrap.
  watch(currentUser, () => {
    if (isCurrentUserLoaded.value && !currentUser.value) {
      cleanup()
    }
  })

  // ── Selection writes ────────────────────────────────────────────────────────
  // Last-click-wins team switching: the overlay for the LATEST requested team
  // applies synchronously, so a rapid switch never waits behind the previous
  // switch's server round trip. `teamSelectionChain` serializes only the
  // DURABLE writes; superseded targets are skipped outright (no write, no
  // rollback), and a failed write rolls back only when no newer target was
  // applied since — bookkeeping on `createSelectionWriteController` (pure).
  let teamSelectionChain: Promise<void> = Promise.resolve()
  const teamSelectionWrites = createSelectionWriteController<IUserPreferences>()

  // Post-settlement `updatedAt` of the preferences doc, taken from write acks.
  // The ack resolves before the canonical snapshot lands, so the listener-
  // cached value lags — a chained second switch would otherwise re-send the
  // pre-write OCC token and trip a false failed-precondition conflict.
  let ackedPreferencesUpdatedAtMillis: number | null = null

  // Mirrors firebase-mutation's PENDING_RELEASE_DELAY_MS. `pendingUserIds` is
  // a Set, not a refcount: only the CURRENT selection generation may remove
  // its uid, and only after every request in that generation has settled.
  // Otherwise a skipped earlier click clears the guard while the newest write
  // is still in flight, letting a stale listener snapshot replace its overlay.
  const TEAM_SELECTION_PENDING_RELEASE_MS = 120
  let teamSelectionPendingGeneration = 0
  const releaseTeamSelectionPending = (uid: string, generation: number) => {
    setTimeout(() => {
      if (
        generation !== teamSelectionPendingGeneration ||
        !teamSelectionWrites.isIdle() ||
        (currentUser.value !== null && currentUser.value.uid !== uid)
      ) {
        return
      }
      removePending(pendingUserIds, uid)
    }, TEAM_SELECTION_PENDING_RELEASE_MS)
  }

  function setCurrentTeamIdLocal(teamId: string | null): void {
    if (!currentUser.value) return
    overlayUserPreferences.value = {
      ...(userPreferences.value ?? emptyUserPreferences()),
      currentTeamId: teamId,
    }
    hydrateMembershipPrefsForTeam(teamId)
  }

  async function setCurrentTeamId(teamId: string | null): Promise<void> {
    if (!currentUser.value) return
    // Identity short-circuit ONLY while idle: `currentTeamId` reads the
    // optimistic overlay, so mid-flight it already shows the pending target —
    // dropping a re-click of that target here would lose the user's intent
    // when the in-flight write then fails and rolls back to the OLD team.
    // While a write is outstanding, register the re-click as a fresh request
    // so last-click-wins converges on it.
    if (currentTeamId.value === teamId && teamSelectionWrites.isIdle()) return

    const uid = currentUser.value.uid
    const previous = cloneState(userPreferences.value)
    const requestId = teamSelectionWrites.begin(previous)
    const pendingGeneration = ++teamSelectionPendingGeneration
    // Paint the latest target NOW — the pending flag makes the overlay
    // authoritative until the durable write settles.
    addPending(pendingUserIds, uid)
    setCurrentTeamIdLocal(teamId)

    teamSelectionChain = teamSelectionChain
      .catch(() => undefined)
      .then(async () => {
        // Superseded by a newer switch (or torn down mid-queue) → skip: the
        // newest request owns both the overlay and the durable write.
        if (
          !teamSelectionWrites.shouldWrite(requestId) ||
          currentUser.value?.uid !== uid
        ) {
          teamSelectionWrites.settleSkipped(requestId)
          releaseTeamSelectionPending(uid, pendingGeneration)
          return
        }

        try {
          await runWrite({
            keys: [],
            // Overlay + pending flag were applied synchronously at request
            // time; rollback is conditional (last-click-wins) — handled below.
            apply: () => {},
            rollback: () => {},
            fn: async () => {
              const result = await mutate({
                source: "auth.setCurrentTeamId",
                targetPath: getUserPreferencesRef(uid).path,
                type: "set",
                data: { currentTeamId: teamId },
                merge: true,
                // Freshest known token wins: the last ack's post-settlement
                // stamp vs. the live listener (which may carry a NEWER stamp
                // from another device or an unrelated merge write).
                baseVersion: buildUpdatedAtBaseVersion(
                  selectFreshestUpdatedAtMillis([
                    buildUpdatedAtBaseVersion(
                      firestoreUserPreferences.value?.updatedAt ??
                        previous.updatedAt
                    )?.value,
                    ackedPreferencesUpdatedAtMillis,
                  ])
                ),
              })
              // Refresh the cached token from the ack so the next chained
              // switch carries a current baseVersion (absent on old-server
              // verdicts — the listener value covers those).
              ackedPreferencesUpdatedAtMillis = selectFreshestUpdatedAtMillis([
                ackedPreferencesUpdatedAtMillis,
                result.updatedAtMillis,
              ])
            },
            source: "auth.setCurrentTeamId",
          })
          teamSelectionWrites.settleSuccess(requestId, {
            ...previous,
            currentTeamId: teamId,
          })
        } catch (error) {
          // Self-correction for a wedged OCC token: a failed-precondition
          // verdict means the cached ack stamp disagreed with the doc, so
          // drop it — the next attempt trusts the live listener value
          // instead of max()-picking the bad cache forever.
          if (isFailedPreconditionRejection(error)) {
            ackedPreferencesUpdatedAtMillis = null
          }
          const restore = teamSelectionWrites.settleFailure(requestId)
          // Restore only when no newer overlay was applied since, and never
          // across a user change (cleanup already reset the overlays).
          if (restore && currentUser.value?.uid === uid) {
            overlayUserPreferences.value = restore
          }
          throw error
        } finally {
          releaseTeamSelectionPending(uid, pendingGeneration)
        }
      })

    return teamSelectionChain
  }

  // Local-only workspace selection write. The cache + bootstrap gate are updated
  // synchronously; the durable write rides along in workspaceStore.switchWorkspace.
  function setCurrentWorkspaceId(workspaceId: string | null): void {
    if (!currentUser.value) return
    overlayMembershipPreferences.value = {
      ...(membershipPreferences.value ?? emptyMembershipPreferences()),
      currentWorkspaceId: workspaceId,
    }
    confirmedMembershipPrefsTeamId.value = currentTeamId.value
    persistMembershipPrefsForTeam(
      currentTeamId.value,
      overlayMembershipPreferences.value
    )
  }

  // ── Profile editing ─────────────────────────────────────────────────────────
  async function updateUserProfile(
    updates: Partial<IUserProfile>
  ): Promise<void> {
    const user = currentUser.value
    const baseProfile = userProfile.value
    if (!user || !baseProfile) return

    const { displayName, photoURL } = updates
    // Empty string is the legacy "clear" signal — normalize to null.
    const normalizedPhotoURL =
      photoURL === "" || photoURL === null ? null : photoURL

    // Send only touched keys; the server treats absent keys as "leave as-is".
    // displayName is dropped when not a string (the callable rejects null).
    const payload: { displayName?: string; photoURL?: string | null } = {}
    if (typeof displayName === "string") payload.displayName = displayName
    if (photoURL !== undefined) payload.photoURL = normalizedPhotoURL
    if (Object.keys(payload).length === 0) return

    const key = queryKeys.doc(getUserRef(user.uid).path)
    const previous = queryClient.getQueryData<IUser>(key)
    const optimistic: IUser = {
      ...baseProfile,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
    }

    await runWrite({
      keys: [key],
      apply: () => queryClient.setQueryData(key, optimistic),
      rollback: () => queryClient.setQueryData(key, previous),
      fn: async () => {
        await updateOwnUserProfileFn(payload)
      },
      pending: { ref: pendingUserIds, ids: [user.uid] },
    })
  }

  async function uploadProfilePhoto(file: File): Promise<string> {
    if (!currentUser.value) throw new Error("Not authenticated")
    return uploadUserPhoto(currentUser.value.uid, file)
  }

  async function deleteAccount(): Promise<void> {
    if (!currentUser.value) return

    const membershipStore = useMembershipStore()
    const teamStore = useTeamStore()

    try {
      const allMemberships = await membershipStore.fetchUserMemberships()
      for (const membership of allMemberships) {
        const uid = currentUser.value.uid
        if (membership.role === "owner") {
          const members = await membershipStore.getMembersForTeam(
            membership.teamId
          )
          const owners = members
            .filter(isUserMembership)
            .filter((m) => m.role === "owner")
          // Sole owner → delete the team; otherwise just leave it.
          if (owners.length === 1 && owners[0]?.userId === uid) {
            await teamStore.deleteTeam(membership.teamId)
          } else {
            await membershipStore.removeMember(membership.teamId, uid)
          }
        } else {
          await membershipStore.removeMember(membership.teamId, uid)
        }
      }

      await currentUser.value.delete()
      cleanup()
    } catch (error) {
      console.error("[authStore] Error deleting account:", error)
      throw error
    }
  }

  return {
    // State
    currentUser,
    userProfile,
    userPreferences,
    onboarding,
    isLoading,

    // Pending
    pendingUserIds,

    // Computed
    isUserPending,
    hasAnyPendingOperation,
    isAuthenticated,
    isMembershipPreferencesLoading,
    hasResolvedCurrentWorkspaceSelection,
    currentTeamId,
    currentWorkspaceId,

    // Selection + profile actions
    setCurrentTeamIdLocal,
    setCurrentTeamId,
    setCurrentWorkspaceId,
    updateUserProfile,
    uploadProfilePhoto,
    deleteAccount,

    // Lifecycle
    cleanup,
  }
})

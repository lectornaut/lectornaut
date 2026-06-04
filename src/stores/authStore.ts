/**
 * Auth Store - Authentication and User Profile Management
 *
 * Handles:
 * - Firebase authentication state (via VueFire)
 * - User account profile CRUD with optimistic updates
 * - User-scoped preferences (team selection, onboarding)
 * - Team-membership-scoped workspace selection
 *
 * Reactive Firestore reads flow through TanStack Query; auth state via VueFire.
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
import { useFirestoreMutation } from "@/utils/firebase/firebase-mutation"
import {
  addPending,
  cloneState,
  createPendingSet,
  removePending,
} from "@/utils/firebase/firebase-optimistic"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
import {
  buildUpdatedAtBaseVersion,
  mutateWithCoordinator,
} from "@/utils/firebase/firebase-sync-engine"
import type { User } from "firebase/auth"
import { Timestamp } from "firebase/firestore"
import { defineStore } from "pinia"
import { toast } from "vue-sonner"
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire"

const defaultUserPreferences = (): IUserPreferences => ({
  currentTeamId: null,
  onboarding: false,
})

const defaultMembershipPreferences = (): IMembershipPreferences => ({
  currentWorkspaceId: null,
})

const getMembershipPreferencesCacheKey = (teamId: string) =>
  `membershipPreferences:${teamId}`

export const useAuthStore = defineStore("auth", () => {
  const currentUser = useCurrentUser() as Ref<User | null>

  // VueFire's `currentUser` is TRI-STATE (see the auth guide):
  //   undefined → Firebase Auth is still restoring the persisted session
  //               ("not yet known"); null → confirmed signed out; User → signed in.
  // The `as Ref<User | null>` cast above collapses undefined→null only for
  // ergonomic downstream typing — it does NOT make the runtime value safe to
  // read as "signed out". `useIsCurrentUserLoaded()` (the doc-recommended
  // readiness signal, already used in the landing components) is `false` until
  // that first auth event lands, so the store can wait on the indeterminate
  // window instead of mistaking it for a sign-out and bouncing the user.
  const isCurrentUserLoaded = useIsCurrentUserLoaded()

  const userDocRef = computed(() =>
    currentUser.value ? getUserRef(currentUser.value.uid) : null
  )
  const userPreferencesDocRef = computed(() =>
    currentUser.value ? getUserPreferencesRef(currentUser.value.uid) : null
  )

  const userQuery = useDocumentQuery<IUser>(userDocRef)
  const firestoreUserProfile: ComputedRef<IUser | null | undefined> = computed(
    () => userQuery.data.value
  )
  const isFirestoreLoading: ComputedRef<boolean> = computed(
    () => userQuery.isLoading.value
  )

  const userPreferencesQuery = useDocumentQuery<IUserPreferences>(
    userPreferencesDocRef
  )
  const firestoreUserPreferences: ComputedRef<
    IUserPreferences | null | undefined
  > = computed(() => userPreferencesQuery.data.value)
  const isUserPreferencesLoading: ComputedRef<boolean> = computed(
    () => userPreferencesQuery.isLoading.value
  )

  const optimisticUserPreferences = ref<IUserPreferences | null>(null)
  const optimisticMembershipPreferences = ref<IMembershipPreferences | null>(
    null
  )
  const resolvedMembershipPreferencesTeamId = ref<string | null>(null)

  const pendingUserIds = shallowRef(createPendingSet())

  // Per-mutation optimistic writes go through the cache. Selection state
  // (currentTeamId/currentWorkspaceId) stays on the Pinia overlay below — it is
  // persistent UI state, not per-mutation optimism, so it doesn't fit the hold.
  const userProfileMutation = useFirestoreMutation<
    {
      keys: FirestoreQueryKey[]
      apply: () => void
      rollback: () => void
      run: () => Promise<void>
    },
    void
  >({
    mutationFn: (vars) => vars.run(),
    optimistic: (vars) => ({
      keys: vars.keys,
      apply: vars.apply,
      rollback: vars.rollback,
    }),
    source: "auth.updateUserProfile",
  })

  // Profile reads straight from the realtime cache; `updateUserProfile` applies
  // its optimistic value into that cache (held until the server ack).
  const userProfile = computed(() => firestoreUserProfile.value ?? null)

  const userPreferences = computed({
    get: () => {
      if (
        currentUser.value &&
        pendingUserIds.value.has(currentUser.value.uid)
      ) {
        return (
          optimisticUserPreferences.value ??
          firestoreUserPreferences.value ??
          defaultUserPreferences()
        )
      }
      return (
        firestoreUserPreferences.value ??
        optimisticUserPreferences.value ??
        defaultUserPreferences()
      )
    },
    set: (value) => {
      optimisticUserPreferences.value = value
    },
  })

  const currentTeamId = computed(
    () => userPreferences.value?.currentTeamId ?? null
  )

  const membershipPreferencesDocRef = computed(() => {
    if (!currentUser.value?.uid || !currentTeamId.value) return null
    return getMembershipPreferencesRef(
      currentTeamId.value,
      currentUser.value.uid
    )
  })

  // `reset: true` is unneeded here: when the team changes the query key changes,
  // so `data` reflects the new team's prefs (undefined until its first snapshot)
  // rather than lingering on the previous team's value.
  const membershipPreferencesQuery = useDocumentQuery<IMembershipPreferences>(
    membershipPreferencesDocRef
  )
  const firestoreMembershipPreferences: ComputedRef<
    IMembershipPreferences | null | undefined
  > = computed(() => membershipPreferencesQuery.data.value)
  const isMembershipPreferencesLoading: ComputedRef<boolean> = computed(
    () => membershipPreferencesQuery.isLoading.value
  )
  // A terminal read error (after the read-retry budget is spent — e.g. a
  // permission-denied that never cleared) leaves `data` undefined AND
  // `isLoading` false. The bootstrap resolver below must treat that as a
  // definitive (if unhappy) answer and release the gate, or the app shell spins
  // forever. See `hasResolvedCurrentWorkspaceSelection`.
  const isMembershipPreferencesError: ComputedRef<boolean> = computed(
    () => membershipPreferencesQuery.isError.value
  )
  // True while the membership-preferences query is serving data that was
  // restored from the persisted TanStack cache but has not yet been confirmed
  // by a live Firestore snapshot. Stale ≠ absent: the query has data, but that
  // data may be out of date (e.g. the user switched workspaces on another
  // device, or did so on this device and closed the tab before the cache was
  // persisted with the new value). We must NOT treat stale data as authoritative
  // in either the `membershipPreferences` getter or the reconciliation watch —
  // doing so is exactly the "workspace selection lost on reload" bug.
  const isMembershipPreferencesStale: ComputedRef<boolean> = computed(
    () => membershipPreferencesQuery.isStale.value
  )

  // Mirror `userPreferences`: Firestore (incl. the surviving TanStack read
  // cache) is authoritative when idle; the optimistic overlay only wins while a
  // selection mutation is in flight (`pendingUserIds`). The previous
  // overlay-first order was the reason the selected workspace failed to persist
  // where the selected team did. The two share identical write machinery, but
  // are read with OPPOSITE authority — and they degrade differently when the
  // overlay is reset out from under a surviving cache:
  //   - HMR re-instantiates the Pinia store (no `acceptHMRUpdate`), so every
  //     `ref` — including `optimisticMembershipPreferences` — resets to null,
  //     while the module-singleton `queryClient` cache keeps the real value.
  //     Overlay-first then reads the reset overlay (→ WorkspaceSelector) even
  //     though the value is right there in the cache; the re-subscribed
  //     listener re-delivers the SAME value, so the reconciliation watch never
  //     re-fires to repopulate the overlay and it stays wrong.
  //   - Same failure shape on any cold start where the persisted query cache
  //     rehydrates the doc but the per-team localStorage overlay seed is
  //     missing/stale.
  // Reading Firestore-first is HALF of making the workspace selection survive
  // like the team selection — the other half lives in the reconciliation watch
  // below, which must NOT overwrite the hydrated overlay when Firestore
  // confirms the doc is MISSING (`null`). Without that guard, a missing/not-yet
  // -written doc clobbered the overlay (and its cache) with `null` on every
  // reload, which is the bug this pair of comments exists to prevent.
  //
  // STALE-CACHE EXCEPTION: `isMembershipPreferencesStale` is a third case the
  // original Firestore-first rule didn't account for. A stale TanStack cache
  // entry is non-null (so it passes the `??` precedence) but may carry an
  // older workspace ID — e.g. if the user switched workspaces and the live
  // snapshot hadn't arrived before the tab was closed. In that case the stale
  // cache overrides the localStorage hydration value (which IS current). We
  // therefore fall back to overlay-first while the query is stale, and switch
  // to Firestore-first once a live snapshot confirms the value.
  const membershipPreferences = computed({
    get: () => {
      if (
        currentUser.value &&
        pendingUserIds.value.has(currentUser.value.uid)
      ) {
        return (
          optimisticMembershipPreferences.value ??
          firestoreMembershipPreferences.value ??
          defaultMembershipPreferences()
        )
      }
      // While the query is stale (data is from the persisted cache, not yet
      // confirmed by a live snapshot), prefer the optimistic overlay — it was
      // written by `setCurrentWorkspaceId` and reflects the user's most recent
      // selection on this device, which is more current than the stale cache.
      if (isMembershipPreferencesStale.value) {
        return (
          optimisticMembershipPreferences.value ??
          firestoreMembershipPreferences.value ??
          defaultMembershipPreferences()
        )
      }
      return (
        firestoreMembershipPreferences.value ??
        optimisticMembershipPreferences.value ??
        defaultMembershipPreferences()
      )
    },
    set: (value) => {
      optimisticMembershipPreferences.value = value
    },
  })

  const hydrateMembershipPreferencesForTeam = (teamId: string | null) => {
    if (!teamId) {
      optimisticMembershipPreferences.value = null
      resolvedMembershipPreferencesTeamId.value = null
      return
    }

    // Membership preferences are team-scoped; hydrate the active team's
    // cached selection synchronously so team switches do not flash the app
    // shell spinner while the new team's document query loads its first snapshot.
    const cacheKey = getMembershipPreferencesCacheKey(teamId)
    const cached = readHydrationCache<IMembershipPreferences>(cacheKey, {
      schema: membershipPreferencesHydrationSchema,
      context: `hydration:${cacheKey}`,
    })

    optimisticMembershipPreferences.value =
      cached ?? defaultMembershipPreferences()
    // resolvedMembershipPreferencesTeamId is intentionally NOT set here.
    // The bootstrap gate consumes this flag and must wait for Firestore
    // confirmation — a stale cache (e.g. workspace selected on another
    // device since last sync) can disagree with Firestore, and trusting
    // the cache would briefly fall through to WorkspaceSelector before
    // Firestore corrects us. The Firestore watch below sets this flag.
  }

  const persistMembershipPreferencesForTeam = (
    teamId: string | null,
    value: IMembershipPreferences | null
  ) => {
    if (!teamId) return

    writeHydrationCache(
      getMembershipPreferencesCacheKey(teamId),
      value ?? defaultMembershipPreferences()
    )
  }

  // Hydrate from localStorage for instant cold-start rendering. The hydration
  // schemas validate the cached entry and rehydrate Timestamp fields (which
  // JSON.stringify strips to plain { seconds, nanoseconds } objects).
  // userProfile cold-start is now covered by the persisted query cache
  // (persistQueryClient); only the still-Pinia-overlaid preferences hydrate here.
  useLocalHydration(
    "userPreferences",
    optimisticUserPreferences,
    () => userPreferences.value,
    { schema: userPreferencesHydrationSchema }
  )

  const currentWorkspaceId = computed(
    () => membershipPreferences.value?.currentWorkspaceId ?? null
  )
  const onboarding = computed(() => userPreferences.value?.onboarding ?? false)
  const hasResolvedCurrentWorkspaceSelection = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return true
    return resolvedMembershipPreferencesTeamId.value === teamId
  })

  // Treat the auth-restoration window (currentUser === undefined) as "loading",
  // NOT "signed out". Otherwise the app shell evaluates the gate while
  // `isAuthenticated`/`userProfile` are still indeterminate and momentarily
  // concludes the user is signed out — flashing the shell/landing right after
  // login. While auth is unknown the user-doc query is disabled (so
  // `isFirestoreLoading` is false); `isCurrentUserLoaded` is what carries the
  // "still resolving" signal during that gap.
  const isLoading = computed(
    () =>
      !isCurrentUserLoaded.value ||
      ((isFirestoreLoading.value || isUserPreferencesLoading.value) &&
        !userProfile.value)
  )

  const isUserPending = computed(
    () => (id: string) => pendingUserIds.value.has(id)
  )

  const hasAnyPendingOperation = computed(() => pendingUserIds.value.size > 0)
  const isAuthenticated = computed(() => !!currentUser.value)

  watch(
    [currentUser, firestoreUserProfile, isFirestoreLoading],
    async ([user, profile, loading]) => {
      if (!user || loading) return
      // The query's `data` is `undefined` until the first snapshot arrives;
      // it only becomes `null` when the document genuinely doesn't exist.
      // The immediate fire here can run before that first snapshot lands
      // (during store setup, right after the docRef becomes non-null), so we
      // guard on `undefined`. Without this guard the `!profile`
      // branch below would (a) overwrite hydrated profile fields like
      // `username` and `isPublic` with defaults, briefly flashing them in
      // dependent UI, and (b) trigger an unnecessary cloud function call
      // to "create" a profile that already exists in Firestore.
      // (Same race we guarded against in the membership-prefs watch below.)
      if (profile === undefined) return

      if (!profile) {
        try {
          const now = Timestamp.now()
          const optimisticUser: IUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            username: null,
            isPublic: false,
            createdAt: now,
            updatedAt: now,
          }
          // Show the default profile immediately (before the async write) by
          // seeding the cache; the create then lands and the listener reconciles.
          queryClient.setQueryData(
            queryKeys.doc(getUserRef(user.uid).path),
            optimisticUser
          )
          await syncCurrentUserAccountProfile()
        } catch (error) {
          console.error("[authStore] Failed to create user profile:", error)
          toast.error("Failed to create user profile. Please try again.")
        }
      }
    },
    { immediate: true }
  )

  watch(
    firestoreUserPreferences,
    (preferences) => {
      if (
        preferences &&
        currentUser.value &&
        !pendingUserIds.value.has(currentUser.value.uid)
      ) {
        optimisticUserPreferences.value = preferences
      }
    },
    { immediate: true }
  )

  watch(
    [
      currentTeamId,
      firestoreMembershipPreferences,
      isMembershipPreferencesLoading,
      isMembershipPreferencesError,
      isMembershipPreferencesStale,
    ],
    ([teamId, preferences, loading, errored, isStale]) => {
      if (!currentUser.value || !teamId || loading) {
        return
      }
      // `undefined` = the query has not delivered its first snapshot yet
      // (still loading) — wait. The immediate fire can run before the query
      // has delivered its first snapshot for the docRef that the just-applied
      // `currentTeamId` hydration produced, so without this guard we'd act on
      // a phantom "loading" state.
      //
      // EXCEPTION: a terminal query error also presents as `undefined` data
      // with `loading` false. That is NOT "still loading" — it's a definitive
      // failure, and waiting on it spins the app shell forever (the infinite
      // workspace-loading bug). When `errored`, fall through and release the
      // gate against the hydrated/empty overlay instead of blocking.
      if (preferences === undefined && !errored) return

      // Do NOT treat stale TanStack cache data as a live Firestore snapshot.
      // `isStale` is true when `restoreQueryCache()` loaded the persisted cache
      // but the live onSnapshot listener has not yet delivered a fresh value.
      // Acting on that stale value would:
      //   1. Release the bootstrap gate against a potentially out-of-date
      //      workspace selection.
      //   2. Overwrite the localStorage hydration cache (`persistMembership-
      //      PreferencesForTeam`) with the stale cached value, destroying the
      //      newer workspace ID that `setCurrentWorkspaceId` wrote there before
      //      the tab was closed.
      // The error exception is preserved: a terminal read failure is definitive
      // and must release the gate regardless of staleness.
      if (isStale && !errored) return

      // Mirror the userPreferences reconciliation (the team-selection path that
      // ALREADY survives reload): let Firestore overwrite the cold-start
      // hydrated overlay ONLY when it actually has a stored value. A `null`
      // here is the listener CONFIRMING the membership-preferences doc does not
      // exist (see useDocumentQuery's null-vs-undefined contract) — it does NOT
      // mean the user has no selection.
      //
      // The previous `preferences ?? defaultMembershipPreferences()` treated
      // that `null` as authoritative: it clobbered the hydrated
      // `currentWorkspaceId` with `null` AND wrote that `null` back to the
      // per-team cache, so the selected workspace was wiped on every reload
      // whenever the doc was missing or the write had not yet landed. The
      // selected TEAM never broke this way precisely because its reconciliation
      // guards on `if (preferences)` and leaves the hydrated overlay untouched
      // when Firestore is empty. This is that same guard.
      //
      // Resolution is marked regardless (even on a confirmed-missing doc): an
      // absent doc is a definitive answer, so release the bootstrap gate and
      // fall back to the hydrated/empty overlay instead of spinning forever.
      if (preferences) {
        optimisticMembershipPreferences.value = preferences
        persistMembershipPreferencesForTeam(teamId, preferences)
      }
      resolvedMembershipPreferencesTeamId.value = teamId
    },
    { immediate: true }
  )

  watch(
    currentTeamId,
    (teamId, previousTeamId) => {
      if (teamId === previousTeamId && previousTeamId !== undefined) return
      hydrateMembershipPreferencesForTeam(teamId)
    },
    { immediate: true }
  )

  function cleanup() {
    optimisticUserPreferences.value = null
    optimisticMembershipPreferences.value = null
    resolvedMembershipPreferencesTeamId.value = null
    clearHydrationCache()
    // Also drop the persisted + in-memory read cache so the next user never
    // sees the previous user's Firestore data on cold start.
    void clearPersistedQueryCache()
  }

  watch(currentUser, () => {
    // Tear down ONLY on a confirmed sign-out. VueFire emits `undefined` during
    // the initial auth-restoration window; treating that like a sign-out would
    // run `clearPersistedQueryCache()` (a full cache wipe) mid-bootstrap and
    // bounce the signed-in user back to the shell/landing. Gating on
    // `isCurrentUserLoaded` collapses this to a real `null` (signed out) only.
    if (isCurrentUserLoaded.value && !currentUser.value) {
      cleanup()
    }
  })

  let currentTeamMutationChain: Promise<void> = Promise.resolve()

  const getUserPreferencesUpdatedAtBaseVersion = (fallbackUpdatedAt: unknown) =>
    buildUpdatedAtBaseVersion(
      firestoreUserPreferences.value?.updatedAt ?? fallbackUpdatedAt
    )

  function setCurrentTeamIdLocal(teamId: string | null): void {
    if (!currentUser.value) return

    optimisticUserPreferences.value = {
      ...(userPreferences.value ?? defaultUserPreferences()),
      currentTeamId: teamId,
    }
    hydrateMembershipPreferencesForTeam(teamId)
  }

  async function setCurrentTeamId(teamId: string | null): Promise<void> {
    currentTeamMutationChain = currentTeamMutationChain
      .catch(() => undefined)
      .then(async () => {
        if (!currentUser.value) return
        if (currentTeamId.value === teamId) return

        const previousUserPreferences = cloneState(userPreferences.value)

        await mutateWithCoordinator({
          id: currentUser.value.uid,
          source: "auth.setCurrentTeamId",
          pendingIds: pendingUserIds,
          applyLocal: () => {
            setCurrentTeamIdLocal(teamId)
          },
          rollbackLocal: () => {
            optimisticUserPreferences.value = previousUserPreferences
          },
          mutation: {
            source: "auth.setCurrentTeamId",
            targetPath: getUserPreferencesRef(currentUser.value.uid).path,
            type: "set",
            merge: true,
            data: {
              currentTeamId: teamId,
            },
            baseVersion: getUserPreferencesUpdatedAtBaseVersion(
              previousUserPreferences?.updatedAt
            ),
          },
        })
      })

    return currentTeamMutationChain
  }

  function setCurrentWorkspaceId(workspaceId: string | null): void {
    if (!currentUser.value) return

    optimisticMembershipPreferences.value = {
      ...(membershipPreferences.value ?? defaultMembershipPreferences()),
      currentWorkspaceId: workspaceId,
    }
    resolvedMembershipPreferencesTeamId.value = currentTeamId.value
    persistMembershipPreferencesForTeam(
      currentTeamId.value,
      optimisticMembershipPreferences.value
    )
  }

  async function updateUserProfile(
    updates: Partial<IUserProfile>
  ): Promise<void> {
    const user = currentUser.value
    const baseProfile = userProfile.value
    if (!user || !baseProfile) return

    const userId = user.uid
    const { displayName, photoURL } = updates

    // Empty string is the legacy "clear" signal — normalize to null
    // for both the optimistic local copy AND the wire payload so the
    // two stay aligned. The server's validator also accepts empty
    // string but it's cleaner to send the canonical form.
    const normalizedPhotoURL =
      photoURL === "" || photoURL === null ? null : photoURL

    // Build the wire payload. Only include keys the caller actually
    // touched — the server treats missing keys as "leave untouched"
    // and only-changed keys land in the audit log diff. Drops any
    // ad-hoc fields callers may have passed historically (username /
    // isPublic / etc.) — those have their own dedicated callables
    // and shouldn't ride along here.
    const payload: { displayName?: string; photoURL?: string | null } = {}
    // IUserProfile.displayName is `string | null`, but the callable
    // accepts only `string` (the server's validator rejects null —
    // the settings UI always provides a name). Drop nulls on the
    // client so a stale call site can't trip a server-side
    // invalid-argument error.
    if (typeof displayName === "string") payload.displayName = displayName
    if (photoURL !== undefined) payload.photoURL = normalizedPhotoURL

    if (Object.keys(payload).length === 0) return

    const key = queryKeys.doc(getUserRef(userId).path)
    const previous = queryClient.getQueryData<IUser>(key)
    const optimisticProfile: IUser = {
      ...baseProfile,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
    }

    addPending(pendingUserIds, userId)
    try {
      await userProfileMutation.mutateAsync({
        keys: [key],
        apply: () => queryClient.setQueryData(key, optimisticProfile),
        rollback: () => queryClient.setQueryData(key, previous),
        // Single round-trip: the server updates Firestore + Firebase Auth
        // atomically (Admin SDK), eliminating the divergence window the prior
        // client-side parallel-writes pattern had. The audit entry lands in
        // Cloud Logging — see the JSDoc on `updateOwnUserProfile`.
        run: async () => {
          await updateOwnUserProfileFn(payload)
        },
      })
    } finally {
      setTimeout(() => removePending(pendingUserIds, userId), 120)
    }
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
        if (membership.role === "owner") {
          const teamMembers = await membershipStore.getMembersForTeam(
            membership.teamId
          )
          const owners = teamMembers
            .filter(isUserMembership)
            .filter((m) => m.role === "owner")

          if (
            owners.length === 1 &&
            owners[0]?.userId === currentUser.value.uid
          ) {
            await teamStore.deleteTeam(membership.teamId)
          } else {
            await membershipStore.removeMember(
              membership.teamId,
              currentUser.value.uid
            )
          }
        } else {
          await membershipStore.removeMember(
            membership.teamId,
            currentUser.value.uid
          )
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
    currentUser,
    userProfile,
    userPreferences,
    onboarding,
    isLoading,

    pendingUserIds,

    isUserPending,
    hasAnyPendingOperation,
    isAuthenticated,
    isMembershipPreferencesLoading,
    hasResolvedCurrentWorkspaceSelection,
    currentTeamId,
    currentWorkspaceId,

    setCurrentTeamIdLocal,
    setCurrentTeamId,
    setCurrentWorkspaceId,
    updateUserProfile,
    uploadProfilePhoto,
    deleteAccount,

    cleanup,
  }
})

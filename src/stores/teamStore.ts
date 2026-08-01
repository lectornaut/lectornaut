/**
 * Team Store — the current team doc + team CRUD.
 *
 * Responsibilities:
 * - `currentTeam`  — the selected team (realtime doc, with a denormalized
 *   membership-snapshot fallback for instant cold-start paint).
 * - create / update / delete / switch / clear-selection.
 *
 * Selection (`currentTeamId`) lives on authStore; membership data lives on
 * membershipStore. This store binds the current team's doc and runs the team
 * mutations (which also patch the denormalized `team` snapshot on each
 * membership row via membershipStore helpers). Mutations go through Cloud
 * Functions for audit logging.
 */

import {
  createTeam as createTeamFn,
  deleteTeam as deleteTeamFn,
  updateTeam as updateTeamFn,
} from "@/composables/useFunctions"
import { queryClient } from "@/modules/queryClient"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { ITeam } from "@/types/domain"
import { Capabilities, roleCan } from "@/types/permissions"
import {
  deleteTeamPhotoFile,
  getTeamRef,
  uploadTeamPhoto,
} from "@/utils/firebase/firebase-helpers"
import { useRunWrite } from "@/utils/firebase/firebase-mutation"
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
import { Timestamp } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"

/**
 * Stale-team detection, extracted pure for direct unit-testing (mirrors
 * workspaceStore's `pendingStaleSelection`). Returns the stale target — with
 * why it's stale — or `null` when the selection is fine or the state is too
 * indeterminate to judge. The caller re-evaluates EVERY guard through this
 * table both when scheduling the confirm timer and again when it fires.
 */
export interface StaleTeamSelectionInputs {
  teamId: string | null
  /**
   * The live team-doc snapshot: `undefined` while loading (indeterminate),
   * `null` once the listener confirms the doc is genuinely gone.
   */
  team: ITeam | null | undefined
  isTeamDocLoading: boolean
  isMembershipLoading: boolean
  /** Terminal memberships read error — its empty list means "unknown". */
  isMembershipError: boolean
  /** Cache-restored memberships a live snapshot hasn't reconfirmed. */
  isMembershipStale: boolean
  hasAnyPendingOperation: boolean
  isPendingTeam: boolean
  isMember: boolean
}

export interface StaleTeamSelection {
  teamId: string
  reason: "membership-revoked" | "team-deleted"
}

// ── Stale-selection double-confirm controller (pure timing, unit-tested) ────

/**
 * The confirm-window machinery around `evaluateStaleTeamSelection`, extracted
 * so its timing semantics are directly testable (mirrors how authStore
 * extracted `createSelectionWriteController`). The contract:
 *
 * - `observe(target)` is called on every reactive flip with the CURRENT
 *   evaluation. A stale target schedules the countdown; `null` cancels it
 *   (the blip healed — no write). Re-observing the SAME target lets the
 *   running countdown stand; a DIFFERENT target restarts it from zero.
 * - At fire, `evaluate()` re-runs the full decision table against the LATEST
 *   state: only the same still-stale target confirms (`onConfirmed`, exactly
 *   once per countdown); a heal or a retarget at fire time drops silently.
 * - `cancel()` (teardown) drops any pending countdown so it can never fire
 *   against a torn-down user.
 */
export interface StaleSelectionConfirmController {
  observe(target: StaleTeamSelection | null): void
  cancel(): void
}

export function createStaleSelectionConfirmController(options: {
  confirmMs: number
  evaluate: () => StaleTeamSelection | null
  onConfirmed: (target: StaleTeamSelection) => void
}): StaleSelectionConfirmController {
  let timer: ReturnType<typeof setTimeout> | null = null
  let confirmTeamId: string | null = null

  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    confirmTeamId = null
  }

  return {
    observe(target) {
      if (!target) {
        // Conditions no longer hold (membership repopulated, doc arrived) —
        // abort any scheduled clear so a transient blip never reaches the
        // durable write.
        cancel()
        return
      }
      // Already counting down for this exact selection — let the timer run.
      if (timer && confirmTeamId === target.teamId) return
      cancel()
      confirmTeamId = target.teamId
      timer = setTimeout(() => {
        timer = null
        confirmTeamId = null
        // Re-confirm against the LATEST state: the same selection must still
        // be stale. A transient empty/loading window has resolved by now.
        const confirmed = options.evaluate()
        if (!confirmed || confirmed.teamId !== target.teamId) return
        options.onConfirmed(confirmed)
      }, options.confirmMs)
    },
    cancel,
  }
}

export function evaluateStaleTeamSelection(
  inputs: StaleTeamSelectionInputs
): StaleTeamSelection | null {
  if (!inputs.teamId) return null
  // Act only on a definitive, live answer — never interim state.
  if (inputs.isTeamDocLoading || inputs.isMembershipLoading) return null
  // Never act mid-mutation: a team create / join / switch marks pending and
  // its membership snapshot may not have landed yet — clearing now would drop
  // a selection that's about to become valid.
  if (inputs.hasAnyPendingOperation || inputs.isPendingTeam) return null

  // Membership revoked, or never a member. `teamDocRef` disables the team-doc
  // query whenever the user isn't in `memberships`, so the doc snapshot never
  // resolves to `null` for this path — detect it from the memberships list
  // directly, but only once that list is a trustworthy live answer.
  if (!inputs.isMember) {
    if (inputs.isMembershipError || inputs.isMembershipStale) return null
    return { teamId: inputs.teamId, reason: "membership-revoked" }
  }

  // Team deleted. The doc query is live (user is a member) and a `null`
  // snapshot confirms the doc is genuinely gone; `undefined` is the loading
  // window — acting on it would clear a valid selection.
  if (inputs.team === null) {
    return { teamId: inputs.teamId, reason: "team-deleted" }
  }

  return null
}

export const useTeamStore = defineStore("teams", () => {
  const authStore = useAuthStore()
  const membershipStore = useMembershipStore()

  const {
    currentUser,
    userProfile,
    pendingUserIds,
    currentTeamId,
    isLoading: isAuthLoading,
  } = storeToRefs(authStore)
  const {
    memberships,
    teamMembers,
    pendingMembershipIds,
    isLoading: isMembershipLoading,
    isError: isMembershipError,
    isStale: isMembershipStale,
  } = storeToRefs(membershipStore)

  // ── Realtime read ───────────────────────────────────────────────────────────
  // Idle unless a team is selected AND the user is confirmed a member (reading
  // a team doc the user was removed from would hit a rules denial).
  const teamDocRef = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null
    if (!memberships.value.some((m) => m.teamId === teamId)) return null
    return getTeamRef(teamId)
  })
  const teamQuery = useDocumentQuery<ITeam>(teamDocRef)
  const firestoreCurrentTeam = computed(() => teamQuery.data.value)
  const isTeamDocLoading = computed(() => teamQuery.isLoading.value)

  // ── State ───────────────────────────────────────────────────────────────────
  const pendingTeamIds = shallowRef(createPendingSet())

  const teamDocKey = (teamId: string): FirestoreQueryKey =>
    queryKeys.doc(`teams/${teamId}`)

  const runWrite = useRunWrite("team")

  // ── Computed ────────────────────────────────────────────────────────────────
  // Realtime doc first; fall back to the denormalized membership `team` snapshot
  // so the team paints instantly before the doc query resolves. The snapshot is
  // a pick of the team schema (no `billing`), assignable to ITeam since billing
  // is optional — so `currentTeam.billing` stays undefined until the doc lands.
  const currentTeam = computed<ITeam | null>(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null
    return (
      firestoreCurrentTeam.value ??
      memberships.value.find((m) => m.teamId === teamId)?.team ??
      null
    )
  })

  const isLoading = computed(() => {
    if (isAuthLoading.value) return true
    if (currentTeamId.value) {
      return isTeamDocLoading.value && !currentTeam.value
    }
    return false
  })

  const isTeamPending = computed(
    () => (id: string) => pendingTeamIds.value.has(id)
  )
  const hasAnyPendingOperation = computed(
    () =>
      pendingTeamIds.value.size > 0 ||
      pendingUserIds.value.size > 0 ||
      pendingMembershipIds.value.size > 0
  )

  // ── Stale-selection cleanup ─────────────────────────────────────────────────
  // Drop a currentTeamId that Firestore confirms is gone (team deleted) or that
  // the user is no longer a member of (membership revoked / never joined).
  // Clearing writes `currentTeamId: null` durably and cross-device, so a false
  // positive wipes a selection another device just made — and every "it's
  // gone" trigger is racy in isolation (cross-listener ordering, a mid-switch
  // membership list, a re-subscribe window). As with workspaceStore, never
  // clear on a single observation: the SAME selection must STILL be stale
  // after a short confirmation delay, with every guard re-evaluated when the
  // timer fires. A transient blip repopulates and self-cancels.
  const clearStaleSelection = async () => {
    try {
      await authStore.setCurrentTeamId(null)
    } catch (error) {
      console.error("[teamStore] Failed to clear stale currentTeamId:", error)
      authStore.setCurrentTeamIdLocal(null)
    }
  }

  // Mirrors workspaceStore's STALE_SELECTION_CONFIRM_MS.
  const STALE_SELECTION_CONFIRM_MS = 400

  // Evaluate every guard against CURRENT reactive state (decision table lives
  // on `evaluateStaleTeamSelection`, pure and unit-tested).
  const pendingStaleTeamSelection = (): StaleTeamSelection | null => {
    const teamId = currentTeamId.value
    return evaluateStaleTeamSelection({
      teamId,
      team: firestoreCurrentTeam.value,
      isTeamDocLoading: isTeamDocLoading.value,
      isMembershipLoading: isMembershipLoading.value,
      isMembershipError: isMembershipError.value,
      isMembershipStale: isMembershipStale.value,
      hasAnyPendingOperation: hasAnyPendingOperation.value,
      isPendingTeam: !!teamId && pendingTeamIds.value.has(teamId),
      isMember: !!teamId && memberships.value.some((m) => m.teamId === teamId),
    })
  }

  // Schedule/cancel/refire semantics live on the extracted controller
  // (`createStaleSelectionConfirmController`, unit-tested with fake timers).
  const staleSelectionConfirm = createStaleSelectionConfirmController({
    confirmMs: STALE_SELECTION_CONFIRM_MS,
    evaluate: pendingStaleTeamSelection,
    onConfirmed: (confirmed) => {
      console.warn(
        `[teamStore] Confirmed stale currentTeamId (${confirmed.reason}), clearing...`,
        confirmed.teamId
      )
      void clearStaleSelection()
    },
  })

  watch(
    [
      currentTeamId,
      firestoreCurrentTeam,
      memberships,
      isTeamDocLoading,
      isMembershipLoading,
      isMembershipError,
      isMembershipStale,
    ],
    () => {
      staleSelectionConfirm.observe(pendingStaleTeamSelection())
    }
  )

  // ── Teardown ────────────────────────────────────────────────────────────────
  // Drop any in-flight stale-confirmation timer so it can't fire against a
  // torn-down user (mirrors workspaceStore.cleanup).
  function cleanup() {
    staleSelectionConfirm.cancel()
    authStore.cleanup()
    membershipStore.cleanup()
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function createTeam(
    name: string,
    options?: {
      photoFile?: File
      username?: string
      isPublic?: boolean
    }
  ): Promise<string | undefined> {
    if (!currentUser.value || !userProfile.value) return
    const { photoFile, username, isPublic } = options ?? {}

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const now = Timestamp.now()
    // Photo upload happens after creation (needs the real id), so the temp doc
    // starts photoless.
    const optimisticTeam: ITeam = {
      id: tempId,
      name,
      photoURL: null,
      username: null,
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    }

    const creatorUid = currentUser.value.uid
    const previousTeamId = currentTeamId.value
    const previousMemberships = cloneState(memberships.value)
    const previousTeamMembers = cloneState(teamMembers.value)
    const tempKey = teamDocKey(tempId)

    let actualTeamId: string | undefined
    let resolvedPhotoURL: string | null = null
    let resolvedUsername: string | null = null
    let resolvedIsPublic = false

    addPending(pendingUserIds, creatorUid)
    try {
      await runWrite({
        keys: [tempKey],
        apply: () => {
          queryClient.setQueryData<ITeam>(tempKey, optimisticTeam)
          authStore.setCurrentTeamIdLocal(tempId)
        },
        rollback: () => {
          queryClient.removeQueries({ queryKey: tempKey, exact: true })
          authStore.setCurrentTeamIdLocal(previousTeamId ?? null)
          membershipStore.rollbackMemberships(previousMemberships)
          membershipStore.rollbackTeamMembers(previousTeamMembers)
        },
        fn: async () => {
          const result = await createTeamFn({ name, photoURL: null })
          actualTeamId = result.data.teamId

          // Best-effort photo upload once the team exists.
          if (photoFile && actualTeamId) {
            try {
              resolvedPhotoURL = await uploadTeamPhoto(actualTeamId, photoFile)
              await updateTeamFn({
                teamId: actualTeamId,
                photoURL: resolvedPhotoURL,
              })
            } catch (error) {
              console.error("[teamStore] Error uploading team photo:", error)
            }
          }

          if (
            actualTeamId &&
            (username !== undefined || isPublic !== undefined)
          ) {
            try {
              await updateTeamFn({
                teamId: actualTeamId,
                ...(username !== undefined ? { username } : {}),
                ...(isPublic !== undefined ? { isPublic } : {}),
              })
              if (username !== undefined) resolvedUsername = username
              if (isPublic !== undefined) resolvedIsPublic = isPublic
            } catch (error) {
              console.error(
                "[teamStore] Error applying public team settings:",
                error
              )
            }
          }

          // Seed the real doc + move the selection to the server id.
          queryClient.setQueryData<ITeam>(teamDocKey(actualTeamId), {
            ...optimisticTeam,
            id: actualTeamId,
            photoURL: resolvedPhotoURL,
            username: resolvedUsername,
            isPublic: resolvedIsPublic,
          })
          authStore.setCurrentTeamIdLocal(actualTeamId)
        },
        pending: { ref: pendingTeamIds, ids: [tempId] },
      })
    } finally {
      removePending(pendingUserIds, creatorUid)
    }

    return actualTeamId
  }

  async function switchTeam(teamId: string): Promise<void> {
    if (!currentUser.value || !userProfile.value) return
    // No identity guard here: `currentTeamId` reads the optimistic overlay,
    // so only setCurrentTeamId — which sees the selection controller's
    // in-flight state — can tell a true no-op from a re-click of an
    // in-flight target that must re-register (last-click-wins).
    // Selection is the authStore overlay; currentTeam falls back to the target
    // team's membership snapshot for instant display, and setCurrentTeamId rolls
    // the selection back on error.
    await authStore.setCurrentTeamId(teamId)
  }

  async function updateTeam(
    teamId: string,
    updates: {
      name?: string
      photoFile?: File | null
      username?: string | null
      isPublic?: boolean
    }
  ): Promise<void> {
    if (!currentUser.value) return

    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership || !roleCan(membership.role, Capabilities.EDIT_TEAM)) {
      throw new Error("Only team owners and admins can update team details")
    }

    const { name, photoFile, username, isPublic } = updates
    const optimisticPhotoURL =
      photoFile instanceof File ? URL.createObjectURL(photoFile) : undefined

    const optimisticPatch: Partial<ITeam> = {
      ...(name !== undefined ? { name } : {}),
      ...(username !== undefined ? { username } : {}),
      ...(isPublic !== undefined ? { isPublic } : {}),
      ...(photoFile === null
        ? { photoURL: null }
        : optimisticPhotoURL
          ? { photoURL: optimisticPhotoURL }
          : {}),
    }

    const teamKey = teamDocKey(teamId)
    // `patch` also rewrites the denormalized `team` snapshot on the memberships
    // LIST cache, so hold that key too — otherwise the memberships listener can
    // deliver a pre-apply snapshot that flickers the optimistic name/photo back.
    const membershipsKey = membershipStore.membershipsCacheKey()
    const previousTeamDoc = queryClient.getQueryData<ITeam>(teamKey)
    const previousMemberships = cloneState(memberships.value)
    let resolvedPhotoURL: string | null | undefined =
      photoFile === null ? null : undefined

    const patch = (changes: Partial<ITeam>) => {
      const current = queryClient.getQueryData<ITeam>(teamKey)
      if (current) {
        queryClient.setQueryData<ITeam>(teamKey, { ...current, ...changes })
      }
      membershipStore.updateTeamInMemberships(teamId, changes)
    }

    try {
      await runWrite({
        keys: membershipsKey ? [teamKey, membershipsKey] : [teamKey],
        apply: () => patch(optimisticPatch),
        rollback: () => {
          queryClient.setQueryData(teamKey, previousTeamDoc)
          membershipStore.rollbackMemberships(previousMemberships)
        },
        fn: async () => {
          if (photoFile instanceof File) {
            resolvedPhotoURL = await uploadTeamPhoto(teamId, photoFile)
          }

          await updateTeamFn({
            teamId,
            ...(name !== undefined ? { name } : {}),
            ...(username !== undefined ? { username } : {}),
            ...(isPublic !== undefined ? { isPublic } : {}),
            ...(photoFile !== undefined
              ? { photoURL: resolvedPhotoURL ?? null }
              : {}),
          })

          if (photoFile !== undefined && resolvedPhotoURL !== undefined) {
            patch({ photoURL: resolvedPhotoURL })
          }
          if (resolvedPhotoURL === null) {
            await deleteTeamPhotoFile(teamId)
          }
        },
        pending: { ref: pendingTeamIds, ids: [teamId] },
      })
    } finally {
      if (optimisticPhotoURL) URL.revokeObjectURL(optimisticPhotoURL)
    }
  }

  async function deleteTeam(teamId: string): Promise<void> {
    if (!currentUser.value) return

    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership || !roleCan(membership.role, Capabilities.DELETE_TEAM)) {
      throw new Error("Only team owners can delete the team")
    }

    const teamKey = teamDocKey(teamId)
    // delete drops this team's rows from the memberships LIST cache, so hold
    // that key alongside the team doc.
    const membershipsKey = membershipStore.membershipsCacheKey()
    const previousMemberships = cloneState(memberships.value)
    const previousTeamDoc = queryClient.getQueryData<ITeam>(teamKey)
    const previousTeamId = currentTeamId.value
    const isCurrent = currentTeam.value?.id === teamId

    await runWrite({
      keys: membershipsKey ? [teamKey, membershipsKey] : [teamKey],
      apply: () => {
        membershipStore.removeMembershipsForTeam(teamId)
        if (isCurrent) {
          queryClient.setQueryData(teamKey, null)
          authStore.setCurrentTeamIdLocal(null)
        }
      },
      rollback: () => {
        membershipStore.rollbackMemberships(previousMemberships)
        queryClient.setQueryData(teamKey, previousTeamDoc)
        if (isCurrent) {
          authStore.setCurrentTeamIdLocal(previousTeamId ?? null)
        }
      },
      fn: async () => {
        // Photo + nested storage (workspace/group avatars, attachments)
        // cleanup is handled server-side by the deleteTeam callable (a prefix
        // sweep) — admin SDK, so it avoids the post-delete access-revocation
        // race the client-side delete previously had to work around.
        await deleteTeamFn({ teamId })
      },
      pending: { ref: pendingTeamIds, ids: [teamId] },
    })
  }

  async function clearCurrentTeam(): Promise<void> {
    await authStore.setCurrentTeamId(null)
    membershipStore.clearTeamMembers()
  }

  return {
    // State
    currentUser,
    userProfile,
    currentTeam,
    memberships,
    teamMembers,
    isLoading,

    // Pending
    pendingTeamIds,
    pendingUserIds,
    pendingMembershipIds,

    // Computed
    isTeamPending,
    isUserPending: authStore.isUserPending,
    isMembershipPending: membershipStore.isMembershipPending,
    hasAnyPendingOperation,

    // Actions
    createTeam,
    switchTeam,
    updateTeam,
    deleteTeam,

    // Helpers
    clearCurrentTeam,

    // Lifecycle
    cleanup,
  }
})

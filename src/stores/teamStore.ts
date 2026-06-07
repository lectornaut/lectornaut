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
import { Timestamp } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"

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

  const teamMutation = useFirestoreMutation<
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
    source: "team",
  })

  const runTeamMutation = (
    keys: FirestoreQueryKey[],
    apply: () => void,
    rollback: () => void,
    run: () => Promise<void>
  ): Promise<void> => teamMutation.mutateAsync({ keys, apply, rollback, run })

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
  const clearStaleSelection = async () => {
    try {
      await authStore.setCurrentTeamId(null)
    } catch (error) {
      console.error("[teamStore] Failed to clear stale currentTeamId:", error)
      authStore.setCurrentTeamIdLocal(null)
    }
  }

  watch(
    [
      currentTeamId,
      firestoreCurrentTeam,
      isTeamDocLoading,
      isMembershipLoading,
      isMembershipError,
      isMembershipStale,
    ],
    async ([teamId, team, loading, membershipLoading]) => {
      if (!teamId || loading || membershipLoading) return
      // Never act mid-mutation: a team create / join / switch marks pending and
      // its membership snapshot may not have landed yet — clearing now would
      // drop a selection that's about to become valid.
      if (hasAnyPendingOperation.value || pendingTeamIds.value.has(teamId)) {
        return
      }

      const isMember = memberships.value.some((m) => m.teamId === teamId)

      // Case A — membership revoked, or never a member. `teamDocRef` disables
      // the team-doc query whenever the user isn't in `memberships`, so
      // `firestoreCurrentTeam` never resolves to `null` and Case B below can't
      // fire for this path. Detect it from the memberships list directly — but
      // only once that list is a trustworthy live answer: a terminal read error
      // leaves `memberships` an empty fallback that means "unknown", not "no
      // teams", and a stale cache may lag the user's real membership set.
      if (!isMember) {
        if (isMembershipError.value || isMembershipStale.value) return
        console.warn(
          "[teamStore] currentTeamId not in memberships (revoked or never joined), clearing...",
          teamId
        )
        await clearStaleSelection()
        return
      }

      // Case B — team deleted. The doc query is live (user is a member) and a
      // `null` snapshot confirms the doc is genuinely gone. `undefined` is the
      // loading window — acting on it would clear a valid selection in narrow
      // timing windows.
      if (team === null) {
        console.warn(
          "[teamStore] Detected stale team ID (deleted), clearing...",
          teamId
        )
        await clearStaleSelection()
      }
    }
  )

  // ── Teardown ────────────────────────────────────────────────────────────────
  function cleanup() {
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

    addPending(pendingTeamIds, tempId)
    addPending(pendingUserIds, creatorUid)
    try {
      await runTeamMutation(
        [tempKey],
        () => {
          queryClient.setQueryData<ITeam>(tempKey, optimisticTeam)
          authStore.setCurrentTeamIdLocal(tempId)
        },
        () => {
          queryClient.removeQueries({ queryKey: tempKey, exact: true })
          authStore.setCurrentTeamIdLocal(previousTeamId ?? null)
          membershipStore.rollbackMemberships(previousMemberships)
          membershipStore.rollbackTeamMembers(previousTeamMembers)
        },
        async () => {
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
        }
      )
    } finally {
      removePending(pendingUserIds, creatorUid)
      setTimeout(() => removePending(pendingTeamIds, tempId), 120)
    }

    return actualTeamId
  }

  async function switchTeam(teamId: string): Promise<void> {
    if (!currentUser.value || !userProfile.value) return
    if (currentTeamId.value === teamId) return
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

    addPending(pendingTeamIds, teamId)
    try {
      await runTeamMutation(
        membershipsKey ? [teamKey, membershipsKey] : [teamKey],
        () => patch(optimisticPatch),
        () => {
          queryClient.setQueryData(teamKey, previousTeamDoc)
          membershipStore.rollbackMemberships(previousMemberships)
        },
        async () => {
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
        }
      )
    } finally {
      if (optimisticPhotoURL) URL.revokeObjectURL(optimisticPhotoURL)
      setTimeout(() => removePending(pendingTeamIds, teamId), 120)
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

    addPending(pendingTeamIds, teamId)
    try {
      await runTeamMutation(
        membershipsKey ? [teamKey, membershipsKey] : [teamKey],
        () => {
          membershipStore.removeMembershipsForTeam(teamId)
          if (isCurrent) {
            queryClient.setQueryData(teamKey, null)
            authStore.setCurrentTeamIdLocal(null)
          }
        },
        () => {
          membershipStore.rollbackMemberships(previousMemberships)
          queryClient.setQueryData(teamKey, previousTeamDoc)
          if (isCurrent) {
            authStore.setCurrentTeamIdLocal(previousTeamId ?? null)
          }
        },
        async () => {
          // Photo + nested storage (workspace/group avatars, attachments)
          // cleanup is handled server-side by the deleteTeam callable (a prefix
          // sweep) — admin SDK, so it avoids the post-delete access-revocation
          // race the client-side delete previously had to work around.
          await deleteTeamFn({ teamId })
        }
      )
    } finally {
      setTimeout(() => removePending(pendingTeamIds, teamId), 120)
    }
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

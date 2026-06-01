/**
 * Team Store - Team CRUD Operations
 *
 * Handles:
 * - Team creation, update, deletion
 * - Current team selection and switching
 * - Team photo management
 *
 * Dependencies:
 * - authStore: User authentication and profile
 * - membershipStore: Team memberships and members
 *
 * Reactive Firestore reads flow through TanStack Query (onSnapshot-backed).
 * All mutations go through Cloud Functions for automatic audit logging.
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
  } = storeToRefs(membershipStore)

  // ============================================================================
  // Realtime Firestore bindings (TanStack Query)
  // ============================================================================

  // Computed document reference - null when no team selected
  const teamDocRef = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null

    // Ensure user is actually a member of this team before attempting to read
    // This prevents "Missing or insufficient permissions" errors if the user was removed
    const hasMembership = memberships.value.some((m) => m.teamId === teamId)
    if (!hasMembership) return null

    return getTeamRef(teamId)
  })

  // Realtime document binding (TanStack Query + onSnapshot) for current team.
  const teamQuery = useDocumentQuery<ITeam>(teamDocRef)
  const firestoreCurrentTeam: ComputedRef<ITeam | null | undefined> = computed(
    () => teamQuery.data.value
  )
  const isFirestoreLoading: ComputedRef<boolean> = computed(
    () => teamQuery.isLoading.value
  )

  // ============================================================================
  // State (for optimistic updates)
  // ============================================================================

  // Pending operation tracking
  const pendingTeamIds = shallowRef(createPendingSet())

  const teamDocKey = (teamId: string): FirestoreQueryKey =>
    queryKeys.doc(`teams/${teamId}`)

  // Drives team-doc writes (update/delete; create seeds a temp doc then the
  // real one). Selection (currentTeamId) stays on authStore's Pinia overlay.
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

  // ============================================================================
  // Computed
  // ============================================================================

  // Current team straight from the realtime cache, falling back to the
  // denormalized `team` snapshot on the membership row for instant display
  // before the team-doc query resolves (cold-start is covered by the persisted
  // cache + this fallback). update/delete apply their optimistic value into the
  // team-doc cache (held until the server ack reconciles).
  // Annotated `ITeam | null`: the membership fallback is a `team` snapshot
  // (a `pick` of the team schema, no `billing`), which is assignable to ITeam
  // since `billing` is optional — so `currentTeam.billing` stays `undefined`
  // while the snapshot shows, exactly as before, until the team-doc query lands.
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
    // Still loading if auth/user profile is loading
    if (isAuthLoading.value) {
      return true
    }
    // If user has a currentTeamId, wait for team data to load
    const teamId = currentTeamId.value
    if (teamId) {
      return isFirestoreLoading.value && !currentTeam.value
    }
    // No team selected - not loading
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

  // Handle stale currentTeamId (e.g. team deleted by owner or membership removed)
  watch(
    [
      currentTeamId,
      firestoreCurrentTeam,
      isFirestoreLoading,
      isMembershipLoading,
    ],
    async ([teamId, team, loading, membershipLoading]) => {
      if (!teamId || loading || membershipLoading) return

      // The query emits `undefined` between docRef becoming non-null and the
      // first snapshot landing. Only `null` signals "team genuinely missing".
      // Without this distinction the watch can warn-log on the loading window
      // and (in narrow timing windows) clear a valid currentTeamId.
      if (team === undefined) return

      // If Firestore confirmed the team doesn't exist and we don't have a
      // pending operation for this team
      if (team === null && !pendingTeamIds.value.has(teamId)) {
        console.warn(
          "[teamStore] Detected stale team ID (team deleted or membership removed), clearing...",
          teamId
        )
        // Verify one more time that we really don't have membership
        const hasMembership = memberships.value.some((m) => m.teamId === teamId)
        if (!hasMembership) {
          try {
            await authStore.setCurrentTeamId(null)
          } catch (error) {
            console.error(
              "[teamStore] Failed to clear stale currentTeamId:",
              error
            )
            authStore.setCurrentTeamIdLocal(null)
          }
        }
      }
    }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    authStore.cleanup()
    membershipStore.cleanup()
  }

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Create a new team with optimistic update.
   * Uses Cloud Function for automatic audit logging.
   */
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

    // Generate a temporary ID for optimistic update - will be replaced by server
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const now = Timestamp.now()

    // Photo upload happens after team creation since we need the real team ID.
    const photoURL: string | null = null

    const newTeam: ITeam = {
      id: tempId,
      name,
      photoURL,
      username: null,
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    }

    const creatorUid = currentUser.value!.uid
    const previousCurrentTeamId = currentTeamId.value
    const previousMemberships = cloneState(memberships.value)
    const previousTeamMembers = cloneState(teamMembers.value)
    const tempKey = teamDocKey(tempId)

    let actualTeamId: string | undefined
    let resolvedPhotoURL: string | null = photoURL
    let resolvedUsername: string | null = null
    let resolvedIsPublic = false

    addPending(pendingTeamIds, tempId)
    addPending(pendingUserIds, creatorUid)
    try {
      await runTeamMutation(
        [tempKey],
        () => {
          // Seed the temp team doc + select it (selection = Pinia overlay).
          queryClient.setQueryData<ITeam>(tempKey, newTeam)
          authStore.setCurrentTeamIdLocal(tempId)
        },
        () => {
          queryClient.removeQueries({ queryKey: tempKey, exact: true })
          authStore.setCurrentTeamIdLocal(previousCurrentTeamId ?? null)
          membershipStore.rollbackMemberships(previousMemberships)
          membershipStore.rollbackTeamMembers(previousTeamMembers)
        },
        async () => {
          const result = await createTeamFn({ name, photoURL })
          actualTeamId = result.data.teamId

          // Best-effort photo upload after the team exists.
          if (photoFile && actualTeamId) {
            try {
              const uploadedPhotoURL = await uploadTeamPhoto(
                actualTeamId,
                photoFile
              )
              await updateTeamFn({
                teamId: actualTeamId,
                photoURL: uploadedPhotoURL,
              })
              resolvedPhotoURL = uploadedPhotoURL
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

          // Seed the real team doc + switch the selection to the server id.
          queryClient.setQueryData<ITeam>(teamDocKey(actualTeamId), {
            ...newTeam,
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

  /**
   * Switch to a different team with optimistic update
   */
  async function switchTeam(teamId: string): Promise<void> {
    if (!currentUser.value || !userProfile.value) return
    if (currentTeamId.value === teamId) return

    // Selection is the Pinia overlay (authStore). `currentTeam` falls back to
    // the target team's denormalized membership snapshot for instant display,
    // and authStore.setCurrentTeamId rolls the selection back on error.
    await authStore.setCurrentTeamId(teamId)
  }

  /**
   * Update team details with optimistic update.
   * Uses Cloud Function for automatic audit logging.
   */
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

    // Check if user is owner of the team (using centralized permissions)
    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership || !roleCan(membership.role, Capabilities.EDIT_TEAM)) {
      throw new Error("Only team owners and admins can update team details")
    }

    const { name, photoFile, username, isPublic } = updates
    const optimisticPhotoURL =
      photoFile instanceof File ? URL.createObjectURL(photoFile) : undefined

    // Prepare optimistic updates for team data
    const teamUpdates: Partial<ITeam> = {
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
    const previousTeamDoc = queryClient.getQueryData<ITeam>(teamKey)
    const previousMemberships = cloneState(memberships.value)
    let resolvedPhotoURL: string | null | undefined =
      photoFile === null ? null : undefined

    // Patch the team-doc cache + the denormalized copy on the membership rows.
    const patchTeam = (patch: Partial<ITeam>) => {
      const current = queryClient.getQueryData<ITeam>(teamKey)
      if (current) {
        queryClient.setQueryData<ITeam>(teamKey, { ...current, ...patch })
      }
      membershipStore.updateTeamInMemberships(teamId, patch)
    }

    addPending(pendingTeamIds, teamId)
    try {
      await runTeamMutation(
        [teamKey],
        () => patchTeam(teamUpdates),
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

          // Replace the optimistic blob URL with the uploaded URL.
          if (photoFile !== undefined && resolvedPhotoURL !== undefined) {
            patchTeam({ photoURL: resolvedPhotoURL })
          }

          // Clean up the storage object when the photo is explicitly removed.
          if (resolvedPhotoURL === null) {
            await deleteTeamPhotoFile(teamId)
          }
        }
      )
    } finally {
      if (optimisticPhotoURL) {
        URL.revokeObjectURL(optimisticPhotoURL)
      }
      setTimeout(() => removePending(pendingTeamIds, teamId), 120)
    }
  }

  /**
   * Delete a team with optimistic update.
   * Uses Cloud Function for automatic audit logging.
   */
  async function deleteTeam(teamId: string): Promise<void> {
    if (!currentUser.value) return

    // Check if user is owner of the team (using centralized permissions)
    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership || !roleCan(membership.role, Capabilities.DELETE_TEAM)) {
      throw new Error("Only team owners can delete the team")
    }

    const teamKey = teamDocKey(teamId)
    const previousMemberships = cloneState(memberships.value)
    const previousTeamDoc = queryClient.getQueryData<ITeam>(teamKey)
    const previousCurrentTeamId = currentTeamId.value
    const isCurrent = currentTeam.value?.id === teamId

    addPending(pendingTeamIds, teamId)
    try {
      await runTeamMutation(
        [teamKey],
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
            authStore.setCurrentTeamIdLocal(previousCurrentTeamId ?? null)
          }
        },
        async () => {
          // Delete storage files before the cloud function (which may revoke
          // permission before the storage cleanup could run).
          await deleteTeamPhotoFile(teamId)
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

    // Pending state
    pendingTeamIds,
    pendingUserIds,
    pendingMembershipIds,

    // Computed
    isTeamPending,
    isUserPending: authStore.isUserPending,
    isMembershipPending: membershipStore.isMembershipPending,
    hasAnyPendingOperation,

    // Team Actions
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

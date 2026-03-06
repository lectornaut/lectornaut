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
 * Uses VueFire composables for reactive Firestore bindings.
 * All mutations go through Cloud Functions for automatic audit logging.
 */

import {
  createTeam as createTeamFn,
  deleteTeam as deleteTeamFn,
  updateTeam as updateTeamFn,
} from "@/composables/useFunctions"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { ITeam } from "@/types/domain"
import { Capabilities, roleCan } from "@/types/permissions"
import {
  deleteTeamPhotoFile,
  getTeamRef,
  uploadTeamPhoto,
} from "@/utils/firebase/firebase-helpers"
import {
  addPending,
  cloneState,
  createPendingSet,
  removePending,
  withOptimisticUpdate,
} from "@/utils/firebase/firebase-optimistic"
import { Timestamp } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { useDocument } from "vuefire"

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
  // VueFire Reactive Bindings
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

  // VueFire reactive document binding for current team
  // Use intermediate variables with type assertions to isolate VueFire types
  const _vuefireTeamDoc = useDocument<ITeam>(teamDocRef)
  const firestoreCurrentTeam: ComputedRef<ITeam | null | undefined> = computed(
    () => _vuefireTeamDoc.data.value
  )
  const isFirestoreLoading: ComputedRef<boolean> = computed(
    () => _vuefireTeamDoc.pending.value
  )

  // ============================================================================
  // State (for optimistic updates)
  // ============================================================================

  // Local team that can be optimistically updated
  const optimisticCurrentTeam = ref<ITeam | null>(null)

  // Pending operation tracking
  const pendingTeamIds = shallowRef(createPendingSet())

  // ============================================================================
  // Computed
  // ============================================================================

  // Merged current team: optimistic updates take precedence when pending
  const currentTeam = computed({
    get: () => {
      const teamId = currentTeamId.value
      // Return null if no team is selected
      if (!teamId) {
        return null
      }
      if (pendingTeamIds.value.has(teamId)) {
        return optimisticCurrentTeam.value
      }
      return firestoreCurrentTeam.value ?? optimisticCurrentTeam.value
    },
    set: (value) => {
      optimisticCurrentTeam.value = value
    },
  })

  const isLoading = computed(() => {
    // Still loading if auth/user profile is loading
    if (isAuthLoading.value) {
      return true
    }
    // If user has a currentTeamId, wait for team data to load
    const teamId = currentTeamId.value
    if (teamId) {
      return isFirestoreLoading.value && !optimisticCurrentTeam.value
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

  // ============================================================================
  // Sync Optimistic State with Firestore
  // ============================================================================

  // Sync optimistic team with Firestore data when not pending
  watch(
    firestoreCurrentTeam,
    (team) => {
      const teamId = currentTeamId.value
      if (team && teamId && !pendingTeamIds.value.has(teamId)) {
        optimisticCurrentTeam.value = team
      }
    },
    { immediate: true }
  )

  // Also try to get team from cached memberships for faster initial load
  watch(
    currentTeamId,
    (teamId) => {
      if (!teamId) {
        optimisticCurrentTeam.value = null
        return
      }

      // Skip if team has pending operations or already have data
      if (pendingTeamIds.value.has(teamId) || firestoreCurrentTeam.value) {
        return
      }

      // Try to get team from cached memberships first (optimistic)
      const cachedMembership = memberships.value.find(
        (m) => m.teamId === teamId
      )
      if (cachedMembership?.team) {
        optimisticCurrentTeam.value = cachedMembership.team
      }
    },
    { immediate: true }
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

      // If we have a teamId but no team data, and we're not loading,
      // and we don't have a pending operation for this team
      if (!team && !pendingTeamIds.value.has(teamId)) {
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
          optimisticCurrentTeam.value = null
        }
      }
    }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    optimisticCurrentTeam.value = null
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

    // Clone previous state for rollback
    const previousCurrentTeamId = currentTeamId.value
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousMemberships = cloneState(memberships.value)
    const previousTeamMembers = cloneState(teamMembers.value)

    let actualTeamId: string | undefined
    let resolvedPhotoURL: string | null = photoURL
    let resolvedUsername: string | null = null
    let resolvedIsPublic = false

    await withOptimisticUpdate(
      pendingTeamIds,
      tempId,
      // Apply optimistic updates
      () => {
        addPending(pendingUserIds, currentUser.value!.uid)

        // Update user profile through authStore (optimistically)
        authStore.setCurrentTeamIdLocal(tempId)
        optimisticCurrentTeam.value = newTeam
      },
      // Rollback on error
      () => {
        authStore.setCurrentTeamIdLocal(previousCurrentTeamId ?? null)
        optimisticCurrentTeam.value = previousCurrentTeam
        membershipStore.rollbackMemberships(previousMemberships)
        membershipStore.rollbackTeamMembers(previousTeamMembers)
        removePending(pendingUserIds, currentUser.value!.uid)
      },
      // Cloud Function call
      async () => {
        try {
          const result = await createTeamFn({ name, photoURL })
          actualTeamId = result.data.teamId

          // If photo was provided, upload it now and update the team
          if (photoFile && actualTeamId) {
            try {
              const uploadedPhotoURL = await uploadTeamPhoto(
                actualTeamId,
                photoFile
              )
              // Update team with photo URL using cloud function
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
              if (username !== undefined) {
                resolvedUsername = username
              }
              if (isPublic !== undefined) {
                resolvedIsPublic = isPublic
              }
            } catch (error) {
              console.error(
                "[teamStore] Error applying public team settings:",
                error
              )
            }
          }

          // Update local state with actual team ID
          optimisticCurrentTeam.value = {
            ...newTeam,
            id: actualTeamId,
            photoURL: resolvedPhotoURL,
            username: resolvedUsername,
            isPublic: resolvedIsPublic,
          }
          authStore.setCurrentTeamIdLocal(actualTeamId)
        } finally {
          removePending(pendingUserIds, currentUser.value!.uid)
        }
      }
    )

    return actualTeamId
  }

  /**
   * Switch to a different team with optimistic update
   */
  async function switchTeam(teamId: string): Promise<void> {
    if (!currentUser.value || !userProfile.value) return
    if (currentTeamId.value === teamId) return

    // Clone previous state for rollback
    const previousCurrentTeam = cloneState(currentTeam.value)

    const cachedMembership = memberships.value.find((m) => m.teamId === teamId)

    if (cachedMembership?.team) {
      optimisticCurrentTeam.value = cloneState(cachedMembership.team)
    }

    try {
      await authStore.setCurrentTeamId(teamId)
    } catch (error) {
      optimisticCurrentTeam.value = previousCurrentTeam
      throw error
    }
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

    // Clone previous state for rollback
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousMemberships = cloneState(memberships.value)
    let resolvedPhotoURL: string | null | undefined =
      photoFile === null ? null : undefined

    try {
      await withOptimisticUpdate(
        pendingTeamIds,
        teamId,
        // Apply optimistic update
        () => {
          if (currentTeam.value?.id === teamId) {
            optimisticCurrentTeam.value = {
              ...currentTeam.value,
              ...teamUpdates,
            }
          }
          membershipStore.updateTeamInMemberships(teamId, teamUpdates)
        },
        // Rollback on error
        () => {
          optimisticCurrentTeam.value = previousCurrentTeam
          membershipStore.rollbackMemberships(previousMemberships)
        },
        // Cloud Function call
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
            const syncedTeamUpdates = { photoURL: resolvedPhotoURL }
            if (currentTeam.value?.id === teamId) {
              optimisticCurrentTeam.value = {
                ...currentTeam.value,
                ...syncedTeamUpdates,
              }
            }
            membershipStore.updateTeamInMemberships(teamId, syncedTeamUpdates)
          }

          // Cleanup photo object when profile picture is explicitly removed.
          if (resolvedPhotoURL === null) {
            await deleteTeamPhotoFile(teamId)
          }
        }
      )
    } finally {
      if (optimisticPhotoURL) {
        URL.revokeObjectURL(optimisticPhotoURL)
      }
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

    // Clone previous state for rollback
    const previousMemberships = cloneState(memberships.value)
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousCurrentTeamId = currentTeamId.value

    await withOptimisticUpdate(
      pendingTeamIds,
      teamId,
      // Apply optimistic update
      () => {
        membershipStore.removeMembershipsForTeam(teamId)
        if (currentTeam.value?.id === teamId) {
          optimisticCurrentTeam.value = null
          authStore.setCurrentTeamIdLocal(null)
        }
      },
      // Rollback on error
      () => {
        membershipStore.rollbackMemberships(previousMemberships)
        optimisticCurrentTeam.value = previousCurrentTeam
        authStore.setCurrentTeamIdLocal(previousCurrentTeamId ?? null)
      },
      // Cloud Function call + Storage cleanup
      async () => {
        // Delete storage files before calling cloud function
        // (cloud function may revoke permission before storage cleanup)
        await deleteTeamPhotoFile(teamId)

        // Call cloud function to delete team, workspaces, and memberships
        await deleteTeamFn({ teamId })
      }
    )
  }

  async function clearCurrentTeam(): Promise<void> {
    await authStore.setCurrentTeamId(null)
    optimisticCurrentTeam.value = null
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

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
 * Uses VueFire composables for reactive Firestore bindings
 */

import { firestore, storage } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { ITeam } from "@/types"
import {
  createTeamMembershipsQuery,
  createTeamWorkspacesQuery,
  getMembershipRef,
  getTeamRef,
  getUserRef,
  processInBatches,
  updateTeamInAllMemberships,
  uploadTeamPhoto,
} from "@/utils/firebase-helpers"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/firebase-optimistic"
import { canPerformTeamAction } from "@/utils/permissions"
import {
  collection,
  deleteDoc,
  doc,
  type FieldValue,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Timestamp,
  updateDoc,
} from "firebase/firestore"
import { deleteObject, ref as storageRef } from "firebase/storage"
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
          await authStore.setCurrentTeamId(null)
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
   * Create a new team with optimistic update
   */
  async function createTeam(name: string, photoFile?: File): Promise<void> {
    if (!currentUser.value || !userProfile.value) return

    const teamRef = doc(collection(firestore, "teams"))
    const teamId = teamRef.id
    const timestamp = serverTimestamp()

    // Clone previous state for rollback
    const previousUserProfile = cloneState(userProfile.value)
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousMemberships = cloneState(memberships.value)
    const previousTeamMembers = cloneState(teamMembers.value)

    let photoURL: string | null = null
    if (photoFile) {
      try {
        photoURL = await uploadTeamPhoto(teamId, photoFile)
      } catch (error) {
        console.error("[teamStore] Error uploading team photo:", error)
      }
    }

    const newTeam: ITeam = {
      id: teamId,
      name,
      photoURL,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    const newMembership = await membershipStore.createOwnerMembership(
      teamId,
      newTeam
    )
    const membershipKey = `${teamId}-${currentUser.value.uid}`

    await withOptimisticUpdate(
      pendingTeamIds.value,
      teamId,
      // Apply optimistic updates
      () => {
        pendingUserIds.value.add(currentUser.value!.uid)
        membershipStore.markPending(membershipKey)

        // Update user profile through authStore (optimistically)
        authStore.setCurrentTeamId(teamId)
        optimisticCurrentTeam.value = newTeam
        membershipStore.addMembershipOptimistic(newMembership)
      },
      // Rollback on error
      () => {
        authStore.setCurrentTeamId(previousUserProfile?.currentTeamId ?? null)
        optimisticCurrentTeam.value = previousCurrentTeam
        membershipStore.rollbackMemberships(previousMemberships)
        membershipStore.rollbackTeamMembers(previousTeamMembers)
      },
      // Firestore operation
      async () => {
        try {
          await runTransaction(firestore, async (transaction) => {
            transaction.set(teamRef, newTeam)
            transaction.set(
              getMembershipRef(teamId, currentUser.value!.uid),
              newMembership
            )
            transaction.update(getUserRef(currentUser.value!.uid), {
              currentTeamId: teamId,
              updatedAt: serverTimestamp(),
            })
          })
        } finally {
          pendingUserIds.value.delete(currentUser.value!.uid)
          membershipStore.clearPending(membershipKey)
        }
      }
    )
  }

  /**
   * Switch to a different team with optimistic update
   */
  async function switchTeam(teamId: string): Promise<void> {
    if (!currentUser.value || !userProfile.value) return

    // Clone previous state for rollback
    const previousCurrentTeam = cloneState(currentTeam.value)

    const cachedMembership = memberships.value.find((m) => m.teamId === teamId)

    await withOptimisticUpdate(
      pendingUserIds.value,
      currentUser.value.uid,
      // Apply optimistic update
      () => {
        if (cachedMembership?.team) {
          optimisticCurrentTeam.value = cloneState(cachedMembership.team)
        }
        authStore.setCurrentTeamId(teamId)
      },
      // Rollback on error
      () => {
        authStore.setCurrentTeamId(
          userProfile.value?.currentTeamId ?? previousCurrentTeam?.id ?? null
        )
        optimisticCurrentTeam.value = previousCurrentTeam
      },
      // Firestore operation
      async () => {
        await updateDoc(getUserRef(currentUser.value!.uid), {
          currentTeamId: teamId,
          updatedAt: serverTimestamp(),
        })
      }
    )
  }

  /**
   * Update team details with optimistic update
   */
  async function updateTeam(
    teamId: string,
    updates: { name?: string; photoFile?: File | null }
  ): Promise<void> {
    if (!currentUser.value) return

    // Check if user is owner of the team (using centralized permissions)
    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership || !canPerformTeamAction(membership.role, "update")) {
      throw new Error("Only team owners can update team details")
    }

    const { name, photoFile } = updates
    const updateData: {
      name?: string
      photoURL?: string | null
      updatedAt: FieldValue
    } = {
      updatedAt: serverTimestamp(),
    }

    if (name) updateData.name = name

    // Upload photo first if provided (outside of optimistic update to get URL)
    if (photoFile !== undefined) {
      updateData.photoURL =
        photoFile === null ? null : await uploadTeamPhoto(teamId, photoFile)
    }

    // Prepare optimistic updates for team data
    const teamUpdates = {
      ...(name ? { name } : {}),
      ...(updateData.photoURL !== undefined
        ? { photoURL: updateData.photoURL }
        : {}),
    }

    // Clone previous state for rollback
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousMemberships = cloneState(memberships.value)

    await withOptimisticUpdate(
      pendingTeamIds.value,
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
      // Firestore operation - run in parallel
      async () => {
        await Promise.all([
          updateDoc(getTeamRef(teamId), updateData),
          updateTeamInAllMemberships(teamId, updateData),
        ])
      }
    )
  }

  /**
   * Delete a team with optimistic update
   */
  async function deleteTeam(teamId: string): Promise<void> {
    if (!currentUser.value) return

    // Check if user is owner of the team (using centralized permissions)
    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership || !canPerformTeamAction(membership.role, "delete")) {
      throw new Error("Only team owners can delete the team")
    }

    // Clone previous state for rollback
    const previousMemberships = cloneState(memberships.value)
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousUserProfile = cloneState(userProfile.value)

    await withOptimisticUpdate(
      pendingTeamIds.value,
      teamId,
      // Apply optimistic update
      () => {
        membershipStore.removeMembershipsForTeam(teamId)
        if (currentTeam.value?.id === teamId) {
          optimisticCurrentTeam.value = null
          authStore.setCurrentTeamId(null)
        }
      },
      // Rollback on error
      () => {
        membershipStore.rollbackMemberships(previousMemberships)
        optimisticCurrentTeam.value = previousCurrentTeam
        authStore.setCurrentTeamId(previousUserProfile?.currentTeamId ?? null)
      },
      // Firestore operation
      async () => {
        // Fetch all related documents
        // We do this first to ensure we have references before we start deleting
        const [membershipDocs, workspaceDocs] = await Promise.all([
          getDocs(createTeamMembershipsQuery(teamId)),
          getDocs(createTeamWorkspacesQuery(teamId)),
        ])

        // Identify current user's membership to delete LAST
        const otherMemberDocs = membershipDocs.docs.filter(
          (d) => d.id !== currentUser.value!.uid
        )
        const currentUserMemberDoc = membershipDocs.docs.find(
          (d) => d.id === currentUser.value!.uid
        )

        // 1. Cleanup Storage (Images)
        // These operations rely on "storage.rules" checking Firestore membership
        // So we MUST validity/existence of the membership during these calls.
        const storagePromises: Promise<void>[] = []

        // Team Photo
        storagePromises.push(
          deleteObject(
            storageRef(storage, `teams/${teamId}/profilePhoto`)
          ).catch(() => {}) // Ignore if not exists
        )

        // Workspace Photos
        workspaceDocs.docs.forEach((doc) => {
          storagePromises.push(
            deleteObject(
              storageRef(
                storage,
                `teams/${teamId}/workspaces/${doc.id}/profilePhoto`
              )
            ).catch(() => {}) // Ignore if not exists
          )
        })

        // Wait for storage cleanup to finish before removing permissions (membership)
        await Promise.all(storagePromises)

        // 2. Delete Workspaces
        // Rule: allow write: if hasRole(...)
        if (!workspaceDocs.empty) {
          await processInBatches(workspaceDocs.docs, (docSnap, batch) =>
            batch.delete(docSnap.ref)
          )
        }

        // 3. Delete Other Memberships
        // Rule: allow delete: if hasRole(...)
        if (otherMemberDocs.length > 0) {
          await processInBatches(otherMemberDocs, (docSnap, batch) =>
            batch.delete(docSnap.ref)
          )
        }

        // 4. Delete Team Document
        // Rule: allow delete: if hasRole(...)
        await deleteDoc(getTeamRef(teamId))

        // 5. Delete Current User Membership
        // We do this last because "hasRole" checks existence of THIS document
        if (currentUserMemberDoc) {
          await deleteDoc(currentUserMemberDoc.ref)
        }

        // 6. Update Current User Profile
        // We CANNOT update other users' profiles (rule: allow update: if isUser(userId))
        // They will have a stale currentTeamId, which the app must handle gracefully
        if (userProfile.value?.currentTeamId === teamId) {
          await updateDoc(getUserRef(currentUser.value!.uid), {
            currentTeamId: null,
            currentWorkspaceId: null,
            updatedAt: serverTimestamp(),
          })
        }
      }
    )
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
    clearCurrentTeam: () => {
      optimisticCurrentTeam.value = null
      membershipStore.clearTeamMembers()
      authStore.setCurrentTeamId(null)
    },

    // Lifecycle
    cleanup,
  }
})

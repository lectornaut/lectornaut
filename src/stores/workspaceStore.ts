/**
 * Workspace Store - Workspace CRUD Operations
 *
 * Handles:
 * - Workspace creation, update, deletion (owner or member)
 * - Current workspace selection and switching (all members)
 * - Workspaces for the current team
 *
 * Dependencies:
 * - authStore: User authentication and profile
 * - teamStore: Current team information
 * - membershipStore: User's role in team
 *
 * Uses VueFire composables for reactive Firestore bindings.
 * All mutations go through Cloud Functions for automatic audit logging.
 */

import {
  createWorkspace as createWorkspaceFn,
  deleteWorkspace as deleteWorkspaceFn,
  updateWorkspace as updateWorkspaceFn,
} from "@/composables/useFunctions"
import { storage } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IWorkspace } from "@/types"
import {
  createTeamWorkspacesQuery,
  getUserRef,
  uploadWorkspacePhoto,
} from "@/utils/firebase-helpers"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/firebase-optimistic"
import { serverTimestamp, type Timestamp, updateDoc } from "firebase/firestore"
import { deleteObject, ref as storageRef } from "firebase/storage"
import { defineStore, storeToRefs } from "pinia"
import { useCollection } from "vuefire"

export const useWorkspaceStore = defineStore("workspaces", () => {
  const authStore = useAuthStore()
  const membershipStore = useMembershipStore()

  const {
    currentUser,
    userProfile,
    pendingUserIds,
    currentTeamId,
    currentWorkspaceId,
  } = storeToRefs(authStore)
  const { canManageWorkspaces } = storeToRefs(membershipStore)

  // ============================================================================
  // VueFire Reactive Bindings
  // ============================================================================

  // Query for workspaces in current team - null when no team selected
  const workspacesQueryRef = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null

    // Guard: Ensure user is a member of the team before trying to list its workspaces.
    const isMember = membershipStore.memberships.some(
      (m) => m.teamId === teamId
    )
    if (!isMember) return null

    return createTeamWorkspacesQuery(teamId)
  })

  // VueFire reactive collection binding for workspaces
  const _vuefireWorkspaces = useCollection<IWorkspace>(workspacesQueryRef)
  const firestoreWorkspaces: ComputedRef<IWorkspace[]> = computed(
    () => _vuefireWorkspaces.data.value ?? []
  )
  const isFirestoreLoading: ComputedRef<boolean> = computed(
    () => _vuefireWorkspaces.pending.value
  )

  // ============================================================================
  // State (for optimistic updates)
  // ============================================================================

  /** Local workspaces that can be optimistically updated */
  const optimisticWorkspaces = ref<IWorkspace[]>([])

  // Pending operation tracking
  const pendingWorkspaceIds = shallowRef(createPendingSet())

  // ============================================================================
  // Computed - Merged State
  // ============================================================================

  /** All workspaces for the current team */
  const workspaces = computed({
    get: () => {
      const pending = pendingWorkspaceIds.value
      if (pending.size === 0) {
        return firestoreWorkspaces.value
      }

      // Merge Firestore data with optimistic updates
      const result: IWorkspace[] = []
      const firestoreData = firestoreWorkspaces.value

      // Add Firestore workspaces, replacing with optimistic if pending
      firestoreData.forEach((w) => {
        if (pending.has(w.id)) {
          const optimistic = optimisticWorkspaces.value.find(
            (ow) => ow.id === w.id
          )
          if (optimistic) {
            result.push(optimistic)
            return
          }
        }
        result.push(w)
      })

      // Add any optimistically added workspaces not yet in Firestore
      optimisticWorkspaces.value.forEach((w) => {
        if (pending.has(w.id) && !result.some((r) => r.id === w.id)) {
          result.push(w)
        }
      })

      return result
    },
    set: (value) => {
      optimisticWorkspaces.value = value
    },
  })

  /** Current workspace based on user's selection */
  const currentWorkspace = computed(() => {
    const workspaceId = currentWorkspaceId.value
    if (!workspaceId) return null
    return workspaces.value.find((w) => w.id === workspaceId) ?? null
  })

  const isLoading = computed(() => {
    // If no team selected, not loading
    if (!currentTeamId.value) return false
    return isFirestoreLoading.value && optimisticWorkspaces.value.length === 0
  })

  const isWorkspacePending = computed(
    () => (id: string) => pendingWorkspaceIds.value.has(id)
  )

  const hasAnyPendingOperation = computed(
    () => pendingWorkspaceIds.value.size > 0
  )

  // ============================================================================
  // Sync Optimistic State with Firestore
  // ============================================================================

  // Sync optimistic workspaces with Firestore data when not pending
  watch(
    firestoreWorkspaces,
    (data) => {
      if (data && pendingWorkspaceIds.value.size === 0) {
        optimisticWorkspaces.value = [...data]
      }
    },
    { immediate: true }
  )

  // Handle stale currentWorkspaceId (e.g. workspace deleted)
  watch(
    [currentWorkspaceId, workspaces, isLoading],
    ([workspaceId, workspaceList, loading]) => {
      // If we are loading, or no workspace ID selected, ignore
      if (!workspaceId || loading) return

      // Check if the current workspace exists in the list
      const exists = workspaceList.some((w) => w.id === workspaceId)

      // If it doesn't exist and we don't have a pending operation for it
      if (!exists && !pendingWorkspaceIds.value.has(workspaceId)) {
        console.warn(
          "[workspaceStore] Detected stale workspace ID, clearing...",
          workspaceId
        )
        authStore.setCurrentWorkspaceId(null)
      }
    }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    optimisticWorkspaces.value = []
  }

  // Watch for team change to cleanup
  watch(currentTeamId, (teamId) => {
    if (!teamId) {
      cleanup()
      authStore.setCurrentWorkspaceId(null)
    }
  })

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Create a new workspace with optimistic update (owner or member).
   * Uses Cloud Function for automatic audit logging.
   */
  async function createWorkspace(
    name: string,
    description?: string,
    _photoFile?: File
  ): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    // Check if user can manage workspaces (owner or member)
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and members can create workspaces")
    }

    const teamId = currentTeamId.value
    // Generate a temporary ID for optimistic update - will be replaced by server
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timestamp = serverTimestamp()

    // Note: Photo upload is handled separately after workspace creation
    // TODO: Handle photo upload after workspace is created

    const newWorkspace: IWorkspace = {
      id: tempId,
      teamId,
      name,
      description: description ?? null,
      photoURL: null,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    // Clone previous state for rollback
    const previousWorkspaces = cloneState(workspaces.value)
    const previousUserProfile = cloneState(userProfile.value)

    let actualWorkspaceId: string | null = null

    await withOptimisticUpdate(
      pendingWorkspaceIds.value,
      tempId,
      // Apply optimistic update
      () => {
        optimisticWorkspaces.value = [...workspaces.value, newWorkspace]
        // Auto-select the new workspace (will be updated to actual ID)
        pendingUserIds.value.add(currentUser.value!.uid)
        authStore.setCurrentWorkspaceId(tempId)
      },
      // Rollback on error
      () => {
        optimisticWorkspaces.value = previousWorkspaces
        authStore.setCurrentWorkspaceId(
          previousUserProfile?.currentWorkspaceId ?? null
        )
        pendingUserIds.value.delete(currentUser.value!.uid)
      },
      // Cloud Function call
      async () => {
        try {
          const result = await createWorkspaceFn({
            teamId,
            name,
            description: description ?? null,
          })

          actualWorkspaceId = result.data.workspaceId

          // Update user's current workspace to the actual ID
          await updateDoc(getUserRef(currentUser.value!.uid), {
            currentWorkspaceId: actualWorkspaceId,
            updatedAt: serverTimestamp(),
          })

          // Update local state with actual workspace ID
          authStore.setCurrentWorkspaceId(actualWorkspaceId)
        } finally {
          pendingUserIds.value.delete(currentUser.value!.uid)
        }
      }
    )
  }

  /**
   * Switch to a different workspace with optimistic update (all members)
   */
  async function switchWorkspace(workspaceId: string): Promise<void> {
    if (!currentUser.value || !userProfile.value) return

    // Verify workspace exists in current team
    const workspace = workspaces.value.find((w) => w.id === workspaceId)
    if (!workspace) {
      throw new Error("Workspace not found")
    }

    const previousWorkspaceId = currentWorkspaceId.value

    await withOptimisticUpdate(
      pendingUserIds.value,
      currentUser.value.uid,
      // Apply optimistic update
      () => {
        authStore.setCurrentWorkspaceId(workspaceId)
      },
      // Rollback on error
      () => {
        authStore.setCurrentWorkspaceId(previousWorkspaceId)
      },
      // Firestore operation
      async () => {
        await updateDoc(getUserRef(currentUser.value!.uid), {
          currentWorkspaceId: workspaceId,
          updatedAt: serverTimestamp(),
        })
      }
    )
  }

  /**
   * Update workspace details with optimistic update (owner or member).
   * Uses Cloud Function for automatic audit logging.
   */
  async function updateWorkspace(
    workspaceId: string,
    updates: {
      name?: string
      description?: string | null
      photoFile?: File | null
    }
  ): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    // Check if user can manage workspaces (owner or member)
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and members can update workspaces")
    }

    const teamId = currentTeamId.value
    const { name, description, photoFile } = updates

    // Upload photo first if provided (outside of cloud function)
    let photoURL: string | null | undefined = undefined
    if (photoFile !== undefined) {
      photoURL =
        photoFile === null
          ? null
          : await uploadWorkspacePhoto(teamId, workspaceId, photoFile)
    }

    // Prepare optimistic updates for workspace data
    const workspaceUpdates = {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(photoURL !== undefined ? { photoURL } : {}),
    }

    // Clone previous state for rollback
    const previousWorkspaces = cloneState(workspaces.value)

    await withOptimisticUpdate(
      pendingWorkspaceIds.value,
      workspaceId,
      // Apply optimistic update
      () => {
        optimisticWorkspaces.value = workspaces.value.map((w) =>
          w.id === workspaceId ? { ...w, ...workspaceUpdates } : w
        )
      },
      // Rollback on error
      () => {
        optimisticWorkspaces.value = previousWorkspaces
      },
      // Cloud Function call
      async () => {
        await updateWorkspaceFn({
          teamId,
          workspaceId,
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(photoURL !== undefined ? { photoURL } : {}),
        })
      }
    )
  }

  /**
   * Delete a workspace with optimistic update (owner or member).
   * Uses Cloud Function for automatic audit logging.
   */
  async function deleteWorkspace(workspaceId: string): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    // Check if user can manage workspaces (owner or member)
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and members can delete workspaces")
    }

    const teamId = currentTeamId.value

    // Clone previous state for rollback
    const previousWorkspaces = cloneState(workspaces.value)
    const previousUserProfile = cloneState(userProfile.value)

    const isCurrentWorkspace = currentWorkspaceId.value === workspaceId

    await withOptimisticUpdate(
      pendingWorkspaceIds.value,
      workspaceId,
      // Apply optimistic update
      () => {
        optimisticWorkspaces.value = workspaces.value.filter(
          (w) => w.id !== workspaceId
        )
        if (isCurrentWorkspace) {
          pendingUserIds.value.add(currentUser.value!.uid)
          authStore.setCurrentWorkspaceId(null)
        }
      },
      // Rollback on error
      () => {
        optimisticWorkspaces.value = previousWorkspaces
        if (isCurrentWorkspace) {
          authStore.setCurrentWorkspaceId(
            previousUserProfile?.currentWorkspaceId ?? null
          )
        }
      },
      // Cloud Function call
      async () => {
        try {
          // Cleanup Storage (Profile Photo) - Run in parallel with Cloud Function
          const photoPath = `teams/${teamId}/workspaces/${workspaceId}/profilePhoto`
          const fileRef = storageRef(storage, photoPath)

          await Promise.allSettled([
            deleteWorkspaceFn({ teamId, workspaceId }),
            deleteObject(fileRef),
          ])
        } finally {
          if (isCurrentWorkspace) {
            pendingUserIds.value.delete(currentUser.value!.uid)
          }
        }
      }
    )
  }

  return {
    // State
    workspaces,
    currentWorkspace,
    isLoading,

    // Pending state
    pendingWorkspaceIds,

    // Computed
    isWorkspacePending,
    hasAnyPendingOperation,

    // Actions
    createWorkspace,
    switchWorkspace,
    updateWorkspace,
    deleteWorkspace,

    // Lifecycle
    cleanup,
  }
})

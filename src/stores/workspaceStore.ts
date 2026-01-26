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
 * Uses VueFire composables for reactive Firestore bindings
 */

import { firestore, storage } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IWorkspace } from "@/types"
import {
  createTeamWorkspacesQuery,
  getUserRef,
  getWorkspaceRef,
  uploadWorkspacePhoto,
} from "@/utils/firebase-helpers"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/firebase-optimistic"
import {
  collection,
  deleteDoc,
  doc,
  type FieldValue,
  serverTimestamp,
  setDoc,
  type Timestamp,
  updateDoc,
} from "firebase/firestore"
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
   * Create a new workspace with optimistic update (owner or member)
   */
  async function createWorkspace(
    name: string,
    description?: string,
    photoFile?: File
  ): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    // Check if user can manage workspaces (owner or member)
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and members can create workspaces")
    }

    const workspaceRef = doc(
      collection(firestore, "teams", currentTeamId.value, "workspaces")
    )
    const workspaceId = workspaceRef.id
    const timestamp = serverTimestamp()

    // Upload photo first if provided
    let photoURL: string | null = null
    if (photoFile) {
      try {
        photoURL = await uploadWorkspacePhoto(
          currentTeamId.value,
          workspaceId,
          photoFile
        )
      } catch (error) {
        console.error(
          "[workspaceStore] Error uploading workspace photo:",
          error
        )
      }
    }

    const newWorkspace: IWorkspace = {
      id: workspaceId,
      teamId: currentTeamId.value,
      name,
      description: description ?? null,
      photoURL,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    // Clone previous state for rollback
    const previousWorkspaces = cloneState(workspaces.value)
    const previousUserProfile = cloneState(userProfile.value)

    await withOptimisticUpdate(
      pendingWorkspaceIds.value,
      workspaceId,
      // Apply optimistic update
      () => {
        optimisticWorkspaces.value = [...workspaces.value, newWorkspace]
        // Auto-select the new workspace
        pendingUserIds.value.add(currentUser.value!.uid)
        authStore.setCurrentWorkspaceId(workspaceId)
      },
      // Rollback on error
      () => {
        optimisticWorkspaces.value = previousWorkspaces
        authStore.setCurrentWorkspaceId(
          previousUserProfile?.currentWorkspaceId ?? null
        )
      },
      // Firestore operation
      async () => {
        try {
          await Promise.all([
            setDoc(workspaceRef, newWorkspace),
            updateDoc(getUserRef(currentUser.value!.uid), {
              currentWorkspaceId: workspaceId,
              updatedAt: serverTimestamp(),
            }),
          ])
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
   * Update workspace details with optimistic update (owner or member)
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

    const { name, description, photoFile } = updates
    const updateData: {
      name?: string
      description?: string | null
      photoURL?: string | null
      updatedAt: FieldValue
    } = {
      updatedAt: serverTimestamp(),
    }

    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description

    // Upload photo first if provided (outside of optimistic update to get URL)
    if (photoFile !== undefined) {
      updateData.photoURL =
        photoFile === null
          ? null
          : await uploadWorkspacePhoto(
              currentTeamId.value,
              workspaceId,
              photoFile
            )
    }

    // Prepare optimistic updates for workspace data
    const workspaceUpdates = {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(updateData.photoURL !== undefined
        ? { photoURL: updateData.photoURL }
        : {}),
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
      // Firestore operation
      async () => {
        await updateDoc(
          getWorkspaceRef(currentTeamId.value!, workspaceId),
          updateData
        )
      }
    )
  }

  /**
   * Delete a workspace with optimistic update (owner or member)
   */
  async function deleteWorkspace(workspaceId: string): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    // Check if user can manage workspaces (owner or member)
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and members can delete workspaces")
    }

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
      // Firestore operation
      async () => {
        try {
          // Cleanup Storage (Profile Photo) - Run in parallel with Firestore delete
          const photoPath = `teams/${currentTeamId.value!}/workspaces/${workspaceId}/profilePhoto`
          const fileRef = storageRef(storage, photoPath)

          await Promise.allSettled([
            deleteDoc(getWorkspaceRef(currentTeamId.value!, workspaceId)),
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

/**
 * Workspace Store - Workspace CRUD Operations
 *
 * Handles:
 * - Workspace creation, update, deletion (owner or admin)
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
import { workspacesHydrationSchema } from "@/schemas/domain"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IWorkspace } from "@/types/domain"
import {
  createTeamWorkspacesQuery,
  deleteWorkspacePhotoFile,
  getMembershipPreferencesRef,
  uploadWorkspacePhoto,
} from "@/utils/firebase/firebase-helpers"
import {
  readHydrationCache,
  writeHydrationCache,
} from "@/utils/firebase/firebase-hydration"
import {
  addPending,
  cloneState,
  createPendingSet,
  mergeOptimisticCollection,
  removePending,
  withOptimisticUpdate,
} from "@/utils/firebase/firebase-optimistic"
import {
  mutateSetDocument,
  mutateWithCoordinator,
} from "@/utils/firebase/firebase-sync-engine"
import { Timestamp } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { useCollection } from "vuefire"

const getWorkspacesCacheKey = (teamId: string) => `workspaces:${teamId}`

export const useWorkspaceStore = defineStore("workspaces", () => {
  const authStore = useAuthStore()
  const membershipStore = useMembershipStore()

  const {
    currentUser,
    pendingUserIds,
    currentTeamId,
    currentWorkspaceId,
    hasResolvedCurrentWorkspaceSelection,
  } = storeToRefs(authStore)
  const {
    canManageWorkspaces,
    memberships,
    isLoading: isMembershipLoading,
  } = storeToRefs(membershipStore)

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
  const _vuefireWorkspaces = useCollection<IWorkspace>(workspacesQueryRef, {
    reset: true,
  })
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
  const isPersistingWorkspaceSelection = ref(false)

  async function persistWorkspaceSelection(
    workspaceId: string | null
  ): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    await mutateSetDocument(
      getMembershipPreferencesRef(currentTeamId.value, currentUser.value.uid),
      {
        currentWorkspaceId: workspaceId,
      },
      {
        source: "workspace.persistSelection",
        merge: true,
      }
    )
  }

  const hydrateWorkspacesForTeam = (teamId: string | null) => {
    if (!teamId) {
      optimisticWorkspaces.value = []
      return
    }

    const cacheKey = getWorkspacesCacheKey(teamId)
    const cached = readHydrationCache<IWorkspace[]>(cacheKey, {
      schema: workspacesHydrationSchema,
      context: `hydration:${cacheKey}`,
    })

    optimisticWorkspaces.value = cached ? [...cached] : []
  }

  const persistWorkspacesForTeam = (
    teamId: string | null,
    workspaceList: IWorkspace[]
  ) => {
    if (!teamId) return
    writeHydrationCache(getWorkspacesCacheKey(teamId), workspaceList)
  }

  // ============================================================================
  // Computed - Merged State
  // ============================================================================

  /** All workspaces for the current team */
  const workspaces = computed({
    get: () =>
      mergeOptimisticCollection(
        firestoreWorkspaces.value,
        optimisticWorkspaces.value,
        pendingWorkspaceIds.value
      ),
    set: (value) => {
      optimisticWorkspaces.value = value
    },
  })

  const workspaceById = computed(
    () =>
      new Map(workspaces.value.map((workspace) => [workspace.id, workspace]))
  )

  /** Current workspace based on user's selection */
  const currentWorkspace = computed(() => {
    const workspaceId = currentWorkspaceId.value
    if (!workspaceId) return null
    return workspaceById.value.get(workspaceId) ?? null
  })

  const hasResolvedWorkspaceList = computed(() => {
    if (!currentTeamId.value) return true
    if (optimisticWorkspaces.value.length > 0) return true
    if (isMembershipLoading.value) return false
    if (!workspacesQueryRef.value) return true
    return !isFirestoreLoading.value
  })

  const isLoading = computed(() => {
    if (!currentTeamId.value) return false
    if (optimisticWorkspaces.value.length > 0) return false
    if (isMembershipLoading.value) return true
    if (!workspacesQueryRef.value) return false
    return isFirestoreLoading.value
  })

  // App-shell bootstrap is narrower than list loading: only block while we
  // still don't know the current team's workspace selection or can't map the
  // selected workspace ID to a workspace yet.
  const isBootstrapping = computed(() => {
    if (!currentTeamId.value) return false
    if (currentWorkspaceId.value) {
      return !currentWorkspace.value && !hasResolvedWorkspaceList.value
    }

    return (
      !hasResolvedCurrentWorkspaceSelection.value &&
      !hasResolvedWorkspaceList.value
    )
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
    currentTeamId,
    (teamId, previousTeamId) => {
      if (teamId === previousTeamId && previousTeamId !== undefined) return
      hydrateWorkspacesForTeam(teamId)
    },
    { immediate: true }
  )

  // Sync optimistic state from Firestore only once VueFire has actually
  // fetched for the current team. Guarding on `workspacesQueryRef` and
  // `isFirestoreLoading` prevents the immediate fire from clobbering the
  // hydrated cache with VueFire's initial empty-array default — which
  // previously persisted `[]` to localStorage and left the app shell
  // stuck on the bootstrap spinner when memberships were still loading.
  watch(
    [
      currentTeamId,
      firestoreWorkspaces,
      isFirestoreLoading,
      workspacesQueryRef,
    ],
    ([teamId, data, loading, queryRef]) => {
      if (!teamId || loading || !queryRef) return
      if (pendingWorkspaceIds.value.size > 0) return
      if (data.some((workspace) => workspace.teamId !== teamId)) return

      const nextWorkspaces = [...(data ?? [])]
      optimisticWorkspaces.value = nextWorkspaces
      persistWorkspacesForTeam(teamId, nextWorkspaces)
    },
    { immediate: true }
  )

  // Handle stale currentWorkspaceId (e.g. workspace deleted)
  watch(
    [
      currentWorkspaceId,
      workspaces,
      isLoading,
      currentTeamId,
      isMembershipLoading,
      isFirestoreLoading,
    ],
    async ([
      workspaceId,
      workspaceList,
      loading,
      teamId,
      membershipLoading,
      firestoreLoading,
    ]) => {
      // If we are loading, or no workspace ID selected, ignore.
      // `firestoreLoading` is checked separately from `loading` because the
      // latter shortcuts to false whenever `optimisticWorkspaces` has any
      // items (including cache-hydrated entries). Without this guard, a
      // cold start with a cached selection would fire before the workspaces
      // query resolved, see an empty merged list (the merge drops non-pending
      // optimistic entries), and wipe the user's selection.
      if (
        !workspaceId ||
        loading ||
        !teamId ||
        membershipLoading ||
        firestoreLoading
      ) {
        return
      }

      // Don't clear during startup before membership resolution is ready.
      const isMember = memberships.value.some((m) => m.teamId === teamId)
      if (!isMember) return

      // Check if the current workspace exists in the list
      const exists = workspaceList.some((w) => w.id === workspaceId)

      // Skip while ANY workspace mutation is still pending. During creation,
      // currentWorkspaceId flips from tempId to the server-issued id before
      // Firestore emits the new workspace — guarding on the id alone misses
      // that window and the cleanup here would wipe the freshly-saved
      // selection. The 120ms `pendingReleaseDelayMs` in optimistic commits
      // gives snapshot listeners time to catch up.
      if (
        !exists &&
        pendingWorkspaceIds.value.size === 0 &&
        !isPersistingWorkspaceSelection.value
      ) {
        console.warn(
          "[workspaceStore] Detected stale workspace ID, clearing...",
          workspaceId
        )
        isPersistingWorkspaceSelection.value = true
        try {
          await persistWorkspaceSelection(null)
        } catch (error) {
          console.error(
            "[workspaceStore] Failed to persist stale workspace cleanup:",
            error
          )
        } finally {
          isPersistingWorkspaceSelection.value = false
        }
      }
    }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    optimisticWorkspaces.value = []
  }

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Create a new workspace with optimistic update (owner or admin).
   * Uses Cloud Function for automatic audit logging.
   */
  async function createWorkspace(
    name: string,
    description?: string,
    photoFile?: File
  ): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    // Check if user can manage workspaces (owner or admin)
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and admins can create workspaces")
    }

    const teamId = currentTeamId.value
    // Generate a temporary ID for optimistic update - will be replaced by server
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const now = Timestamp.now()

    const newWorkspace: IWorkspace = {
      id: tempId,
      teamId,
      name,
      description: description ?? null,
      photoURL: null,
      createdAt: now,
      updatedAt: now,
    }

    // Clone previous state for rollback
    const previousWorkspaces = cloneState(workspaces.value)
    const previousWorkspaceId = currentWorkspaceId.value

    let actualWorkspaceId: string | null = null

    await withOptimisticUpdate(
      pendingWorkspaceIds,
      tempId,
      // Apply optimistic update
      () => {
        optimisticWorkspaces.value = [...workspaces.value, newWorkspace]
        // Auto-select the new workspace (will be updated to actual ID)
        addPending(pendingUserIds, currentUser.value!.uid)
        authStore.setCurrentWorkspaceId(tempId)
      },
      // Rollback on error
      () => {
        optimisticWorkspaces.value = previousWorkspaces
        authStore.setCurrentWorkspaceId(previousWorkspaceId ?? null)
        removePending(pendingUserIds, currentUser.value!.uid)
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

          // Best-effort photo upload after workspace exists.
          // Do not fail workspace creation if photo upload/update fails.
          if (photoFile) {
            try {
              const photoURL = await uploadWorkspacePhoto(
                teamId,
                actualWorkspaceId,
                photoFile
              )
              await updateWorkspaceFn({
                teamId,
                workspaceId: actualWorkspaceId,
                photoURL,
              })
            } catch (error) {
              console.error(
                "[workspaceStore] Failed to attach workspace photo after create",
                error
              )
            }
          }

          // Persist workspace selection in the current team membership scope.
          await persistWorkspaceSelection(actualWorkspaceId)

          // Update local state with actual workspace ID
          authStore.setCurrentWorkspaceId(actualWorkspaceId)
        } finally {
          removePending(pendingUserIds, currentUser.value!.uid)
        }
      }
    )
  }

  /**
   * Switch to a different workspace with optimistic update (all members)
   */
  async function switchWorkspace(workspaceId: string): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    // Verify workspace exists in current team
    const workspace = workspaces.value.find((w) => w.id === workspaceId)
    if (!workspace) {
      throw new Error("Workspace not found")
    }

    const previousWorkspaceId = currentWorkspaceId.value

    await mutateWithCoordinator({
      id: currentUser.value.uid,
      source: "workspace.switchWorkspace",
      pendingIds: pendingUserIds,
      applyLocal: () => {
        authStore.setCurrentWorkspaceId(workspaceId)
      },
      rollbackLocal: () => {
        authStore.setCurrentWorkspaceId(previousWorkspaceId)
      },
      mutation: {
        source: "workspace.switchWorkspace",
        targetPath: getMembershipPreferencesRef(
          currentTeamId.value,
          currentUser.value.uid
        ).path,
        type: "set",
        merge: true,
        data: {
          currentWorkspaceId: workspaceId,
        },
      },
    })
  }

  /**
   * Update workspace details with optimistic update (owner or admin).
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

    // Check if user can manage workspaces (owner or admin)
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and admins can update workspaces")
    }

    const teamId = currentTeamId.value
    const { name, description, photoFile } = updates
    const optimisticPhotoURL =
      photoFile instanceof File ? URL.createObjectURL(photoFile) : undefined

    // Prepare optimistic updates for workspace data
    const workspaceUpdates = {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(photoFile === null
        ? { photoURL: null }
        : optimisticPhotoURL
          ? { photoURL: optimisticPhotoURL }
          : {}),
    }

    // Clone previous state for rollback
    const previousWorkspaces = cloneState(workspaces.value)
    let resolvedPhotoURL: string | null | undefined =
      photoFile === null ? null : undefined

    try {
      await withOptimisticUpdate(
        pendingWorkspaceIds,
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
          if (photoFile instanceof File) {
            resolvedPhotoURL = await uploadWorkspacePhoto(
              teamId,
              workspaceId,
              photoFile
            )
          }

          await updateWorkspaceFn({
            teamId,
            workspaceId,
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(photoFile !== undefined
              ? { photoURL: resolvedPhotoURL ?? null }
              : {}),
          })

          if (photoFile !== undefined && resolvedPhotoURL !== undefined) {
            optimisticWorkspaces.value = workspaces.value.map((w) =>
              w.id === workspaceId ? { ...w, photoURL: resolvedPhotoURL } : w
            )
          }

          // Cleanup photo object when profile picture is explicitly removed.
          if (resolvedPhotoURL === null) {
            await deleteWorkspacePhotoFile(teamId, workspaceId)
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
   * Delete a workspace with optimistic update (owner or admin).
   * Uses Cloud Function for automatic audit logging.
   */
  async function deleteWorkspace(workspaceId: string): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    // Check if user can manage workspaces (owner or admin)
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and admins can delete workspaces")
    }

    const teamId = currentTeamId.value

    // Clone previous state for rollback
    const previousWorkspaces = cloneState(workspaces.value)
    const previousWorkspaceId = currentWorkspaceId.value

    const isCurrentWorkspace = currentWorkspaceId.value === workspaceId

    await withOptimisticUpdate(
      pendingWorkspaceIds,
      workspaceId,
      // Apply optimistic update
      () => {
        optimisticWorkspaces.value = workspaces.value.filter(
          (w) => w.id !== workspaceId
        )
        if (isCurrentWorkspace) {
          addPending(pendingUserIds, currentUser.value!.uid)
          authStore.setCurrentWorkspaceId(null)
        }
      },
      // Rollback on error
      () => {
        optimisticWorkspaces.value = previousWorkspaces
        if (isCurrentWorkspace) {
          authStore.setCurrentWorkspaceId(previousWorkspaceId ?? null)
        }
      },
      // Cloud Function call
      async () => {
        try {
          const [deleteWorkspaceResult, deletePhotoResult] =
            await Promise.allSettled([
              deleteWorkspaceFn({ teamId, workspaceId }),
              deleteWorkspacePhotoFile(teamId, workspaceId),
            ])

          if (deletePhotoResult.status === "rejected") {
            console.error(
              "[workspaceStore] Failed to delete workspace photo:",
              deletePhotoResult.reason
            )
          }

          if (deleteWorkspaceResult.status === "rejected") {
            throw deleteWorkspaceResult.reason
          }
        } finally {
          if (isCurrentWorkspace) {
            removePending(pendingUserIds, currentUser.value!.uid)
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
    isBootstrapping,

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

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
 * Reactive Firestore reads flow through TanStack Query (onSnapshot-backed).
 * All mutations go through Cloud Functions for automatic audit logging.
 */

import {
  createWorkspace as createWorkspaceFn,
  deleteWorkspace as deleteWorkspaceFn,
  updateWorkspace as updateWorkspaceFn,
} from "@/composables/useFunctions"
import { queryClient } from "@/modules/queryClient"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IWorkspace } from "@/types/domain"
import {
  createTeamWorkspacesQuery,
  deleteWorkspacePhotoFile,
  getMembershipPreferencesRef,
  uploadWorkspacePhoto,
} from "@/utils/firebase/firebase-helpers"
import { useFirestoreMutation } from "@/utils/firebase/firebase-mutation"
import {
  addPending,
  createPendingSet,
  removePending,
} from "@/utils/firebase/firebase-optimistic"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
import {
  mutateSetDocument,
  mutateWithCoordinator,
} from "@/utils/firebase/firebase-sync-engine"
import { Timestamp } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"

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

  const hasCurrentTeamMembership = computed(() => {
    const teamId = currentTeamId.value
    return (
      !!teamId &&
      memberships.value.some((membership) => membership.teamId === teamId)
    )
  })

  // ============================================================================
  // Realtime Firestore bindings (TanStack Query)
  // ============================================================================

  // Query for workspaces in current team - null when no team selected
  const workspacesQueryRef = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null

    // Guard: Ensure user is a member of the team before trying to list its workspaces.
    if (!hasCurrentTeamMembership.value) return null

    return createTeamWorkspacesQuery(teamId)
  })

  // Realtime collection binding (TanStack Query + onSnapshot). The source getter
  // folds `workspacesQueryRef` into a cache identity (collection path); a null
  // query keeps the read idle until a team + membership resolve.
  const workspacesQuery = useCollectionQuery<IWorkspace>(() => {
    const query = workspacesQueryRef.value
    return query ? { query, path: query.path } : null
  })
  const firestoreWorkspaces: ComputedRef<IWorkspace[]> = computed(
    () => workspacesQuery.data.value ?? []
  )
  const isFirestoreLoading: ComputedRef<boolean> = computed(
    () => workspacesQuery.isLoading.value
  )
  // True only once the LIVE onSnapshot listener has delivered a snapshot for
  // the current team's workspaces list this session. A query restored from the
  // persisted read-cache is marked stale (refetchType:"none") until its first
  // live snapshot lands (see restoreQueryCache), so `isStale`/`isFetching`
  // separate "the cached list says the selection is gone" (NOT trustworthy)
  // from "the live listener says it's gone" (trustworthy). The stale-selection
  // cleanup below must only act on the trustworthy signal.
  const isFirestoreSettled: ComputedRef<boolean> = computed(
    () => !workspacesQuery.isStale.value && !workspacesQuery.isFetching.value
  )

  // ============================================================================
  // State (for optimistic updates)
  // ============================================================================

  // Pending operation tracking (per-workspace-id; drives `isWorkspacePending`
  // and the stale-selection cleanup guard). Managed by the action wrappers
  // around each mutation, mirroring the prior optimistic layer's behavior.
  const pendingWorkspaceIds = shallowRef(createPendingSet())
  const isPersistingWorkspaceSelection = ref(false)

  /** Cache key for the current team's workspaces list (matches the read query). */
  const workspacesListKey = (teamId: string): FirestoreQueryKey =>
    queryKeys.list(`teams/${teamId}/workspaces`)

  // One mutation drives every workspace list write. Callers pass the affected
  // cache key(s) + optimistic apply/rollback + the Cloud Function call; the hold
  // in `useFirestoreMutation` keeps the optimistic value visible until the
  // server-applied snapshot reconciles it. Selection + pending side-effects are
  // handled in the action wrappers below.
  const workspaceMutation = useFirestoreMutation<
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
    source: "workspace",
  })

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

  // ============================================================================
  // Computed - Merged State
  // ============================================================================

  /** All workspaces for the current team (straight from the realtime cache). */
  const workspaces = computed(() => firestoreWorkspaces.value)

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

  const isLoading = computed(() => {
    if (!currentTeamId.value) return false
    if (workspaces.value.length > 0) return false
    if (workspacesQueryRef.value) return isFirestoreLoading.value
    return isMembershipLoading.value && !hasCurrentTeamMembership.value
  })

  // App-shell bootstrap blocks the cascade until we have a definitive
  // workspace state. A selected ID that doesn't yet map to a workspace keeps
  // the spinner up — either the workspace will arrive from Firestore, or the
  // stale-cleanup watcher below will null the selection out. Either way the
  // shell re-evaluates. Cached hydration is intentionally NOT used to release
  // the gate, because a stale cached list can claim "resolved" while still
  // missing the selected workspace and flash the WorkspaceSelector.
  const isBootstrapping = computed(() => {
    if (!currentTeamId.value) return false
    if (!hasResolvedCurrentWorkspaceSelection.value) return true
    if (currentWorkspaceId.value) return !currentWorkspace.value
    return false
  })

  const isWorkspacePending = computed(
    () => (id: string) => pendingWorkspaceIds.value.has(id)
  )

  const hasAnyPendingOperation = computed(
    () => pendingWorkspaceIds.value.size > 0
  )

  // ============================================================================
  // Stale selection cleanup
  // ============================================================================

  // Handle stale currentWorkspaceId (e.g. workspace deleted)
  watch(
    [
      currentWorkspaceId,
      workspaces,
      isLoading,
      currentTeamId,
      isMembershipLoading,
      isFirestoreLoading,
      isFirestoreSettled,
    ],
    async ([
      workspaceId,
      workspaceList,
      loading,
      teamId,
      membershipLoading,
      firestoreLoading,
      firestoreSettled,
    ]) => {
      // If we are loading, or no workspace ID selected, ignore.
      // `firestoreLoading` is checked separately from `loading` because the
      // latter shortcuts to false whenever the workspaces list is non-empty
      // (including cache-restored entries). Without this guard, a cold start
      // with a cached selection could fire before the workspaces query
      // resolved, see an empty list, and wipe the user's selection.
      //
      // `firestoreSettled` closes the complementary window: a list restored
      // from the persisted cache can be non-empty yet STALE — present but not
      // yet confirmed by the live listener, and possibly missing a valid
      // selection (a workspace created/selected on another device, or the
      // membershipPreferences and workspaces caches persisted a beat apart).
      // `firestoreLoading` is false in that window (there IS cached data), so
      // without this the cleanup would persist `currentWorkspaceId: null` —
      // which, being Firestore-first authoritative, re-surfaces the
      // WorkspaceSelector on every subsequent reload. Only act on the list
      // once the live snapshot has confirmed it.
      if (
        !workspaceId ||
        loading ||
        !teamId ||
        (membershipLoading && !hasCurrentTeamMembership.value) ||
        firestoreLoading ||
        !firestoreSettled
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

  // Kept for API compatibility. Read state now lives in the query cache, which
  // is cleared centrally on logout (clearPersistedQueryCache), so there is no
  // per-store optimistic state left to reset here.
  function cleanup() {}

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
    const uid = currentUser.value.uid
    const key = workspacesListKey(teamId)
    // Temporary ID for the optimistic row — replaced by the server's id once
    // the create lands and the live snapshot reconciles.
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

    const previousWorkspaces = queryClient.getQueryData<IWorkspace[]>(key)
    const previousWorkspaceId = currentWorkspaceId.value

    addPending(pendingWorkspaceIds, tempId)
    addPending(pendingUserIds, uid)
    try {
      await workspaceMutation.mutateAsync({
        keys: [key],
        apply: () => {
          queryClient.setQueryData<IWorkspace[]>(key, [
            ...(queryClient.getQueryData<IWorkspace[]>(key) ?? []),
            newWorkspace,
          ])
          // Auto-select the new workspace (swapped to the real id on success).
          authStore.setCurrentWorkspaceId(tempId)
        },
        rollback: () => {
          queryClient.setQueryData(key, previousWorkspaces)
          authStore.setCurrentWorkspaceId(previousWorkspaceId ?? null)
        },
        run: async () => {
          const result = await createWorkspaceFn({
            teamId,
            name,
            description: description ?? null,
          })
          const actualWorkspaceId = result.data.workspaceId

          // Best-effort photo upload after the workspace exists. Do not fail
          // workspace creation if the photo upload/update fails.
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

          // Persist + finalize the selection on the server-issued id.
          await persistWorkspaceSelection(actualWorkspaceId)
          authStore.setCurrentWorkspaceId(actualWorkspaceId)
        },
      })
    } finally {
      removePending(pendingUserIds, uid)
      // Hold the per-id pending flag briefly past settle so the stale-selection
      // watch doesn't fire in the tempId→realId window before the snapshot lands.
      setTimeout(() => removePending(pendingWorkspaceIds, tempId), 120)
    }
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
    const key = workspacesListKey(teamId)
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

    const previousWorkspaces = queryClient.getQueryData<IWorkspace[]>(key)
    let resolvedPhotoURL: string | null | undefined =
      photoFile === null ? null : undefined

    const patchWorkspace = (patch: Partial<IWorkspace>) => {
      queryClient.setQueryData<IWorkspace[]>(
        key,
        (queryClient.getQueryData<IWorkspace[]>(key) ?? []).map((w) =>
          w.id === workspaceId ? { ...w, ...patch } : w
        )
      )
    }

    addPending(pendingWorkspaceIds, workspaceId)
    try {
      await workspaceMutation.mutateAsync({
        keys: [key],
        apply: () => patchWorkspace(workspaceUpdates),
        rollback: () => queryClient.setQueryData(key, previousWorkspaces),
        run: async () => {
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

          // Replace the optimistic blob URL with the uploaded URL.
          if (photoFile !== undefined && resolvedPhotoURL !== undefined) {
            patchWorkspace({ photoURL: resolvedPhotoURL })
          }

          // Clean up the storage object when the photo is explicitly removed.
          if (resolvedPhotoURL === null) {
            await deleteWorkspacePhotoFile(teamId, workspaceId)
          }
        },
      })
    } finally {
      if (optimisticPhotoURL) {
        URL.revokeObjectURL(optimisticPhotoURL)
      }
      setTimeout(() => removePending(pendingWorkspaceIds, workspaceId), 120)
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
    const uid = currentUser.value.uid
    const key = workspacesListKey(teamId)
    const previousWorkspaces = queryClient.getQueryData<IWorkspace[]>(key)
    const previousWorkspaceId = currentWorkspaceId.value
    const isCurrentWorkspace = currentWorkspaceId.value === workspaceId

    addPending(pendingWorkspaceIds, workspaceId)
    if (isCurrentWorkspace) addPending(pendingUserIds, uid)
    try {
      await workspaceMutation.mutateAsync({
        keys: [key],
        apply: () => {
          queryClient.setQueryData<IWorkspace[]>(
            key,
            (queryClient.getQueryData<IWorkspace[]>(key) ?? []).filter(
              (w) => w.id !== workspaceId
            )
          )
          if (isCurrentWorkspace) {
            authStore.setCurrentWorkspaceId(null)
          }
        },
        rollback: () => {
          queryClient.setQueryData(key, previousWorkspaces)
          if (isCurrentWorkspace) {
            authStore.setCurrentWorkspaceId(previousWorkspaceId ?? null)
          }
        },
        run: async () => {
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
        },
      })
    } finally {
      if (isCurrentWorkspace) removePending(pendingUserIds, uid)
      setTimeout(() => removePending(pendingWorkspaceIds, workspaceId), 120)
    }
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

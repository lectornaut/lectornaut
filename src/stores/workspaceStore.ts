/**
 * Workspace Store — workspaces for the current team + the active selection.
 *
 * Responsibilities:
 * - `workspaces`        — the current team's workspaces (realtime).
 * - `currentWorkspace`  — resolves the selected id against that list.
 * - CRUD (owner/admin) via Cloud Functions; switch (any member) via the sync
 *   engine writing membership-scoped preferences.
 * - `isBootstrapping`   — app-shell gate that holds the spinner until the
 *   workspace selection is definitively resolved.
 *
 * Selection itself lives on authStore (membership-preferences, per team); this
 * store drives the list reads, the durable selection writes, and the cleanup of
 * a selection that no longer maps to a live workspace.
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
import { useRunWrite } from "@/utils/firebase/firebase-mutation"
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
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { query as fsQuery, Timestamp, where } from "firebase/firestore"
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
    return !!teamId && memberships.value.some((m) => m.teamId === teamId)
  })

  // ── Realtime read ───────────────────────────────────────────────────────────
  // Idle until a team + confirmed membership resolve (listing workspaces before
  // membership is known would hit a rules denial).
  const workspacesQuery = useCollectionQuery<IWorkspace>(() => {
    const teamId = currentTeamId.value
    const uid = currentUser.value?.uid
    if (!teamId || !uid || !hasCurrentTeamMembership.value) return null
    // Airtight participation: only workspaces whose `memberUids` include the
    // caller (denormalized server-side; excluded/non-member workspaces are
    // never returned). firestore.rules requires the same constraint on read.
    // `memberUids` is seeded at workspace creation and on invite-accept, so this
    // works on a clean dataset with no backfill.
    const collectionRef = createTeamWorkspacesQuery(teamId)
    return {
      query: fsQuery(collectionRef, where("memberUids", "array-contains", uid)),
      path: collectionRef.path,
      params: { memberUid: uid },
    }
  })
  const firestoreWorkspaces = computed(() => workspacesQuery.data.value ?? [])
  const isFirestoreLoading = computed(() => workspacesQuery.isLoading.value)
  // True only once the LIVE listener has delivered a snapshot this session. A
  // cache-restored query is marked stale (refetchType:"none") until its first
  // live snapshot, so this separates "the cached list says it's gone" (NOT
  // trustworthy) from "the live listener says it's gone" (trustworthy). The
  // stale-selection cleanup below only acts on the trustworthy signal.
  const isFirestoreSettled = computed(
    () => !workspacesQuery.isStale.value && !workspacesQuery.isFetching.value
  )

  // ── State ───────────────────────────────────────────────────────────────────
  const pendingWorkspaceIds = shallowRef(createPendingSet())
  const isPersistingSelection = ref(false)

  const workspacesListKey = (teamId: string): FirestoreQueryKey =>
    queryKeys.list(`teams/${teamId}/workspaces`)

  const runWrite = useRunWrite("workspace")

  async function persistWorkspaceSelection(
    workspaceId: string | null
  ): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return
    await mutateSetDocument(
      getMembershipPreferencesRef(currentTeamId.value, currentUser.value.uid),
      { currentWorkspaceId: workspaceId },
      { source: "workspace.persistSelection", merge: true }
    )
  }

  // ── Merged state ────────────────────────────────────────────────────────────
  // The query already excludes workspaces the caller doesn't participate in
  // (memberUids array-contains), so the list is the participation set directly.
  // An excluded current selection (dropped from the query) falls through to the
  // stale-selection cleanup below (same path as a removed workspace).
  const workspaces = computed(() => firestoreWorkspaces.value)
  const workspaceById = computed(
    () => new Map(workspaces.value.map((w) => [w.id, w]))
  )
  const currentWorkspace = computed(() => {
    const id = currentWorkspaceId.value
    return id ? (workspaceById.value.get(id) ?? null) : null
  })

  const isLoading = computed(() => {
    if (!currentTeamId.value) return false
    if (workspaces.value.length > 0) return false
    if (hasCurrentTeamMembership.value) return isFirestoreLoading.value
    return isMembershipLoading.value && !hasCurrentTeamMembership.value
  })

  // Hold the app-shell spinner until the selection is definitively resolved: a
  // selected id that doesn't yet map to a workspace keeps spinning (either the
  // workspace arrives, or the cleanup watch nulls the selection out). Cached
  // hydration deliberately does NOT release the gate — a stale cached list can
  // claim "resolved" while missing the selected workspace and flash the selector.
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

  // ── Stale-selection cleanup ─────────────────────────────────────────────────
  // Clearing the selection writes `currentWorkspaceId: null` to Firestore —
  // DURABLE and cross-device, so a false positive permanently wipes a valid
  // selection. Every trigger for "the workspace is gone" is racy and transient:
  // a momentarily empty / mid-load list during a team switch, a re-subscribe
  // after a transient listener error (token warm-up `permission-denied`), or a
  // cache eviction. The per-instant guards below filter most of those out, but a
  // single observation of racy state is the wrong basis for an irreversible act.
  // So we never clear on first sight: the SAME selection must STILL be absent
  // after a short confirmation delay. A transient blip repopulates and
  // self-cancels; only a genuinely-deleted workspace stays absent and clears.
  const STALE_SELECTION_CONFIRM_MS = 400
  let staleConfirmTimer: ReturnType<typeof setTimeout> | null = null
  let staleConfirmTarget: { teamId: string; workspaceId: string } | null = null

  const cancelStaleConfirm = () => {
    if (staleConfirmTimer) {
      clearTimeout(staleConfirmTimer)
      staleConfirmTimer = null
    }
    staleConfirmTarget = null
  }

  // Evaluate every guard against CURRENT reactive state. Returns the stale
  // (teamId, workspaceId) pair, or null when the selection is fine or the state
  // is too indeterminate to judge.
  const pendingStaleSelection = (): {
    teamId: string
    workspaceId: string
  } | null => {
    const workspaceId = currentWorkspaceId.value
    const teamId = currentTeamId.value
    if (!workspaceId || !teamId) return null
    // Act only on a definitive, live answer — never interim state. `isLoading`
    // shortcuts to false on a non-empty (incl. cached) list, so the raw
    // firestore signals are checked too: `isFirestoreLoading` covers cold start,
    // `isFirestoreSettled` covers the cache-restored-but-unconfirmed window.
    if (
      isLoading.value ||
      isFirestoreLoading.value ||
      !isFirestoreSettled.value
    ) {
      return null
    }
    if (isMembershipLoading.value && !hasCurrentTeamMembership.value)
      return null
    if (!memberships.value.some((m) => m.teamId === teamId)) return null
    // A list that isn't this team's can't testify to the selection's staleness
    // (the team-switch race — selection flips a tick before the list catches
    // up). Wait for it. An empty list is vacuously this team's.
    if (!workspaces.value.every((w) => w.teamId === teamId)) return null
    // Skip while any mutation is pending (e.g. create's tempId→serverId window).
    if (pendingWorkspaceIds.value.size > 0 || isPersistingSelection.value) {
      return null
    }
    if (workspaces.value.some((w) => w.id === workspaceId)) return null
    return { teamId, workspaceId }
  }

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
    () => {
      const target = pendingStaleSelection()
      if (!target) {
        // Conditions no longer hold (e.g. the list repopulated) — abort any
        // scheduled clear so a transient blip never reaches the durable write.
        cancelStaleConfirm()
        return
      }
      // Already counting down for this exact selection — let the timer run out.
      if (
        staleConfirmTimer &&
        staleConfirmTarget &&
        staleConfirmTarget.teamId === target.teamId &&
        staleConfirmTarget.workspaceId === target.workspaceId
      ) {
        return
      }
      cancelStaleConfirm()
      staleConfirmTarget = target
      staleConfirmTimer = setTimeout(() => {
        staleConfirmTimer = null
        staleConfirmTarget = null
        // Re-confirm against the LATEST state: the same selection must still be
        // missing. A transient empty/loading list has repopulated by now.
        const confirmed = pendingStaleSelection()
        if (
          !confirmed ||
          confirmed.teamId !== target.teamId ||
          confirmed.workspaceId !== target.workspaceId
        ) {
          return
        }
        console.warn(
          "[workspaceStore] Confirmed stale workspace ID, clearing selection",
          {
            workspaceId: target.workspaceId,
            teamId: target.teamId,
            workspaceCount: workspaces.value.length,
          }
        )
        isPersistingSelection.value = true
        void persistWorkspaceSelection(null)
          .catch((error) => {
            console.error(
              "[workspaceStore] Failed to persist stale workspace cleanup:",
              error
            )
          })
          .finally(() => {
            isPersistingSelection.value = false
          })
      }, STALE_SELECTION_CONFIRM_MS)
    }
  )

  // Read state lives in the query cache (cleared centrally on logout). Drop any
  // in-flight stale-confirmation timer so it can't fire against a torn-down user.
  function cleanup() {
    cancelStaleConfirm()
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function createWorkspace(
    name: string,
    description?: string,
    photoFile?: File
  ): Promise<string | undefined> {
    if (!currentUser.value || !currentTeamId.value) return undefined
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and admins can create workspaces")
    }

    const teamId = currentTeamId.value
    const uid = currentUser.value.uid
    const key = workspacesListKey(teamId)
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const now = Timestamp.now()

    const optimisticWorkspace: IWorkspace = {
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

    addPending(pendingUserIds, uid)
    // Captured inside `fn` so callers (e.g. WorkspaceDialog's create flow,
    // which then assigns per-workspace roles) can act on the real id once the
    // server confirms. mutateAsync awaits `run`, so this is set on resolve.
    let createdWorkspaceId: string | undefined
    try {
      await runWrite({
        keys: [key],
        apply: () => {
          queryClient.setQueryData<IWorkspace[]>(key, [
            ...(queryClient.getQueryData<IWorkspace[]>(key) ?? []),
            optimisticWorkspace,
          ])
          authStore.setCurrentWorkspaceId(tempId)
        },
        rollback: () => {
          queryClient.setQueryData(key, previousWorkspaces)
          authStore.setCurrentWorkspaceId(previousWorkspaceId ?? null)
        },
        fn: async () => {
          const result = await createWorkspaceFn({
            teamId,
            name,
            description: description ?? null,
          })
          const workspaceId = result.data.workspaceId
          createdWorkspaceId = workspaceId

          // Best-effort photo upload — never fail creation over a photo.
          if (photoFile) {
            try {
              const photoURL = await uploadWorkspacePhoto(
                teamId,
                workspaceId,
                photoFile
              )
              await updateWorkspaceFn({ teamId, workspaceId, photoURL })
            } catch (error) {
              console.error(
                "[workspaceStore] Failed to attach workspace photo after create",
                error
              )
            }
          }

          await persistWorkspaceSelection(workspaceId)
          authStore.setCurrentWorkspaceId(workspaceId)
        },
        // Hold the per-id flag briefly past settle so the cleanup watch doesn't
        // fire in the tempId→realId window before the snapshot lands.
        pending: { ref: pendingWorkspaceIds, ids: [tempId] },
      })
    } finally {
      removePending(pendingUserIds, uid)
    }

    return createdWorkspaceId
  }

  async function switchWorkspace(workspaceId: string): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return

    if (!workspaces.value.some((w) => w.id === workspaceId)) {
      throw new Error("Workspace not found")
    }

    const uid = currentUser.value.uid
    const teamId = currentTeamId.value
    const previousWorkspaceId = currentWorkspaceId.value
    await runWrite({
      keys: [],
      apply: () => authStore.setCurrentWorkspaceId(workspaceId),
      rollback: () => authStore.setCurrentWorkspaceId(previousWorkspaceId),
      fn: () =>
        mutateSetDocument(
          getMembershipPreferencesRef(teamId, uid),
          { currentWorkspaceId: workspaceId },
          { source: "workspace.switchWorkspace", merge: true }
        ),
      pending: { ref: pendingUserIds, ids: [uid] },
      source: "workspace.switchWorkspace",
    })
  }

  async function updateWorkspace(
    workspaceId: string,
    updates: {
      name?: string
      description?: string | null
      photoFile?: File | null
    }
  ): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and admins can update workspaces")
    }

    const teamId = currentTeamId.value
    const key = workspacesListKey(teamId)
    const { name, description, photoFile } = updates
    const optimisticPhotoURL =
      photoFile instanceof File ? URL.createObjectURL(photoFile) : undefined

    const optimisticPatch = {
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

    const patch = (changes: Partial<IWorkspace>) => {
      queryClient.setQueryData<IWorkspace[]>(
        key,
        (queryClient.getQueryData<IWorkspace[]>(key) ?? []).map((w) =>
          w.id === workspaceId ? { ...w, ...changes } : w
        )
      )
    }

    try {
      await runWrite({
        keys: [key],
        apply: () => patch(optimisticPatch),
        rollback: () => queryClient.setQueryData(key, previousWorkspaces),
        fn: async () => {
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

          // Swap the optimistic blob URL for the uploaded one.
          if (photoFile !== undefined && resolvedPhotoURL !== undefined) {
            patch({ photoURL: resolvedPhotoURL })
          }
          // Clean up storage when the photo was explicitly removed.
          if (resolvedPhotoURL === null) {
            await deleteWorkspacePhotoFile(teamId, workspaceId)
          }
        },
        pending: { ref: pendingWorkspaceIds, ids: [workspaceId] },
      })
    } finally {
      if (optimisticPhotoURL) URL.revokeObjectURL(optimisticPhotoURL)
    }
  }

  async function deleteWorkspace(workspaceId: string): Promise<void> {
    if (!currentUser.value || !currentTeamId.value) return
    if (!canManageWorkspaces.value) {
      throw new Error("Only team owners and admins can delete workspaces")
    }

    const teamId = currentTeamId.value
    const uid = currentUser.value.uid
    const key = workspacesListKey(teamId)
    const previousWorkspaces = queryClient.getQueryData<IWorkspace[]>(key)
    const previousWorkspaceId = currentWorkspaceId.value
    const isCurrent = currentWorkspaceId.value === workspaceId

    if (isCurrent) addPending(pendingUserIds, uid)
    try {
      await runWrite({
        keys: [key],
        apply: () => {
          queryClient.setQueryData<IWorkspace[]>(
            key,
            (queryClient.getQueryData<IWorkspace[]>(key) ?? []).filter(
              (w) => w.id !== workspaceId
            )
          )
          if (isCurrent) authStore.setCurrentWorkspaceId(null)
        },
        rollback: () => {
          queryClient.setQueryData(key, previousWorkspaces)
          if (isCurrent) {
            authStore.setCurrentWorkspaceId(previousWorkspaceId ?? null)
          }
        },
        fn: async () => {
          // Photo + attachment cleanup is handled server-side by the
          // deleteWorkspace callable (a prefix sweep over this workspace's
          // Storage objects).
          await deleteWorkspaceFn({ teamId, workspaceId })
        },
        pending: { ref: pendingWorkspaceIds, ids: [workspaceId] },
      })
    } finally {
      if (isCurrent) removePending(pendingUserIds, uid)
    }
  }

  return {
    // State
    workspaces,
    currentWorkspace,
    isLoading,
    isBootstrapping,

    // Pending
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

/**
 * useMemories — the workspace Memory management surface (Settings → Memory).
 *
 * Reads mirror botSessions (firebase-helpers.ts): rules constrain a non-admin to
 * their OWN + SHARED memories, so members run two live queries
 * (`where("ownerUid","==",me)` + `where("visibility","==","shared")`) merged
 * client-side — Firestore can't OR those in one query. Team admins run the
 * single unfiltered query (the rule clause permits `isTeamAdmin`). The
 * own/shared streams are deduped (own wins) and sorted newest-first.
 *
 * Writes are functions-only callables (`createMemory`, …); each is wrapped in an
 * optimistic cache patch — hold the active list key(s), patch, run the callable,
 * reconcile on release / roll back on error — exactly like `useWorkspaceBotSessions`.
 * The embed trigger fills the vector after the create lands, so the list updates
 * instantly and recall catches up asynchronously.
 */

import { useCurrentTeamRole } from "@/composables/useCurrentTeamRole"
import {
  archiveMemory,
  createMemory,
  deleteMemory,
  pinMemory,
  purgeWorkspaceMemories,
  shareMemory,
  unarchiveMemory,
  unpinMemory,
  unshareMemory,
  updateMemory,
  type CreateMemoryRequest,
  type UpdateMemoryRequest,
} from "@/composables/useFunctions"
import { queryClient } from "@/modules/queryClient"
import type { IMemory } from "@/schemas/memory"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import {
  createMemoriesQuery,
  createSharedMemoriesQuery,
  createWorkspaceMemoriesQuery,
} from "@/utils/firebase/firebase-helpers"
import {
  holdOptimistic,
  useCollectionQuery,
} from "@/utils/firebase/firebase-query"
import { queryKeys } from "@/utils/firebase/firebase-query-keys"
import { Timestamp } from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed, ref, type ComputedRef, type Ref } from "vue"

/** Fields a create dialog supplies; teamId/workspaceId are added by the composable. */
export type CreateMemoryInput = Omit<
  CreateMemoryRequest,
  "teamId" | "workspaceId"
>

/** Fields an edit dialog supplies; the target ids are added by the composable. */
export type UpdateMemoryInput = Omit<
  UpdateMemoryRequest,
  "teamId" | "workspaceId" | "memoryId"
>

export interface UseMemoriesReturn {
  memories: ComputedRef<IMemory[]>
  isLoading: ComputedRef<boolean>
  /** Owner/admin/member (not guests) — gates create/edit affordances. */
  canManage: ComputedRef<boolean>
  /** Owner/admin (MANAGE_WORKSPACE_STORAGE) — gates the "Delete all" purge. */
  canPurge: ComputedRef<boolean>
  /** Owner/admin — sees every member's memories (not just own + shared). */
  isTeamAdmin: ComputedRef<boolean>
  /** The team's master Memory switch (Settings → AI). Off ⇒ governance-only. */
  memoryEnabled: ComputedRef<boolean>
  isMutating: Ref<boolean>
  create: (input: CreateMemoryInput) => Promise<string | null>
  update: (memoryId: string, patch: UpdateMemoryInput) => Promise<void>
  remove: (memoryId: string) => Promise<void>
  setArchived: (memoryId: string, archived: boolean) => Promise<void>
  setPinned: (memoryId: string, pinned: boolean) => Promise<void>
  setShared: (memoryId: string, shared: boolean) => Promise<void>
  /** Admin governance: delete EVERY memory in the workspace. Returns the count. */
  purgeAll: () => Promise<number>
}

const memoriesPath = (teamId: string, workspaceId: string) =>
  `teams/${teamId}/workspaces/${workspaceId}/memories`

const toMillis = (value: IMemory["updatedAt"]): number =>
  value instanceof Timestamp ? value.toMillis() : 0

const byUpdatedDesc = (a: IMemory, b: IMemory) =>
  toMillis(b.updatedAt) - toMillis(a.updatedAt)

export function useMemories(): UseMemoriesReturn {
  const { currentTeamId, currentWorkspaceId, currentUser } =
    storeToRefs(useAuthStore())
  const { currentRole, canManageWorkspaceContent, canManageWorkspaceStorage } =
    useCurrentTeamRole(currentTeamId)
  const { config } = storeToRefs(useAgentConfigStore())

  const uid = computed(() => currentUser.value?.uid ?? null)
  const isTeamAdmin = computed(
    () => currentRole.value === "owner" || currentRole.value === "admin"
  )
  // On by default — mirror the schema/server default so the screen doesn't
  // briefly show governance-only mode before the config store settles.
  const memoryEnabled = computed(() => config.value?.memoryEnabled ?? true)

  // Admins read every memory (unfiltered); members are constrained by rules to
  // their own + shared, so they subscribe to two queries that each provably
  // satisfy the rule predicate.
  const adminQuery = useCollectionQuery<IMemory>(() => {
    if (!isTeamAdmin.value) return null
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return null
    return {
      query: createWorkspaceMemoriesQuery(teamId, workspaceId),
      path: memoriesPath(teamId, workspaceId),
      params: { scope: "workspace-all" },
    }
  })

  const ownQuery = useCollectionQuery<IMemory>(() => {
    if (isTeamAdmin.value) return null
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    const owner = uid.value
    if (!teamId || !workspaceId || !owner) return null
    return {
      query: createMemoriesQuery(teamId, workspaceId, owner),
      path: memoriesPath(teamId, workspaceId),
      params: { scope: "own" },
    }
  })

  const sharedQuery = useCollectionQuery<IMemory>(() => {
    if (isTeamAdmin.value) return null
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return null
    return {
      query: createSharedMemoriesQuery(teamId, workspaceId),
      path: memoriesPath(teamId, workspaceId),
      params: { scope: "shared" },
    }
  })

  const memories = computed<IMemory[]>(() => {
    if (isTeamAdmin.value) {
      return [...(adminQuery.data.value ?? [])].sort(byUpdatedDesc)
    }
    // Merge own + shared, dedupe by id (own wins so my private/shared rows keep
    // their authoritative copy), newest-first.
    const byId = new Map<string, IMemory>()
    for (const m of sharedQuery.data.value ?? []) byId.set(m.id, m)
    for (const m of ownQuery.data.value ?? []) byId.set(m.id, m)
    return [...byId.values()].sort(byUpdatedDesc)
  })

  const isLoading = computed<boolean>(() =>
    isTeamAdmin.value
      ? adminQuery.isLoading.value
      : ownQuery.isLoading.value || sharedQuery.isLoading.value
  )

  const isMutating = ref(false)

  // The cache keys the current view subscribes to — patch all of them so an
  // optimistic edit is reflected whether the row lives in the admin list or in
  // the member's own/shared split.
  const activeKeys = computed(() => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return []
    const path = memoriesPath(teamId, workspaceId)
    return isTeamAdmin.value
      ? [queryKeys.list(path, { scope: "workspace-all" })]
      : [
          queryKeys.list(path, { scope: "own" }),
          queryKeys.list(path, { scope: "shared" }),
        ]
  })

  const runMemoryWrite = async (
    apply: (rows: IMemory[]) => IMemory[],
    run: () => Promise<unknown>
  ): Promise<void> => {
    const keys = activeKeys.value
    const snapshots = keys.map(
      (key) => [key, queryClient.getQueryData<IMemory[]>(key)] as const
    )
    const releases = keys.map((key) => holdOptimistic(key))
    for (const [key, previous] of snapshots) {
      queryClient.setQueryData<IMemory[]>(key, apply(previous ?? []))
    }
    try {
      await run()
    } catch (error) {
      for (const [key, previous] of snapshots) {
        queryClient.setQueryData(key, previous)
      }
      throw error
    } finally {
      setTimeout(() => releases.forEach((release) => release()), 120)
    }
  }

  const create = async (input: CreateMemoryInput): Promise<string | null> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId || isMutating.value) return null
    isMutating.value = true
    try {
      // No optimistic insert — the id isn't known until the callable returns and
      // the live listener reflects the new row (with its embedding) shortly after.
      const { data } = await createMemory({ teamId, workspaceId, ...input })
      return data.memoryId
    } finally {
      isMutating.value = false
    }
  }

  const update = async (
    memoryId: string,
    patch: UpdateMemoryInput
  ): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId || isMutating.value) return
    isMutating.value = true
    try {
      await runMemoryWrite(
        (rows) => rows.map((m) => (m.id === memoryId ? { ...m, ...patch } : m)),
        () => updateMemory({ teamId, workspaceId, memoryId, ...patch })
      )
    } finally {
      isMutating.value = false
    }
  }

  const remove = async (memoryId: string): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId || isMutating.value) return
    isMutating.value = true
    try {
      await runMemoryWrite(
        (rows) => rows.filter((m) => m.id !== memoryId),
        () => deleteMemory({ teamId, workspaceId, memoryId })
      )
    } finally {
      isMutating.value = false
    }
  }

  const setArchived = async (
    memoryId: string,
    archived: boolean
  ): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId || isMutating.value) return
    isMutating.value = true
    try {
      await runMemoryWrite(
        (rows) =>
          rows.map((m) =>
            m.id === memoryId
              ? {
                  ...m,
                  archived,
                  archivedAt: archived ? Timestamp.now() : null,
                }
              : m
          ),
        () =>
          archived
            ? archiveMemory({ teamId, workspaceId, memoryId })
            : unarchiveMemory({ teamId, workspaceId, memoryId })
      )
    } finally {
      isMutating.value = false
    }
  }

  const setPinned = async (
    memoryId: string,
    pinned: boolean
  ): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId || isMutating.value) return
    isMutating.value = true
    try {
      await runMemoryWrite(
        (rows) => rows.map((m) => (m.id === memoryId ? { ...m, pinned } : m)),
        () =>
          pinned
            ? pinMemory({ teamId, workspaceId, memoryId })
            : unpinMemory({ teamId, workspaceId, memoryId })
      )
    } finally {
      isMutating.value = false
    }
  }

  const setShared = async (
    memoryId: string,
    shared: boolean
  ): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId || isMutating.value) return
    isMutating.value = true
    try {
      await runMemoryWrite(
        (rows) =>
          rows.map((m) =>
            m.id === memoryId
              ? { ...m, visibility: shared ? "shared" : "private" }
              : m
          ),
        () =>
          shared
            ? shareMemory({ teamId, workspaceId, memoryId })
            : unshareMemory({ teamId, workspaceId, memoryId })
      )
    } finally {
      isMutating.value = false
    }
  }

  const purgeAll = async (): Promise<number> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId || isMutating.value) return 0
    isMutating.value = true
    try {
      // Optimistically clear the active list(s); the listener reconciles on
      // release. No rollback snapshot wiring — a failed purge re-fills from the
      // live snapshot once the hold releases.
      const previous = activeKeys.value.map(
        (key) => [key, queryClient.getQueryData<IMemory[]>(key)] as const
      )
      const releases = activeKeys.value.map((key) => holdOptimistic(key))
      for (const [key] of previous) {
        queryClient.setQueryData<IMemory[]>(key, [])
      }
      try {
        const { data } = await purgeWorkspaceMemories({ teamId, workspaceId })
        return data.deleted
      } catch (error) {
        for (const [key, snapshot] of previous) {
          queryClient.setQueryData(key, snapshot)
        }
        throw error
      } finally {
        setTimeout(() => releases.forEach((release) => release()), 120)
      }
    } finally {
      isMutating.value = false
    }
  }

  return {
    memories,
    isLoading,
    canManage: canManageWorkspaceContent,
    canPurge: canManageWorkspaceStorage,
    isTeamAdmin,
    memoryEnabled,
    isMutating,
    create,
    update,
    remove,
    setArchived,
    setPinned,
    setShared,
    purgeAll,
  }
}

import { DEFAULT_CHILDREN_PAGE_SIZE, useNodes } from "@/composables/useNodes"
import { queryClient } from "@/modules/queryClient"
import {
  NODE_NAME_MAX_LENGTH,
  ROOT_PARENT_ID,
  getTypeOrder,
  normalizeName,
  toNameLower,
  type WorkspaceNode,
  type WorkspaceNodeScope,
} from "@/types/nodes"
import { useRunWrite } from "@/utils/firebase/firebase-mutation"
import {
  cloneState,
  generateOperationId,
} from "@/utils/firebase/firebase-optimistic"
import { streamIntoCache } from "@/utils/firebase/firebase-query"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
import { hashKey } from "@tanstack/vue-query"
import {
  Timestamp,
  type FirestoreError,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { defineStore } from "pinia"
import { reactive } from "vue"

interface PaginationState {
  lastDoc: QueryDocumentSnapshot | null
  hasMore: boolean
  loadingMore: boolean
}

const INCLUDE_ARCHIVED = true

/**
 * Hard cap on live `onSnapshot` subscriptions per (scope, team,
 * workspace) bucket. The file tree opens one listener per expanded
 * folder; without a cap, a power user expanding dozens of folders can
 * accumulate that many WebSocket subscriptions. Firestore multiplexes
 * them over a single connection, but each one carries client-side
 * Watch state + memory for its snapshot data.
 *
 * When the cap is exceeded, the oldest non-root subscription is
 * evicted. The last-seen children list stays in the store (the UI
 * keeps rendering them) — the eviction only stops *live updates* for
 * that folder until the user re-expands it. Root is exempt because
 * the workspace's top-level navigation depends on it.
 *
 * 30 is comfortably above what a typical user keeps open in an IDE-
 * style file tree and conservatively below the per-tab WebSocket
 * limits browsers impose. Tune up if file-tree UX feels stale for
 * very deep navigation; tune down if memory pressure on low-end
 * devices becomes a concern.
 */
const MAX_ACTIVE_SUBSCRIPTIONS_PER_WORKSPACE = 30

const workspaceKey = (
  scope: WorkspaceNodeScope,
  teamId: string,
  workspaceId: string
) => `${scope}:${teamId}:${workspaceId}`

const parentKey = (
  scope: WorkspaceNodeScope,
  teamId: string,
  workspaceId: string,
  parentId: string
) => `${workspaceKey(scope, teamId, workspaceId)}:${parentId}`

export const useFileTreeStore = defineStore("fileTree", () => {
  const {
    listChildren,
    subscribeChildren: subscribeChildrenService,
    getNode: fetchNode,
    createFolder,
    createFile,
    renameNode,
    moveNode: moveNodeService,
    archiveNode: archiveNodeService,
    unarchiveNode: unarchiveNodeService,
    deleteNode: deleteNodeService,
    updateFileContent,
  } = useNodes()

  const nodesByWorkspace = reactive<
    Record<string, Record<string, WorkspaceNode>>
  >({})
  const childrenByWorkspace = reactive<
    Record<string, Record<string, string[]>>
  >({})
  const paginationByWorkspace = reactive<
    Record<string, Record<string, PaginationState>>
  >({})

  const subscriptions: Record<string, Record<string, () => void>> = {}
  const expanded = reactive(new Set<string>())
  const loadingParents = reactive(new Set<string>())
  const selectedByWorkspace = reactive<Record<string, string | null>>({})
  const workspaceRetainCounts = reactive<Record<string, number>>({})
  const runWrite = useRunWrite("fileTree.nodes")

  // Per-folder children live in the TanStack cache under `folderNodesKey`; the
  // reactive `nodesByWorkspace`/`childrenByWorkspace` buckets the UI reads are a
  // MIRROR rebuilt from the cache by `syncFolderToBuckets` (the bridge below).
  // Optimism flows through `runWrite({ keys: [folderNodesKey(...)] })`: the hold
  // stashes inbound listener snapshots so the optimistic bucket edit survives,
  // then reconciles to server truth on release — replacing the old
  // pendingNodeIds/applyChildrenResult protection.
  const folderRegistry = new Map<
    string,
    {
      scope: WorkspaceNodeScope
      teamId: string
      workspaceId: string
      parentId: string
    }
  >()
  const folderNodesKey = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string
  ): FirestoreQueryKey =>
    queryKeys.list(`teams/${teamId}/workspaces/${workspaceId}/${scope}`, {
      parentId,
      includeArchived: INCLUDE_ARCHIVED,
    })

  const getWorkspaceBuckets = (key: string) => {
    const nodes = (nodesByWorkspace[key] ??= {})
    const children = (childrenByWorkspace[key] ??= {})
    const pagination = (paginationByWorkspace[key] ??= {})
    const subs = (subscriptions[key] ??= {})

    return { nodes, children, pagination, subs }
  }

  const assertValidName = (name: string) => {
    const normalized = normalizeName(name)
    if (!normalized.length || normalized.length > NODE_NAME_MAX_LENGTH) {
      throw new Error(
        `Name must be between 1 and ${NODE_NAME_MAX_LENGTH} chars`
      )
    }
    return normalized
  }

  const sortChildIds = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    ids: string[]
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const nodes = nodesByWorkspace[key] ?? {}

    return [...ids].sort((a, b) => {
      const nodeA = nodes[a]
      const nodeB = nodes[b]
      if (!nodeA || !nodeB) return 0
      if (nodeA.typeOrder !== nodeB.typeOrder) {
        return nodeA.typeOrder - nodeB.typeOrder
      }
      const sortA = String(nodeA.sortKey ?? nodeA.nameLower)
      const sortB = String(nodeB.sortKey ?? nodeB.nameLower)
      if (sortA !== sortB) {
        return sortA.localeCompare(sortB)
      }
      return nodeA.nameLower.localeCompare(nodeB.nameLower)
    })
  }

  const setChildren = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    ids: string[]
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const { children } = getWorkspaceBuckets(key)
    children[parentId] = ids
  }

  const upsertNodes = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodes: WorkspaceNode[]
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const { nodes: bucket } = getWorkspaceBuckets(key)

    nodes.forEach((node) => {
      bucket[node.id] = node
    })
  }

  const updateNode = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    updates: Partial<WorkspaceNode>
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const { nodes: bucket } = getWorkspaceBuckets(key)
    const current = bucket[nodeId]
    if (!current) return
    bucket[nodeId] = { ...current, ...updates }
  }

  const removeNode = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const { nodes } = getWorkspaceBuckets(key)
    delete nodes[nodeId]
  }

  const replaceNodeId = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    tempId: string,
    actualId: string
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const { nodes, children } = getWorkspaceBuckets(key)
    const tempNode = nodes[tempId]
    if (!tempNode) return
    const actualNode = { ...tempNode, id: actualId }
    delete nodes[tempId]
    nodes[actualId] = actualNode

    Object.keys(children).forEach((parentId) => {
      const list = children[parentId] ?? []
      const idx = list.indexOf(tempId)
      if (idx >= 0) {
        const next = [...list]
        next.splice(idx, 1, actualId)
        children[parentId] = next
      }
    })

    if (selectedByWorkspace[key] === tempId) {
      selectedByWorkspace[key] = actualId
    }
  }

  const updatePagination = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    next: Partial<PaginationState>
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const { pagination } = getWorkspaceBuckets(key)
    const existing = pagination[parentId] ?? {
      lastDoc: null,
      hasMore: false,
      loadingMore: false,
    }
    pagination[parentId] = { ...existing, ...next }
  }

  const getChildrenIds = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string
  ): string[] => {
    const key = workspaceKey(scope, teamId, workspaceId)
    return childrenByWorkspace[key]?.[parentId] ?? []
  }

  const getNode = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): WorkspaceNode | null => {
    const key = workspaceKey(scope, teamId, workspaceId)
    return nodesByWorkspace[key]?.[nodeId] ?? null
  }

  const isExpanded = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => expanded.has(parentKey(scope, teamId, workspaceId, nodeId))

  const setExpanded = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    value: boolean
  ) => {
    const key = parentKey(scope, teamId, workspaceId, nodeId)
    if (value) {
      expanded.add(key)
    } else {
      expanded.delete(key)
    }
  }

  const isParentLoading = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string
  ) => loadingParents.has(parentKey(scope, teamId, workspaceId, parentId))

  const setParentLoading = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    value: boolean
  ) => {
    const key = parentKey(scope, teamId, workspaceId, parentId)
    if (value) {
      loadingParents.add(key)
    } else {
      loadingParents.delete(key)
    }
  }

  const getPagination = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string
  ): PaginationState => {
    const key = workspaceKey(scope, teamId, workspaceId)
    return (
      paginationByWorkspace[key]?.[parentId] ?? {
        lastDoc: null,
        hasMore: false,
        loadingMore: false,
      }
    )
  }

  const setSelectedNode = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string | null
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    selectedByWorkspace[key] = nodeId
  }

  const getSelectedNodeId = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    return selectedByWorkspace[key] ?? null
  }

  const getSelectedNode = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string
  ) => {
    const selectedId = getSelectedNodeId(scope, teamId, workspaceId)
    if (!selectedId) return null
    return getNode(scope, teamId, workspaceId, selectedId)
  }

  const ensureNodeLoaded = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<WorkspaceNode | null> => {
    const cachedNode = getNode(scope, teamId, workspaceId, nodeId)
    if (cachedNode) {
      return cachedNode
    }

    const fetchedNode = await fetchNode(scope, teamId, workspaceId, nodeId)
    if (!fetchedNode) {
      return null
    }

    upsertNodes(scope, teamId, workspaceId, [fetchedNode])
    return fetchedNode
  }

  // ── Cache → bucket bridge ───────────────────────────────────────────────────
  // Each expanded folder's children are streamed into the TanStack cache under
  // `folderNodesKey`. This mirrors every cache change for a registered folder
  // back into the reactive buckets the UI reads — replacing the hand-rolled
  // `applyChildrenResult`. Optimistic edits survive because `runWrite`'s hold
  // stashes inbound snapshots (no cache update fires while held), so the
  // optimistic bucket edit is reconciled to server truth only on release.
  const syncFolderToBuckets = (coords: {
    scope: WorkspaceNodeScope
    teamId: string
    workspaceId: string
    parentId: string
  }) => {
    const { scope, teamId, workspaceId, parentId } = coords
    const nodes =
      queryClient.getQueryData<WorkspaceNode[]>(
        folderNodesKey(scope, teamId, workspaceId, parentId)
      ) ?? []
    upsertNodes(scope, teamId, workspaceId, nodes)
    setChildren(
      scope,
      teamId,
      workspaceId,
      parentId,
      nodes.map((node) => node.id)
    )
  }

  let cacheBridgeInstalled = false
  const ensureCacheBridge = () => {
    if (cacheBridgeInstalled) return
    cacheBridgeInstalled = true
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" && event.type !== "added") return
      const coords = folderRegistry.get(event.query.queryHash)
      if (coords) syncFolderToBuckets(coords)
    })
  }

  const subscribeChildren = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const { subs } = getWorkspaceBuckets(key)

    if (subs[parentId]) return

    ensureCacheBridge()

    // LRU cap on live subscriptions per workspace. `Object.keys` on a plain
    // object preserves insertion order in V8, so iterating forward finds the
    // oldest first. Skip ROOT_PARENT_ID — the workspace navigation depends on it
    // being live. The evicted folder's last-seen children stay rendered (the
    // cache entry is dropped, the bucket is not); live updates resume on
    // re-expand.
    const activeIds = Object.keys(subs)
    if (activeIds.length >= MAX_ACTIVE_SUBSCRIPTIONS_PER_WORKSPACE) {
      const evictableId = activeIds.find((id) => id !== ROOT_PARENT_ID)
      if (evictableId) {
        subs[evictableId]?.()
        delete subs[evictableId]
      }
    }

    setParentLoading(scope, teamId, workspaceId, parentId, true)

    const fKey = folderNodesKey(scope, teamId, workspaceId, parentId)
    folderRegistry.set(hashKey(fKey), { scope, teamId, workspaceId, parentId })

    let isActive = true

    // `streamIntoCache` opens the per-folder listener, resolves on the first
    // snapshot, and streams later snapshots into the cache (stashing them while
    // an optimistic hold is active). It does NOT write the cache on hydration,
    // so the resolved first page is written below; both paths fire the bridge.
    streamIntoCache<WorkspaceNode[]>(fKey, (onNext, onError) =>
      subscribeChildrenService(
        scope,
        teamId,
        workspaceId,
        parentId,
        (result) => {
          if (!isActive) return
          setParentLoading(scope, teamId, workspaceId, parentId, false)
          updatePagination(scope, teamId, workspaceId, parentId, {
            lastDoc: result.lastDoc,
            hasMore: result.hasMore,
          })
          onNext(result.nodes)
        },
        {
          includeArchived: INCLUDE_ARCHIVED,
          limit: DEFAULT_CHILDREN_PAGE_SIZE,
          onError: (error) => onError(error as FirestoreError),
        }
      )
    )
      .then((firstNodes) => {
        if (isActive) queryClient.setQueryData(fKey, firstNodes)
      })
      .catch((error) => {
        if (!isActive) return
        console.error("[fileTreeStore] Failed to subscribe to children:", error)
        setParentLoading(scope, teamId, workspaceId, parentId, false)
        updatePagination(scope, teamId, workspaceId, parentId, {
          hasMore: false,
        })
      })

    subs[parentId] = () => {
      isActive = false
      folderRegistry.delete(hashKey(fKey))
      // Dropping the query triggers `streamIntoCache`'s gc teardown, which
      // closes the underlying `onSnapshot`. The bucket is left intact so the
      // last-seen children stay rendered (LRU / collapse semantics). Clearing
      // the loading flag here avoids a stranded spinner if teardown beat the
      // first snapshot.
      queryClient.removeQueries({ queryKey: fKey, exact: true })
      setParentLoading(scope, teamId, workspaceId, parentId, false)
    }
  }

  const unsubscribeChildren = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const subs = subscriptions[key]
    const existing = subs?.[parentId]
    if (existing && subs) {
      existing()
      delete subs[parentId]
    }
  }

  const expandFolder = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    setExpanded(scope, teamId, workspaceId, nodeId, true)
    subscribeChildren(scope, teamId, workspaceId, nodeId)
  }

  const collapseFolder = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    setExpanded(scope, teamId, workspaceId, nodeId, false)
    unsubscribeChildren(scope, teamId, workspaceId, nodeId)
  }

  const ensureRootSubscribed = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string
  ) => {
    subscribeChildren(scope, teamId, workspaceId, ROOT_PARENT_ID)
  }

  const loadMore = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string
  ) => {
    const pagination = getPagination(scope, teamId, workspaceId, parentId)
    if (!pagination.hasMore || pagination.loadingMore) return

    updatePagination(scope, teamId, workspaceId, parentId, {
      loadingMore: true,
    })

    try {
      const result = await listChildren(scope, teamId, workspaceId, parentId, {
        includeArchived: INCLUDE_ARCHIVED,
        limit: DEFAULT_CHILDREN_PAGE_SIZE,
        startAfter: pagination.lastDoc ?? undefined,
      })

      // Append the next page into both the cache (so the bridge keeps the bucket
      // in sync, and a held optimistic edit isn't lost) and dedup by id. A later
      // live snapshot replaces the entry with the most-recent page, same as
      // before — loadMore's older rows are best-effort until then.
      const cached =
        queryClient.getQueryData<WorkspaceNode[]>(
          folderNodesKey(scope, teamId, workspaceId, parentId)
        ) ?? []
      const byId = new Map(cached.map((node) => [node.id, node]))
      result.nodes.forEach((node) => byId.set(node.id, node))
      queryClient.setQueryData(
        folderNodesKey(scope, teamId, workspaceId, parentId),
        [...byId.values()]
      )
      updatePagination(scope, teamId, workspaceId, parentId, {
        lastDoc: result.lastDoc,
        hasMore: result.hasMore,
      })
    } finally {
      updatePagination(scope, teamId, workspaceId, parentId, {
        loadingMore: false,
      })
    }
  }

  const cleanupWorkspaceState = (key: string) => {
    Object.values(subscriptions[key] ?? {}).forEach((unsubscribe) => {
      unsubscribe()
    })

    delete subscriptions[key]
    delete nodesByWorkspace[key]
    delete childrenByWorkspace[key]
    delete paginationByWorkspace[key]
    delete selectedByWorkspace[key]
    ;[...expanded].forEach((entry) => {
      if (entry.startsWith(`${key}:`)) {
        expanded.delete(entry)
      }
    })
    ;[...loadingParents].forEach((entry) => {
      if (entry.startsWith(`${key}:`)) {
        loadingParents.delete(entry)
      }
    })
  }

  const retainWorkspace = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    workspaceRetainCounts[key] = (workspaceRetainCounts[key] ?? 0) + 1
  }

  const releaseWorkspace = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const nextCount = (workspaceRetainCounts[key] ?? 0) - 1

    if (nextCount > 0) {
      workspaceRetainCounts[key] = nextCount
      return
    }

    delete workspaceRetainCounts[key]
    cleanupWorkspaceState(key)
  }

  const createFolderNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    name: string
  ) => {
    const normalizedName = assertValidName(name)
    const tempId = `temp_${generateOperationId()}`
    const nameLower = toNameLower(normalizedName)
    const now = Timestamp.now()
    const optimisticNode: WorkspaceNode = {
      id: tempId,
      workspaceId,
      type: "folder",
      typeOrder: getTypeOrder("folder"),
      name: normalizedName,
      nameLower,
      parentId,
      isArchived: false,
      createdAt: now,
      createdBy: "local",
      updatedAt: now,
      updatedBy: "local",
      sortKey: nameLower,
    }

    const key = workspaceKey(scope, teamId, workspaceId)
    const { nodes, children } = getWorkspaceBuckets(key)
    const hadParent = Object.prototype.hasOwnProperty.call(children, parentId)
    const previousChildren = cloneState(children[parentId] ?? [])

    let createdId = ""
    await runWrite({
      keys: [folderNodesKey(scope, teamId, workspaceId, parentId)],
      apply: () => {
        nodes[tempId] = optimisticNode
        const next = hadParent ? [...previousChildren] : []
        if (!next.includes(tempId)) {
          next.push(tempId)
        }
        children[parentId] = sortChildIds(scope, teamId, workspaceId, next)
      },
      rollback: () => {
        removeNode(scope, teamId, workspaceId, tempId)
        if (hadParent) {
          children[parentId] = previousChildren
        } else {
          delete children[parentId]
        }
      },
      fn: async () => {
        const actualId = await createFolder(
          scope,
          teamId,
          workspaceId,
          parentId,
          normalizedName
        )
        replaceNodeId(scope, teamId, workspaceId, tempId, actualId)
        createdId = actualId
      },
    })

    return createdId
  }

  const createFileNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    name: string
  ) => {
    const normalizedName = assertValidName(name)
    const tempId = `temp_${generateOperationId()}`
    const nameLower = toNameLower(normalizedName)
    const now = Timestamp.now()
    const optimisticNode: WorkspaceNode = {
      id: tempId,
      workspaceId,
      type: "file",
      typeOrder: getTypeOrder("file"),
      name: normalizedName,
      nameLower,
      parentId,
      isArchived: false,
      createdAt: now,
      createdBy: "local",
      updatedAt: now,
      updatedBy: "local",
      sortKey: nameLower,
      content: "",
    }

    const key = workspaceKey(scope, teamId, workspaceId)
    const { nodes, children } = getWorkspaceBuckets(key)
    const hadParent = Object.prototype.hasOwnProperty.call(children, parentId)
    const previousChildren = cloneState(children[parentId] ?? [])

    let createdId = ""
    await runWrite({
      keys: [folderNodesKey(scope, teamId, workspaceId, parentId)],
      apply: () => {
        nodes[tempId] = optimisticNode
        const next = hadParent ? [...previousChildren] : []
        if (!next.includes(tempId)) {
          next.push(tempId)
        }
        children[parentId] = sortChildIds(scope, teamId, workspaceId, next)
      },
      rollback: () => {
        removeNode(scope, teamId, workspaceId, tempId)
        if (hadParent) {
          children[parentId] = previousChildren
        } else {
          delete children[parentId]
        }
      },
      fn: async () => {
        const actualId = await createFile(
          scope,
          teamId,
          workspaceId,
          parentId,
          normalizedName
        )
        replaceNodeId(scope, teamId, workspaceId, tempId, actualId)
        createdId = actualId
      },
    })

    return createdId
  }

  const renameNodeAction = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    name: string
  ) => {
    const normalizedName = assertValidName(name)
    const existing =
      getNode(scope, teamId, workspaceId, nodeId) ??
      (await fetchNode(scope, teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const nameLower = toNameLower(normalizedName)
    const key = workspaceKey(scope, teamId, workspaceId)
    const { children } = getWorkspaceBuckets(key)
    const parentId = existing.parentId
    const hadParent = Object.prototype.hasOwnProperty.call(children, parentId)
    const previousChildren = cloneState(children[parentId] ?? [])
    const previousNode = cloneState(existing)

    await runWrite({
      keys: [folderNodesKey(scope, teamId, workspaceId, parentId)],
      apply: () => {
        updateNode(scope, teamId, workspaceId, nodeId, {
          name: normalizedName,
          nameLower,
          sortKey: nameLower,
        })
        if (hadParent) {
          children[parentId] = sortChildIds(
            scope,
            teamId,
            workspaceId,
            children[parentId] ?? []
          )
        }
      },
      rollback: () => {
        upsertNodes(scope, teamId, workspaceId, [previousNode])
        if (hadParent) {
          children[parentId] = previousChildren
        } else {
          delete children[parentId]
        }
      },
      fn: async () => {
        await renameNode(scope, teamId, workspaceId, nodeId, normalizedName)
      },
    })
  }

  const archiveNodeAction = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    const existing =
      getNode(scope, teamId, workspaceId, nodeId) ??
      (await fetchNode(scope, teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const previousNode = cloneState(existing)
    const now = Timestamp.now()

    await runWrite({
      keys: [folderNodesKey(scope, teamId, workspaceId, existing.parentId)],
      apply: () => {
        updateNode(scope, teamId, workspaceId, nodeId, {
          isArchived: true,
          archivedAt: now,
          archivedBy: "local",
        })
      },
      rollback: () => {
        upsertNodes(scope, teamId, workspaceId, [previousNode])
      },
      fn: async () => {
        await archiveNodeService(scope, teamId, workspaceId, nodeId)
      },
    })
  }

  const unarchiveNodeAction = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    const existing =
      getNode(scope, teamId, workspaceId, nodeId) ??
      (await fetchNode(scope, teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const previousNode = cloneState(existing)

    await runWrite({
      keys: [folderNodesKey(scope, teamId, workspaceId, existing.parentId)],
      apply: () => {
        updateNode(scope, teamId, workspaceId, nodeId, {
          isArchived: false,
          archivedAt: undefined,
          archivedBy: undefined,
        })
      },
      rollback: () => {
        upsertNodes(scope, teamId, workspaceId, [previousNode])
      },
      fn: async () => {
        await unarchiveNodeService(scope, teamId, workspaceId, nodeId)
      },
    })
  }

  const collectLoadedSubtreeIds = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    rootNodeId: string
  ): string[] => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const nodes = nodesByWorkspace[key] ?? {}
    if (!nodes[rootNodeId]) return []

    const parentToChildren: Record<string, string[]> = {}
    Object.values(nodes).forEach((node) => {
      ;(parentToChildren[node.parentId] ??= []).push(node.id)
    })

    const ids: string[] = []
    const visited = new Set<string>()
    const stack = [rootNodeId]

    while (stack.length) {
      const currentId = stack.pop()
      if (!currentId || visited.has(currentId)) continue
      visited.add(currentId)
      ids.push(currentId)

      const childrenIds = parentToChildren[currentId] ?? []
      childrenIds.forEach((childId) => {
        if (!visited.has(childId)) {
          stack.push(childId)
        }
      })
    }

    return ids
  }

  const deleteNodeAction = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    const existing =
      getNode(scope, teamId, workspaceId, nodeId) ??
      (await fetchNode(scope, teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const key = workspaceKey(scope, teamId, workspaceId)
    const { nodes, children } = getWorkspaceBuckets(key)
    const idsToRemove = collectLoadedSubtreeIds(
      scope,
      teamId,
      workspaceId,
      nodeId
    )
    const loadedIds = idsToRemove.length ? idsToRemove : [nodeId]
    const idsToRemoveSet = new Set(loadedIds)
    const previousNodes = loadedIds
      .map((id) => nodes[id])
      .filter((node): node is WorkspaceNode => Boolean(node))
      .map((node) => cloneState(node))
    const previousChildren = cloneState(children)
    const previousSelectedId = selectedByWorkspace[key] ?? null

    await runWrite({
      keys: [folderNodesKey(scope, teamId, workspaceId, existing.parentId)],
      apply: () => {
        loadedIds.forEach((id) => {
          delete nodes[id]
          delete children[id]
        })

        Object.keys(children).forEach((parentId) => {
          children[parentId] = (children[parentId] ?? []).filter(
            (id) => !idsToRemoveSet.has(id)
          )
        })

        if (previousSelectedId && idsToRemoveSet.has(previousSelectedId)) {
          selectedByWorkspace[key] = null
        }
      },
      rollback: () => {
        previousNodes.forEach((node) => {
          nodes[node.id] = node
        })
        Object.keys(children).forEach((parentId) => {
          delete children[parentId]
        })
        Object.entries(previousChildren).forEach(([parentId, ids]) => {
          children[parentId] = ids
        })
        selectedByWorkspace[key] = previousSelectedId
      },
      fn: async () => {
        await deleteNodeService(scope, teamId, workspaceId, nodeId)
      },
    })
  }

  const saveFileContent = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    content: string
  ) => {
    const existing =
      getNode(scope, teamId, workspaceId, nodeId) ??
      (await fetchNode(scope, teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("File not found")
    }

    const previousNode = cloneState(existing)

    await runWrite({
      keys: [folderNodesKey(scope, teamId, workspaceId, existing.parentId)],
      apply: () => {
        updateNode(scope, teamId, workspaceId, nodeId, { content })
      },
      rollback: () => {
        upsertNodes(scope, teamId, workspaceId, [previousNode])
      },
      fn: async () => {
        await updateFileContent(scope, teamId, workspaceId, nodeId, content)
      },
    })
  }

  const canMoveNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    newParentId: string
  ) => {
    if (nodeId === newParentId) return false
    if (newParentId === ROOT_PARENT_ID) return true

    let cursorId: string | null = newParentId
    const visited = new Set<string>()

    while (cursorId && cursorId !== ROOT_PARENT_ID) {
      if (cursorId === nodeId) return false
      if (visited.has(cursorId)) break
      visited.add(cursorId)

      const cached = getNode(scope, teamId, workspaceId, cursorId)
      if (cached) {
        cursorId = cached.parentId
        continue
      }

      const fetched = await fetchNode(scope, teamId, workspaceId, cursorId)
      if (!fetched) break

      upsertNodes(scope, teamId, workspaceId, [fetched])
      cursorId = fetched.parentId
    }

    return true
  }

  const moveNodeAction = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    newParentId: string
  ) => {
    if (!(await canMoveNode(scope, teamId, workspaceId, nodeId, newParentId))) {
      throw new Error("Cannot move a folder into itself or its descendants")
    }

    const existing =
      getNode(scope, teamId, workspaceId, nodeId) ??
      (await fetchNode(scope, teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const currentParentId = existing.parentId
    if (currentParentId === newParentId) return

    const key = workspaceKey(scope, teamId, workspaceId)
    const { children } = getWorkspaceBuckets(key)
    const hadOldParent = Object.prototype.hasOwnProperty.call(
      children,
      currentParentId
    )
    const hadNewParent = Object.prototype.hasOwnProperty.call(
      children,
      newParentId
    )
    const previousOldChildren = cloneState(children[currentParentId] ?? [])
    const previousNewChildren = cloneState(children[newParentId] ?? [])
    const previousNode = cloneState(existing)

    await runWrite({
      keys: [
        folderNodesKey(scope, teamId, workspaceId, currentParentId),
        folderNodesKey(scope, teamId, workspaceId, newParentId),
      ],
      apply: () => {
        updateNode(scope, teamId, workspaceId, nodeId, {
          parentId: newParentId,
        })
        if (hadOldParent) {
          children[currentParentId] = (children[currentParentId] ?? []).filter(
            (id) => id !== nodeId
          )
        }
        const nextNewChildren = hadNewParent
          ? [...(children[newParentId] ?? [])]
          : []
        if (!nextNewChildren.includes(nodeId)) {
          nextNewChildren.push(nodeId)
        }
        children[newParentId] = sortChildIds(
          scope,
          teamId,
          workspaceId,
          nextNewChildren
        )
      },
      rollback: () => {
        upsertNodes(scope, teamId, workspaceId, [previousNode])
        if (hadOldParent) {
          children[currentParentId] = previousOldChildren
        } else {
          delete children[currentParentId]
        }
        if (hadNewParent) {
          children[newParentId] = previousNewChildren
        } else {
          delete children[newParentId]
        }
      },
      fn: async () => {
        await moveNodeService(scope, teamId, workspaceId, nodeId, newParentId)
      },
    })
  }

  const getFolderOptions = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string
  ) => {
    const key = workspaceKey(scope, teamId, workspaceId)
    const nodes = Object.values(nodesByWorkspace[key] ?? {})

    return nodes
      .filter((node) => node.type === "folder" && !node.isArchived)
      .sort((a, b) => {
        if (a.typeOrder !== b.typeOrder) {
          return a.typeOrder - b.typeOrder
        }
        return a.nameLower.localeCompare(b.nameLower)
      })
  }

  const getFolderPath = (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    const parts: string[] = []
    let currentId: string | null = nodeId
    const visited = new Set<string>()

    while (currentId && currentId !== ROOT_PARENT_ID) {
      if (visited.has(currentId)) break
      visited.add(currentId)
      const node = getNode(scope, teamId, workspaceId, currentId)
      if (!node) break
      parts.unshift(node.name)
      currentId = node.parentId
    }

    return parts.join(" /")
  }

  return {
    nodesByWorkspace,
    childrenByWorkspace,
    expanded,
    loadingParents,
    getNode,
    getChildrenIds,
    isExpanded,
    isParentLoading,
    getPagination,
    getSelectedNodeId,
    getSelectedNode,
    setSelectedNode,
    ensureNodeLoaded,
    retainWorkspace,
    releaseWorkspace,
    ensureRootSubscribed,
    subscribeChildren,
    unsubscribeChildren,
    expandFolder,
    collapseFolder,
    loadMore,
    createFolderNode,
    createFileNode,
    renameNodeAction,
    moveNodeAction,
    archiveNodeAction,
    unarchiveNodeAction,
    deleteNodeAction,
    saveFileContent,
    getFolderOptions,
    getFolderPath,
  }
})

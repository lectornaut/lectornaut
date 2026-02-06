import { DEFAULT_CHILDREN_PAGE_SIZE, useNodes } from "@/composables/useNodes"
import {
  NODE_NAME_MAX_LENGTH,
  ROOT_PARENT_ID,
  getTypeOrder,
  normalizeName,
  toNameLower,
  type WorkspaceNode,
} from "@/types"
import {
  cloneState,
  createPendingSet,
  generateOperationId,
  withOptimisticUpdate,
} from "@/utils/firebase-optimistic"
import { Timestamp, type QueryDocumentSnapshot } from "firebase/firestore"
import { defineStore } from "pinia"
import { reactive, shallowRef } from "vue"

interface PaginationState {
  lastDoc: QueryDocumentSnapshot | null
  hasMore: boolean
  loadingMore: boolean
}

const INCLUDE_ARCHIVED = true

const workspaceKey = (teamId: string, workspaceId: string) =>
  `${teamId}:${workspaceId}`

const parentKey = (teamId: string, workspaceId: string, parentId: string) =>
  `${workspaceKey(teamId, workspaceId)}:${parentId}`

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
  const pendingNodeIds = shallowRef(createPendingSet())
  const optimisticCreatedIds = new Set<string>()

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

  const isProtectedNode = (nodeId: string) =>
    pendingNodeIds.value.has(nodeId) || optimisticCreatedIds.has(nodeId)

  const sortChildIds = (teamId: string, workspaceId: string, ids: string[]) => {
    const key = workspaceKey(teamId, workspaceId)
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
    teamId: string,
    workspaceId: string,
    parentId: string,
    ids: string[]
  ) => {
    const key = workspaceKey(teamId, workspaceId)
    const { children } = getWorkspaceBuckets(key)
    children[parentId] = ids
  }

  const upsertNodes = (
    teamId: string,
    workspaceId: string,
    nodes: WorkspaceNode[]
  ) => {
    const key = workspaceKey(teamId, workspaceId)
    const { nodes: bucket } = getWorkspaceBuckets(key)

    nodes.forEach((node) => {
      bucket[node.id] = node
    })
  }

  const updateNode = (
    teamId: string,
    workspaceId: string,
    nodeId: string,
    updates: Partial<WorkspaceNode>
  ) => {
    const key = workspaceKey(teamId, workspaceId)
    const { nodes: bucket } = getWorkspaceBuckets(key)
    const current = bucket[nodeId]
    if (!current) return
    bucket[nodeId] = { ...current, ...updates }
  }

  const removeNode = (teamId: string, workspaceId: string, nodeId: string) => {
    const key = workspaceKey(teamId, workspaceId)
    const { nodes } = getWorkspaceBuckets(key)
    delete nodes[nodeId]
  }

  const replaceNodeId = (
    teamId: string,
    workspaceId: string,
    tempId: string,
    actualId: string
  ) => {
    const key = workspaceKey(teamId, workspaceId)
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
    teamId: string,
    workspaceId: string,
    parentId: string,
    next: Partial<PaginationState>
  ) => {
    const key = workspaceKey(teamId, workspaceId)
    const { pagination } = getWorkspaceBuckets(key)
    const existing = pagination[parentId] ?? {
      lastDoc: null,
      hasMore: false,
      loadingMore: false,
    }
    pagination[parentId] = { ...existing, ...next }
  }

  const getChildrenIds = (
    teamId: string,
    workspaceId: string,
    parentId: string
  ): string[] => {
    const key = workspaceKey(teamId, workspaceId)
    return childrenByWorkspace[key]?.[parentId] ?? []
  }

  const getNode = (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): WorkspaceNode | null => {
    const key = workspaceKey(teamId, workspaceId)
    return nodesByWorkspace[key]?.[nodeId] ?? null
  }

  const isExpanded = (teamId: string, workspaceId: string, nodeId: string) =>
    expanded.has(parentKey(teamId, workspaceId, nodeId))

  const setExpanded = (
    teamId: string,
    workspaceId: string,
    nodeId: string,
    value: boolean
  ) => {
    const key = parentKey(teamId, workspaceId, nodeId)
    if (value) {
      expanded.add(key)
    } else {
      expanded.delete(key)
    }
  }

  const isParentLoading = (
    teamId: string,
    workspaceId: string,
    parentId: string
  ) => loadingParents.has(parentKey(teamId, workspaceId, parentId))

  const setParentLoading = (
    teamId: string,
    workspaceId: string,
    parentId: string,
    value: boolean
  ) => {
    const key = parentKey(teamId, workspaceId, parentId)
    if (value) {
      loadingParents.add(key)
    } else {
      loadingParents.delete(key)
    }
  }

  const getPagination = (
    teamId: string,
    workspaceId: string,
    parentId: string
  ): PaginationState => {
    const key = workspaceKey(teamId, workspaceId)
    return (
      paginationByWorkspace[key]?.[parentId] ?? {
        lastDoc: null,
        hasMore: false,
        loadingMore: false,
      }
    )
  }

  const setSelectedNode = (
    teamId: string,
    workspaceId: string,
    nodeId: string | null
  ) => {
    const key = workspaceKey(teamId, workspaceId)
    selectedByWorkspace[key] = nodeId
  }

  const getSelectedNodeId = (teamId: string, workspaceId: string) => {
    const key = workspaceKey(teamId, workspaceId)
    return selectedByWorkspace[key] ?? null
  }

  const getSelectedNode = (teamId: string, workspaceId: string) => {
    const selectedId = getSelectedNodeId(teamId, workspaceId)
    if (!selectedId) return null
    return getNode(teamId, workspaceId, selectedId)
  }

  const ensureNodeLoaded = async (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<WorkspaceNode | null> => {
    const cachedNode = getNode(teamId, workspaceId, nodeId)
    if (cachedNode) {
      return cachedNode
    }

    const fetchedNode = await fetchNode(teamId, workspaceId, nodeId)
    if (!fetchedNode) {
      return null
    }

    upsertNodes(teamId, workspaceId, [fetchedNode])
    return fetchedNode
  }

  const subscribeChildren = (
    teamId: string,
    workspaceId: string,
    parentId: string
  ) => {
    const key = workspaceKey(teamId, workspaceId)
    const { subs } = getWorkspaceBuckets(key)

    if (subs[parentId]) return

    setParentLoading(teamId, workspaceId, parentId, true)

    const unsubscribe = subscribeChildrenService(
      teamId,
      workspaceId,
      parentId,
      (result) => {
        setParentLoading(teamId, workspaceId, parentId, false)
        const { nodes: bucket } = getWorkspaceBuckets(key)
        const mergedNodes: WorkspaceNode[] = []
        let mergedChildIds: string[] = []

        result.nodes.forEach((node) => {
          const local = bucket[node.id]
          if (isProtectedNode(node.id) && local) {
            mergedNodes.push(local)
            if (local.parentId === parentId) {
              mergedChildIds.push(local.id)
            }
            return
          }
          mergedNodes.push(node)
          mergedChildIds.push(node.id)
        })

        Object.values(bucket).forEach((local) => {
          if (!isProtectedNode(local.id)) return
          if (local.parentId !== parentId) return
          if (mergedChildIds.includes(local.id)) return
          mergedNodes.push(local)
          mergedChildIds.push(local.id)
        })

        upsertNodes(teamId, workspaceId, mergedNodes)

        if (mergedChildIds.some((id) => isProtectedNode(id))) {
          mergedChildIds = sortChildIds(teamId, workspaceId, mergedChildIds)
        }
        setChildren(teamId, workspaceId, parentId, mergedChildIds)

        if (optimisticCreatedIds.size) {
          result.nodes.forEach((node) => {
            if (optimisticCreatedIds.has(node.id)) {
              optimisticCreatedIds.delete(node.id)
            }
          })
        }

        updatePagination(teamId, workspaceId, parentId, {
          lastDoc: result.lastDoc,
          hasMore: result.hasMore,
        })
      },
      {
        includeArchived: INCLUDE_ARCHIVED,
        limit: DEFAULT_CHILDREN_PAGE_SIZE,
        onError: (error) => {
          console.error(
            "[fileTreeStore] Failed to subscribe to children:",
            error
          )
          setParentLoading(teamId, workspaceId, parentId, false)
          updatePagination(teamId, workspaceId, parentId, {
            hasMore: false,
          })
        },
      }
    )

    subs[parentId] = unsubscribe
  }

  const unsubscribeChildren = (
    teamId: string,
    workspaceId: string,
    parentId: string
  ) => {
    const key = workspaceKey(teamId, workspaceId)
    const subs = subscriptions[key]
    const existing = subs?.[parentId]
    if (existing && subs) {
      existing()
      delete subs[parentId]
    }
  }

  const expandFolder = (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    setExpanded(teamId, workspaceId, nodeId, true)
    subscribeChildren(teamId, workspaceId, nodeId)
  }

  const collapseFolder = (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    setExpanded(teamId, workspaceId, nodeId, false)
    unsubscribeChildren(teamId, workspaceId, nodeId)
  }

  const ensureRootSubscribed = (teamId: string, workspaceId: string) => {
    subscribeChildren(teamId, workspaceId, ROOT_PARENT_ID)
  }

  const loadMore = async (
    teamId: string,
    workspaceId: string,
    parentId: string
  ) => {
    const pagination = getPagination(teamId, workspaceId, parentId)
    if (!pagination.hasMore || pagination.loadingMore) return

    updatePagination(teamId, workspaceId, parentId, { loadingMore: true })

    try {
      const result = await listChildren(teamId, workspaceId, parentId, {
        includeArchived: INCLUDE_ARCHIVED,
        limit: DEFAULT_CHILDREN_PAGE_SIZE,
        startAfter: pagination.lastDoc ?? undefined,
      })

      const mergedNodes = result.nodes.map((node) => {
        if (isProtectedNode(node.id)) {
          const local = getNode(teamId, workspaceId, node.id)
          if (local) return local
        }
        return node
      })

      upsertNodes(teamId, workspaceId, mergedNodes)
      const current = getChildrenIds(teamId, workspaceId, parentId)
      const merged = [...current]

      mergedNodes.forEach((node) => {
        if (!merged.includes(node.id)) {
          merged.push(node.id)
        }
      })

      const sorted = merged.some((id) => isProtectedNode(id))
        ? sortChildIds(teamId, workspaceId, merged)
        : merged
      setChildren(teamId, workspaceId, parentId, sorted)
      updatePagination(teamId, workspaceId, parentId, {
        lastDoc: result.lastDoc,
        hasMore: result.hasMore,
      })
    } finally {
      updatePagination(teamId, workspaceId, parentId, { loadingMore: false })
    }
  }

  const cleanupWorkspace = (teamId: string, workspaceId: string) => {
    const key = workspaceKey(teamId, workspaceId)

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

  const createFolderNode = async (
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

    const key = workspaceKey(teamId, workspaceId)
    const { nodes, children } = getWorkspaceBuckets(key)
    const hadParent = Object.prototype.hasOwnProperty.call(children, parentId)
    const previousChildren = cloneState(children[parentId] ?? [])

    const nodeId = await withOptimisticUpdate(
      pendingNodeIds,
      tempId,
      () => {
        nodes[tempId] = optimisticNode
        const next = hadParent ? [...previousChildren] : []
        if (!next.includes(tempId)) {
          next.push(tempId)
        }
        children[parentId] = sortChildIds(teamId, workspaceId, next)
      },
      () => {
        removeNode(teamId, workspaceId, tempId)
        if (hadParent) {
          children[parentId] = previousChildren
        } else {
          delete children[parentId]
        }
      },
      async () => {
        const actualId = await createFolder(
          teamId,
          workspaceId,
          parentId,
          normalizedName
        )
        replaceNodeId(teamId, workspaceId, tempId, actualId)
        optimisticCreatedIds.add(actualId)
        return actualId
      }
    )

    return nodeId
  }

  const createFileNode = async (
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

    const key = workspaceKey(teamId, workspaceId)
    const { nodes, children } = getWorkspaceBuckets(key)
    const hadParent = Object.prototype.hasOwnProperty.call(children, parentId)
    const previousChildren = cloneState(children[parentId] ?? [])

    const nodeId = await withOptimisticUpdate(
      pendingNodeIds,
      tempId,
      () => {
        nodes[tempId] = optimisticNode
        const next = hadParent ? [...previousChildren] : []
        if (!next.includes(tempId)) {
          next.push(tempId)
        }
        children[parentId] = sortChildIds(teamId, workspaceId, next)
      },
      () => {
        removeNode(teamId, workspaceId, tempId)
        if (hadParent) {
          children[parentId] = previousChildren
        } else {
          delete children[parentId]
        }
      },
      async () => {
        const actualId = await createFile(
          teamId,
          workspaceId,
          parentId,
          normalizedName
        )
        replaceNodeId(teamId, workspaceId, tempId, actualId)
        optimisticCreatedIds.add(actualId)
        return actualId
      }
    )

    return nodeId
  }

  const renameNodeAction = async (
    teamId: string,
    workspaceId: string,
    nodeId: string,
    name: string
  ) => {
    const normalizedName = assertValidName(name)
    const existing =
      getNode(teamId, workspaceId, nodeId) ??
      (await fetchNode(teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const nameLower = toNameLower(normalizedName)
    const key = workspaceKey(teamId, workspaceId)
    const { children } = getWorkspaceBuckets(key)
    const parentId = existing.parentId
    const hadParent = Object.prototype.hasOwnProperty.call(children, parentId)
    const previousChildren = cloneState(children[parentId] ?? [])
    const previousNode = cloneState(existing)

    await withOptimisticUpdate(
      pendingNodeIds,
      nodeId,
      () => {
        updateNode(teamId, workspaceId, nodeId, {
          name: normalizedName,
          nameLower,
          sortKey: nameLower,
        })
        if (hadParent) {
          children[parentId] = sortChildIds(
            teamId,
            workspaceId,
            children[parentId] ?? []
          )
        }
      },
      () => {
        upsertNodes(teamId, workspaceId, [previousNode])
        if (hadParent) {
          children[parentId] = previousChildren
        } else {
          delete children[parentId]
        }
      },
      async () => {
        await renameNode(teamId, workspaceId, nodeId, normalizedName)
      }
    )
  }

  const archiveNodeAction = async (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    const existing =
      getNode(teamId, workspaceId, nodeId) ??
      (await fetchNode(teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const previousNode = cloneState(existing)
    const now = Timestamp.now()

    await withOptimisticUpdate(
      pendingNodeIds,
      nodeId,
      () => {
        updateNode(teamId, workspaceId, nodeId, {
          isArchived: true,
          archivedAt: now,
          archivedBy: "local",
        })
      },
      () => {
        upsertNodes(teamId, workspaceId, [previousNode])
      },
      async () => {
        await archiveNodeService(teamId, workspaceId, nodeId)
      }
    )
  }

  const unarchiveNodeAction = async (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    const existing =
      getNode(teamId, workspaceId, nodeId) ??
      (await fetchNode(teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const previousNode = cloneState(existing)

    await withOptimisticUpdate(
      pendingNodeIds,
      nodeId,
      () => {
        updateNode(teamId, workspaceId, nodeId, {
          isArchived: false,
          archivedAt: undefined,
          archivedBy: undefined,
        })
      },
      () => {
        upsertNodes(teamId, workspaceId, [previousNode])
      },
      async () => {
        await unarchiveNodeService(teamId, workspaceId, nodeId)
      }
    )
  }

  const collectLoadedSubtreeIds = (
    teamId: string,
    workspaceId: string,
    rootNodeId: string
  ): string[] => {
    const key = workspaceKey(teamId, workspaceId)
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
    teamId: string,
    workspaceId: string,
    nodeId: string
  ) => {
    const existing =
      getNode(teamId, workspaceId, nodeId) ??
      (await fetchNode(teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }
    if (!existing.isArchived) {
      throw new Error("Archive the node before deleting it permanently")
    }

    const key = workspaceKey(teamId, workspaceId)
    const { nodes, children } = getWorkspaceBuckets(key)
    const idsToRemove = collectLoadedSubtreeIds(teamId, workspaceId, nodeId)
    const loadedIds = idsToRemove.length ? idsToRemove : [nodeId]
    const idsToRemoveSet = new Set(loadedIds)
    const previousNodes = loadedIds
      .map((id) => nodes[id])
      .filter((node): node is WorkspaceNode => Boolean(node))
      .map((node) => cloneState(node))
    const previousChildren = cloneState(children)
    const previousSelectedId = selectedByWorkspace[key] ?? null

    await withOptimisticUpdate(
      pendingNodeIds,
      nodeId,
      () => {
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
      () => {
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
      async () => {
        await deleteNodeService(teamId, workspaceId, nodeId)
      }
    )
  }

  const saveFileContent = async (
    teamId: string,
    workspaceId: string,
    nodeId: string,
    content: string
  ) => {
    const existing =
      getNode(teamId, workspaceId, nodeId) ??
      (await fetchNode(teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("File not found")
    }

    const previousNode = cloneState(existing)

    await withOptimisticUpdate(
      pendingNodeIds,
      nodeId,
      () => {
        updateNode(teamId, workspaceId, nodeId, { content })
      },
      () => {
        upsertNodes(teamId, workspaceId, [previousNode])
      },
      async () => {
        await updateFileContent(teamId, workspaceId, nodeId, content)
      }
    )
  }

  const canMoveNode = async (
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

      const cached = getNode(teamId, workspaceId, cursorId)
      if (cached) {
        cursorId = cached.parentId
        continue
      }

      const fetched = await fetchNode(teamId, workspaceId, cursorId)
      if (!fetched) break

      upsertNodes(teamId, workspaceId, [fetched])
      cursorId = fetched.parentId
    }

    return true
  }

  const moveNodeAction = async (
    teamId: string,
    workspaceId: string,
    nodeId: string,
    newParentId: string
  ) => {
    if (!(await canMoveNode(teamId, workspaceId, nodeId, newParentId))) {
      throw new Error("Cannot move a folder into itself or its descendants")
    }

    const existing =
      getNode(teamId, workspaceId, nodeId) ??
      (await fetchNode(teamId, workspaceId, nodeId))
    if (!existing) {
      throw new Error("Node not found")
    }

    const currentParentId = existing.parentId
    if (currentParentId === newParentId) return

    const key = workspaceKey(teamId, workspaceId)
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

    await withOptimisticUpdate(
      pendingNodeIds,
      nodeId,
      () => {
        updateNode(teamId, workspaceId, nodeId, { parentId: newParentId })
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
          teamId,
          workspaceId,
          nextNewChildren
        )
      },
      () => {
        upsertNodes(teamId, workspaceId, [previousNode])
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
      async () => {
        await moveNodeService(teamId, workspaceId, nodeId, newParentId)
      }
    )
  }

  const getFolderOptions = (teamId: string, workspaceId: string) => {
    const key = workspaceKey(teamId, workspaceId)
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
      const node = getNode(teamId, workspaceId, currentId)
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
    ensureRootSubscribed,
    subscribeChildren,
    unsubscribeChildren,
    expandFolder,
    collapseFolder,
    loadMore,
    cleanupWorkspace,
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

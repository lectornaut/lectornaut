import {
  archiveWorkspaceNode,
  createWorkspaceNode,
  deleteWorkspaceNode,
  moveWorkspaceNode,
  renameWorkspaceNode,
  unarchiveWorkspaceNode,
  updateWorkspaceNodeContent,
} from "@/composables/useFunctions"
import { firestore } from "@/modules/firebase"
import {
  NODE_NAME_MAX_LENGTH,
  normalizeName,
  type NodeType,
  type WorkspaceNode,
} from "@/types"
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitQuery,
  onSnapshot,
  orderBy,
  query,
  startAfter as startAfterQuery,
  where,
  type DocumentData,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore"

export const DEFAULT_CHILDREN_PAGE_SIZE = 50

export interface ListChildrenOptions {
  limit?: number
  startAfter?: QueryDocumentSnapshot<DocumentData>
  includeArchived?: boolean
}

export interface SubscribeChildrenOptions extends ListChildrenOptions {
  onError?: (error: Error) => void
}

export interface ChildrenResult {
  nodes: WorkspaceNode[]
  lastDoc: QueryDocumentSnapshot<DocumentData> | null
  hasMore: boolean
}

const getNodesCollection = (teamId: string, workspaceId: string) =>
  collection(firestore, "teams", teamId, "workspaces", workspaceId, "nodes")

const toNode = (docSnap: QueryDocumentSnapshot<DocumentData>): WorkspaceNode =>
  ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<WorkspaceNode, "id">),
  }) as WorkspaceNode

const buildChildrenQuery = (
  teamId: string,
  workspaceId: string,
  parentId: string,
  options: ListChildrenOptions = {}
): Query => {
  const nodesRef = getNodesCollection(teamId, workspaceId)
  const clauses: QueryConstraint[] = [
    where("parentId", "==", parentId),
    orderBy("typeOrder"),
    orderBy("sortKey"),
    orderBy("nameLower"),
  ]

  if (!options.includeArchived) {
    clauses.unshift(where("isArchived", "==", false))
  }

  if (options.startAfter) {
    clauses.push(startAfterQuery(options.startAfter))
  }

  if (options.limit) {
    clauses.push(limitQuery(options.limit))
  }

  return query(nodesRef, ...clauses)
}

const assertValidName = (name: string) => {
  const normalized = normalizeName(name)
  if (!normalized.length || normalized.length > NODE_NAME_MAX_LENGTH) {
    throw new Error(`Name must be between 1 and ${NODE_NAME_MAX_LENGTH} chars`)
  }
  return normalized
}

export function useNodes() {
  const listChildren = async (
    teamId: string,
    workspaceId: string,
    parentId: string,
    options: ListChildrenOptions = {}
  ): Promise<ChildrenResult> => {
    const limit = options.limit ?? DEFAULT_CHILDREN_PAGE_SIZE
    const snapshot = await getDocs(
      buildChildrenQuery(teamId, workspaceId, parentId, {
        ...options,
        limit,
      })
    )

    const nodes = snapshot.docs.map(toNode)
    const lastDoc = snapshot.docs.at(-1) ?? null

    return {
      nodes,
      lastDoc,
      hasMore: snapshot.size === limit,
    }
  }

  const subscribeChildren = (
    teamId: string,
    workspaceId: string,
    parentId: string,
    callback: (result: ChildrenResult) => void,
    options: SubscribeChildrenOptions = {}
  ): Unsubscribe => {
    const limit = options.limit ?? DEFAULT_CHILDREN_PAGE_SIZE

    return onSnapshot(
      buildChildrenQuery(teamId, workspaceId, parentId, {
        ...options,
        limit,
      }),
      (snapshot) => {
        const nodes = snapshot.docs.map(toNode)
        const lastDoc = snapshot.docs.at(-1) ?? null

        callback({
          nodes,
          lastDoc,
          hasMore: snapshot.size === limit,
        })
      },
      (error) => {
        options.onError?.(error as Error)
      }
    )
  }

  const getNode = async (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<WorkspaceNode | null> => {
    const nodeSnap = await getDoc(
      doc(getNodesCollection(teamId, workspaceId), nodeId)
    )

    if (!nodeSnap.exists()) return null

    return {
      id: nodeSnap.id,
      ...(nodeSnap.data() as Omit<WorkspaceNode, "id">),
    } as WorkspaceNode
  }

  const createNode = async (
    teamId: string,
    workspaceId: string,
    parentId: string,
    name: string,
    type: NodeType
  ): Promise<string> => {
    const normalizedName = assertValidName(name)
    const { data } = await createWorkspaceNode({
      teamId,
      workspaceId,
      parentId,
      name: normalizedName,
      type,
    })

    return data.nodeId
  }

  const createFolder = async (
    teamId: string,
    workspaceId: string,
    parentId: string,
    name: string
  ): Promise<string> =>
    createNode(teamId, workspaceId, parentId, name, "folder")

  const createFile = async (
    teamId: string,
    workspaceId: string,
    parentId: string,
    name: string
  ): Promise<string> => createNode(teamId, workspaceId, parentId, name, "file")

  const renameNode = async (
    teamId: string,
    workspaceId: string,
    nodeId: string,
    newName: string
  ): Promise<void> => {
    const normalizedName = assertValidName(newName)
    await renameWorkspaceNode({
      teamId,
      workspaceId,
      nodeId,
      name: normalizedName,
    })
  }

  const moveNode = async (
    teamId: string,
    workspaceId: string,
    nodeId: string,
    newParentId: string
  ): Promise<void> => {
    if (nodeId === newParentId) {
      throw new Error("A node cannot be its own parent")
    }
    await moveWorkspaceNode({
      teamId,
      workspaceId,
      nodeId,
      parentId: newParentId,
    })
  }

  const archiveNode = async (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<void> => {
    await archiveWorkspaceNode({
      teamId,
      workspaceId,
      nodeId,
    })
  }

  const unarchiveNode = async (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<void> => {
    await unarchiveWorkspaceNode({
      teamId,
      workspaceId,
      nodeId,
    })
  }

  const deleteNode = async (
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<void> => {
    await deleteWorkspaceNode({
      teamId,
      workspaceId,
      nodeId,
    })
  }

  const updateFileContent = async (
    teamId: string,
    workspaceId: string,
    nodeId: string,
    content: string
  ): Promise<void> => {
    await updateWorkspaceNodeContent({
      teamId,
      workspaceId,
      nodeId,
      content,
    })
  }

  return {
    listChildren,
    subscribeChildren,
    getNode,
    createFolder,
    createFile,
    renameNode,
    moveNode,
    archiveNode,
    unarchiveNode,
    deleteNode,
    updateFileContent,
  }
}

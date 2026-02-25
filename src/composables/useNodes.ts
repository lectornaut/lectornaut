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
  type WorkspaceNodeScope,
} from "@/types/nodes"
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

const getNodesCollection = (
  scope: WorkspaceNodeScope,
  teamId: string,
  workspaceId: string
) => collection(firestore, "teams", teamId, "workspaces", workspaceId, scope)

const toNode = (docSnap: QueryDocumentSnapshot<DocumentData>): WorkspaceNode =>
  ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<WorkspaceNode, "id">),
  }) as WorkspaceNode

const buildChildrenQuery = (
  scope: WorkspaceNodeScope,
  teamId: string,
  workspaceId: string,
  parentId: string,
  options: ListChildrenOptions = {}
): Query => {
  const nodesRef = getNodesCollection(scope, teamId, workspaceId)
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
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    options: ListChildrenOptions = {}
  ): Promise<ChildrenResult> => {
    const limit = options.limit ?? DEFAULT_CHILDREN_PAGE_SIZE
    const snapshot = await getDocs(
      buildChildrenQuery(scope, teamId, workspaceId, parentId, {
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
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    callback: (result: ChildrenResult) => void,
    options: SubscribeChildrenOptions = {}
  ): Unsubscribe => {
    const limit = options.limit ?? DEFAULT_CHILDREN_PAGE_SIZE

    return onSnapshot(
      buildChildrenQuery(scope, teamId, workspaceId, parentId, {
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
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<WorkspaceNode | null> => {
    const nodeSnap = await getDoc(
      doc(getNodesCollection(scope, teamId, workspaceId), nodeId)
    )

    if (!nodeSnap.exists()) return null

    return {
      id: nodeSnap.id,
      ...(nodeSnap.data() as Omit<WorkspaceNode, "id">),
    } as WorkspaceNode
  }

  const createNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    name: string,
    type: NodeType
  ): Promise<string> => {
    const normalizedName = assertValidName(name)
    const { data } = await createWorkspaceNode({
      scope,
      teamId,
      workspaceId,
      parentId,
      name: normalizedName,
      type,
    })

    return data.nodeId
  }

  const createFolder = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    name: string
  ): Promise<string> =>
    createNode(scope, teamId, workspaceId, parentId, name, "folder")

  const createFile = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    parentId: string,
    name: string
  ): Promise<string> =>
    createNode(scope, teamId, workspaceId, parentId, name, "file")

  const renameNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    newName: string
  ): Promise<void> => {
    const normalizedName = assertValidName(newName)
    await renameWorkspaceNode({
      scope,
      teamId,
      workspaceId,
      nodeId,
      name: normalizedName,
    })
  }

  const moveNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    newParentId: string
  ): Promise<void> => {
    if (nodeId === newParentId) {
      throw new Error("A node cannot be its own parent")
    }
    await moveWorkspaceNode({
      scope,
      teamId,
      workspaceId,
      nodeId,
      parentId: newParentId,
    })
  }

  const archiveNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<void> => {
    await archiveWorkspaceNode({
      scope,
      teamId,
      workspaceId,
      nodeId,
    })
  }

  const unarchiveNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<void> => {
    await unarchiveWorkspaceNode({
      scope,
      teamId,
      workspaceId,
      nodeId,
    })
  }

  const deleteNode = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string
  ): Promise<void> => {
    await deleteWorkspaceNode({
      scope,
      teamId,
      workspaceId,
      nodeId,
    })
  }

  const updateFileContent = async (
    scope: WorkspaceNodeScope,
    teamId: string,
    workspaceId: string,
    nodeId: string,
    content: string
  ): Promise<void> => {
    await updateWorkspaceNodeContent({
      scope,
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

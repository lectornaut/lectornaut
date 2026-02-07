import { firestore, functions } from "@/modules/firebase"
import type { WorkspaceNodeScope } from "@/types"
import {
  collection,
  onSnapshot,
  query,
  where,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"

export type CollabRole = "editor" | "viewer"
export type SignalType = "offer" | "answer" | "ice"

export interface JoinCollabRoomRequest {
  contentId: string
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
}

export interface JoinCollabRoomResponse {
  role: CollabRole
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  displayName: string
  userId: string
  joinToken: string
  expiresAt: number
}

export interface CreatePeerRequest {
  contentId: string
  peerId: string
  displayName: string
  color: string
  joinToken: string
}

export interface HeartbeatPeerRequest {
  contentId: string
  peerId: string
  joinToken: string
}

export interface SendSignalRequest {
  contentId: string
  fromPeerId: string
  toPeerId: string
  type: SignalType
  payload: unknown
  joinToken: string
}

export interface DeletePeerRequest {
  contentId: string
  peerId: string
  joinToken: string
}

export interface DeleteSignalRequest {
  contentId: string
  signalId: string
}

export interface CollabPeer {
  peerId: string
  userId: string
  displayName: string
  color: string
  role: CollabRole
  joinedAt?: Timestamp
  lastSeenAt?: Timestamp
}

export interface CollabSignal {
  id: string
  fromPeerId: string
  toPeerId: string
  type: SignalType
  payload: unknown
  createdAt?: Timestamp
}

const joinCollabRoomCallable = httpsCallable<
  JoinCollabRoomRequest,
  JoinCollabRoomResponse
>(functions, "joinCollabRoom")

const createPeerCallable = httpsCallable<CreatePeerRequest, { ok: true }>(
  functions,
  "createPeer"
)

const heartbeatPeerCallable = httpsCallable<HeartbeatPeerRequest, { ok: true }>(
  functions,
  "heartbeatPeer"
)

const sendSignalCallable = httpsCallable<SendSignalRequest, { ok: true }>(
  functions,
  "sendSignal"
)

const deletePeerCallable = httpsCallable<DeletePeerRequest, { ok: true }>(
  functions,
  "deletePeer"
)

const deleteSignalCallable = httpsCallable<DeleteSignalRequest, { ok: true }>(
  functions,
  "deleteSignal"
)

export async function joinCollabRoom(
  payload: JoinCollabRoomRequest
): Promise<JoinCollabRoomResponse> {
  const result = await joinCollabRoomCallable(payload)
  return result.data
}

export async function createPeer(payload: CreatePeerRequest): Promise<void> {
  await createPeerCallable(payload)
}

export async function heartbeatPeer(
  payload: HeartbeatPeerRequest
): Promise<void> {
  await heartbeatPeerCallable(payload)
}

export async function sendSignal(payload: SendSignalRequest): Promise<void> {
  await sendSignalCallable(payload)
}

export async function deletePeer(payload: DeletePeerRequest): Promise<void> {
  await deletePeerCallable(payload)
}

export async function deleteSignal(
  payload: DeleteSignalRequest
): Promise<void> {
  await deleteSignalCallable(payload)
}

export function subscribePeers(
  contentId: string,
  callback: (peers: CollabPeer[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const peersRef = collection(
    firestore,
    "content_signaling",
    contentId,
    "peers"
  )

  return onSnapshot(
    peersRef,
    (snapshot) => {
      const peers: CollabPeer[] = []

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as Partial<CollabPeer>
        if (
          typeof data.peerId !== "string" ||
          typeof data.userId !== "string" ||
          typeof data.displayName !== "string" ||
          typeof data.color !== "string" ||
          (data.role !== "editor" && data.role !== "viewer")
        ) {
          return
        }

        peers.push({
          peerId: data.peerId,
          userId: data.userId,
          displayName: data.displayName,
          color: data.color,
          role: data.role,
          joinedAt: data.joinedAt,
          lastSeenAt: data.lastSeenAt,
        })
      })

      callback(peers)
    },
    (error) => {
      onError?.(error as Error)
    }
  )
}

export function subscribeIncomingSignals(
  contentId: string,
  toPeerId: string,
  onSignal: (signal: CollabSignal) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const signalsRef = collection(
    firestore,
    "content_signaling",
    contentId,
    "signals"
  )

  const incomingSignalsQuery = query(
    signalsRef,
    where("toPeerId", "==", toPeerId)
  )

  return onSnapshot(
    incomingSignalsQuery,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== "added") {
          return
        }

        const data = change.doc.data() as Partial<CollabSignal>
        if (
          typeof data.fromPeerId !== "string" ||
          typeof data.toPeerId !== "string" ||
          (data.type !== "offer" &&
            data.type !== "answer" &&
            data.type !== "ice")
        ) {
          return
        }

        onSignal({
          id: change.doc.id,
          fromPeerId: data.fromPeerId,
          toPeerId: data.toPeerId,
          type: data.type,
          payload: data.payload,
          createdAt: data.createdAt,
        })
      })
    },
    (error) => {
      onError?.(error as Error)
    }
  )
}

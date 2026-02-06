import { colorFromUserId } from "@/collab/colors"
import {
  createPeer,
  deletePeer,
  deleteSignal,
  heartbeatPeer,
  joinCollabRoom,
  sendSignal,
  subscribeIncomingSignals,
  subscribePeers,
  type CollabPeer,
  type CollabRole,
  type JoinCollabRoomResponse,
} from "@/collab/signaling"
import { createSnapshotManager, loadSnapshot } from "@/collab/snapshots"
import { WebRtcMesh } from "@/collab/webrtcMesh"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { yCollab } from "y-codemirror.next"
import * as awarenessProtocol from "y-protocols/awareness"
import { Awareness } from "y-protocols/awareness"
import * as Y from "yjs"

const REMOTE_DOC_ORIGIN = Symbol("remote-doc")
const REMOTE_AWARENESS_ORIGIN = Symbol("remote-awareness")
const HEARTBEAT_INTERVAL_MS = 25_000

export interface CollabUser {
  uid: string
  displayName?: string | null
  photoURL?: string | null
}

export interface CreateYjsCollabOptions {
  contentId: string
  teamId: string
  workspaceId: string
  initialContent?: string
  user: CollabUser
}

export interface YjsCollabSession {
  role: CollabRole
  peerId: string
  awareness: Awareness
  getExtensions: () => Extension[]
  getText: () => string
  destroy: () => Promise<void>
}

export async function createYjsCollab(
  options: CreateYjsCollabOptions
): Promise<YjsCollabSession> {
  const peerId = crypto.randomUUID()

  const join = await joinCollabRoom({
    contentId: options.contentId,
    teamId: options.teamId,
    workspaceId: options.workspaceId,
  })

  const ydoc = new Y.Doc()
  const ytext = ydoc.getText("codemirror")
  let hasSnapshot = false

  try {
    const snapshot = await loadSnapshot(options.contentId)
    if (snapshot) {
      Y.applyUpdate(ydoc, snapshot)
      hasSnapshot = true
    }
  } catch (error) {
    console.error("[collab] Failed to load snapshot", error)
  }

  if (!hasSnapshot && options.initialContent && ytext.length === 0) {
    ytext.insert(0, options.initialContent)
  }

  const awareness = new Awareness(ydoc)
  const localColor = colorFromUserId(options.user.uid)
  const localName = resolveDisplayName(join, options.user)

  awareness.setLocalState({
    peerId,
    user: {
      userId: options.user.uid,
      name: localName,
      photoURL: options.user.photoURL ?? null,
      color: localColor,
      role: join.role,
    },
  })

  const undoManager = new Y.UndoManager(ytext)
  const extensions: Extension[] = [yCollab(ytext, awareness, { undoManager })]

  if (join.role === "viewer") {
    extensions.push(EditorView.editable.of(false))
  }

  const snapshotManager = createSnapshotManager({
    contentId: options.contentId,
    teamId: join.teamId,
    workspaceId: join.workspaceId,
    ydoc,
    userId: options.user.uid,
    enabled: join.role === "editor",
  })

  let mesh: WebRtcMesh | null = null

  const knownPeers = new Map<string, CollabPeer>()

  mesh = new WebRtcMesh({
    myPeerId: peerId,
    sendSignal: async (toPeerId, type, payload) => {
      await sendSignal({
        contentId: options.contentId,
        fromPeerId: peerId,
        toPeerId,
        type,
        payload,
        joinToken: join.joinToken,
      })
    },
    onYUpdate: (update) => {
      Y.applyUpdate(ydoc, update, REMOTE_DOC_ORIGIN)
    },
    onAwarenessUpdate: (update) => {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        update,
        REMOTE_AWARENESS_ORIGIN
      )
    },
    onPeerConnected: (connectedPeerId) => {
      if (!mesh) {
        return
      }

      mesh.sendYUpdate(Y.encodeStateAsUpdate(ydoc), connectedPeerId)

      const currentClients = [...awareness.getStates().keys()]
      if (!currentClients.length) {
        return
      }

      const encodedAwareness = awarenessProtocol.encodeAwarenessUpdate(
        awareness,
        currentClients
      )
      mesh.sendAwareness(encodedAwareness, connectedPeerId)
    },
  })

  await createPeer({
    contentId: options.contentId,
    peerId,
    displayName: localName,
    color: localColor,
    joinToken: join.joinToken,
  })

  const heartbeatTimer =
    typeof window !== "undefined"
      ? window.setInterval(() => {
          void heartbeatPeer({
            contentId: options.contentId,
            peerId,
            joinToken: join.joinToken,
          }).catch((error) => {
            console.error("[collab] Failed to heartbeat peer", error)
          })
        }, HEARTBEAT_INTERVAL_MS)
      : null

  const unsubscribePeers = subscribePeers(
    options.contentId,
    (peers) => {
      peers.forEach((peer) => {
        knownPeers.set(peer.peerId, peer)
      })

      const currentPeerIds = new Set(peers.map((peer) => peer.peerId))

      peers.forEach((peer) => {
        if (peer.peerId === peerId) {
          return
        }

        mesh?.ensurePeer(peer.peerId)
      })

      mesh?.getPeerIds().forEach((existingPeerId) => {
        if (currentPeerIds.has(existingPeerId)) {
          return
        }
        mesh?.removePeer(existingPeerId)
        knownPeers.delete(existingPeerId)
      })
    },
    (error) => {
      console.error("[collab] Failed to subscribe peers", error)
    }
  )

  const unsubscribeSignals = subscribeIncomingSignals(
    options.contentId,
    peerId,
    (signal) => {
      void mesh
        ?.handleSignal({
          fromPeerId: signal.fromPeerId,
          toPeerId: signal.toPeerId,
          type: signal.type,
          payload: signal.payload,
        })
        .catch((error) => {
          console.error("[collab] Failed to process signal", error)
        })
        .finally(() => {
          void deleteSignal({
            contentId: options.contentId,
            signalId: signal.id,
          }).catch((error) => {
            console.error("[collab] Failed to delete signal", error)
          })
        })
    },
    (error) => {
      console.error("[collab] Failed to subscribe signals", error)
    }
  )

  const handleYdocUpdate = (update: Uint8Array, origin: unknown) => {
    if (!mesh || origin === REMOTE_DOC_ORIGIN) {
      return
    }

    if (join.role === "editor") {
      mesh.sendYUpdate(update)
      snapshotManager.scheduleSave()
    }
  }

  const handleAwarenessUpdate = (
    payload: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (!mesh || origin === REMOTE_AWARENESS_ORIGIN) {
      return
    }

    const changedClients = [
      ...payload.added,
      ...payload.updated,
      ...payload.removed,
    ]
    if (!changedClients.length) {
      return
    }

    const encoded = awarenessProtocol.encodeAwarenessUpdate(
      awareness,
      changedClients
    )

    mesh.sendAwareness(encoded)
  }

  ydoc.on("update", handleYdocUpdate)
  awareness.on("update", handleAwarenessUpdate)

  let isDestroyed = false

  const destroy = async () => {
    if (isDestroyed) {
      return
    }

    isDestroyed = true

    unsubscribeSignals()
    unsubscribePeers()

    if (heartbeatTimer !== null && typeof window !== "undefined") {
      window.clearInterval(heartbeatTimer)
    }

    ydoc.off("update", handleYdocUpdate)
    awareness.off("update", handleAwarenessUpdate)

    awareness.setLocalState(null)
    mesh?.destroy()

    await snapshotManager.destroy()

    try {
      await deletePeer({
        contentId: options.contentId,
        peerId,
        joinToken: join.joinToken,
      })
    } catch (error) {
      console.error("[collab] Failed to delete peer", error)
    }

    ydoc.destroy()
  }

  return {
    role: join.role,
    peerId,
    awareness,
    getExtensions: () => extensions,
    getText: () => ytext.toString(),
    destroy,
  }
}

function resolveDisplayName(
  join: JoinCollabRoomResponse,
  user: CollabUser
): string {
  const fallback = user.displayName?.trim()
  if (typeof join.displayName === "string" && join.displayName.trim()) {
    return join.displayName.trim()
  }

  if (fallback?.length) {
    return fallback
  }

  return "Anonymous"
}

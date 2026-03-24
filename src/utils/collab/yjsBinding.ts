import { generateId } from "@/helpers/utilities"
import type { WorkspaceNodeScope } from "@/types/nodes"
import { colorFromUserId } from "@/utils/collab/colors"
import {
  createPeer,
  deletePeer,
  deleteSignals,
  heartbeatPeer,
  joinCollabRoom,
  sendSignal,
  subscribeIncomingSignals,
  subscribePeers,
  type CollabRole,
  type JoinCollabRoomResponse,
  type SendSignalRequest,
} from "@/utils/collab/signaling"
import { createSnapshotManager, loadSnapshot } from "@/utils/collab/snapshots"
import { WebRtcMesh } from "@/utils/collab/webrtcMesh"
import {
  FirestoreErrorCodes,
  hasFirebaseErrorCode,
  isRetryableFirebaseError,
} from "@/utils/firebase/firebase-errors"
import { useEventListener } from "@vueuse/core"
import * as awarenessProtocol from "y-protocols/awareness"
import { Awareness } from "y-protocols/awareness"
import * as Y from "yjs"

const REMOTE_DOC_ORIGIN = Symbol("remote-doc")
const REMOTE_AWARENESS_ORIGIN = Symbol("remote-awareness")
const HEARTBEAT_INTERVAL_ACTIVE_MS = 30_000 // 30s for faster stale detection
const HEARTBEAT_INTERVAL_HIDDEN_MS = 60_000 // 60s when tab is hidden
const SIGNAL_DELETE_DEBOUNCE_MS = 500 // Faster cleanup
const SIGNAL_DELETE_MAX_BATCH_SIZE = 100 // Larger batches = fewer writes
const SIGNAL_SEND_MAX_ATTEMPTS = 3
const SIGNAL_SEND_RETRY_BASE_DELAY_MS = 100
const PEER_RECONNECT_BASE_DELAY_MS = 1_000
const PEER_RECONNECT_MAX_DELAY_MS = 30_000
const PEER_RECONNECT_JITTER_MS = 500

export interface CollabUser {
  uid: string
  displayName?: string | null
  photoURL?: string | null
}

export interface CreateYjsCollabOptions {
  contentId: string
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  user: CollabUser
}

export interface YjsCollabSession {
  role: CollabRole
  peerId: string
  awareness: Awareness
  ydoc: Y.Doc
  /** Whether a snapshot was loaded from persistence */
  hasSnapshot: boolean
  /** Notify the snapshot manager that the document has changed */
  scheduleSave: () => void
  destroy: () => Promise<void>
}

export async function createYjsCollab(
  options: CreateYjsCollabOptions
): Promise<YjsCollabSession> {
  const peerId = generateId()

  const join = await joinCollabRoom({
    contentId: options.contentId,
    teamId: options.teamId,
    workspaceId: options.workspaceId,
    scope: options.scope,
  })

  const ydoc = new Y.Doc()
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

  const snapshotManager = createSnapshotManager({
    contentId: options.contentId,
    teamId: join.teamId,
    workspaceId: join.workspaceId,
    ydoc,
    userId: options.user.uid,
    enabled: join.role === "editor",
  })

  let mesh: WebRtcMesh | null = null
  let isDestroyed = false

  const pendingSignalDeleteIds = new Set<string>()
  let signalDeleteTimer: ReturnType<typeof setTimeout> | null = null
  const knownPeerIds = new Set<string>()
  const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const reconnectAttempts = new Map<string, number>()

  const clearReconnectTimer = (targetPeerId: string) => {
    const timer = reconnectTimers.get(targetPeerId)
    if (timer) {
      clearTimeout(timer)
      reconnectTimers.delete(targetPeerId)
    }
    reconnectAttempts.delete(targetPeerId)
  }

  const calculateReconnectDelay = (targetPeerId: string): number => {
    const attempts = reconnectAttempts.get(targetPeerId) ?? 0
    const exponentialDelay = Math.min(
      PEER_RECONNECT_BASE_DELAY_MS * Math.pow(2, attempts),
      PEER_RECONNECT_MAX_DELAY_MS
    )
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * PEER_RECONNECT_JITTER_MS
    return exponentialDelay + jitter
  }

  const schedulePeerReconnect = (targetPeerId: string) => {
    if (
      isDestroyed ||
      !knownPeerIds.has(targetPeerId) ||
      reconnectTimers.has(targetPeerId)
    ) {
      return
    }

    const delay = calculateReconnectDelay(targetPeerId)
    reconnectAttempts.set(
      targetPeerId,
      (reconnectAttempts.get(targetPeerId) ?? 0) + 1
    )

    const timer = setTimeout(() => {
      reconnectTimers.delete(targetPeerId)

      if (isDestroyed || !knownPeerIds.has(targetPeerId)) {
        reconnectAttempts.delete(targetPeerId)
        return
      }

      mesh?.ensurePeer(targetPeerId)
    }, delay)

    reconnectTimers.set(targetPeerId, timer)
  }

  mesh = new WebRtcMesh({
    myPeerId: peerId,
    sendSignal: async (toPeerId, type, payload) => {
      await sendSignalWithRetry({
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

      clearReconnectTimer(connectedPeerId)
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
    onPeerDisconnected: (disconnectedPeerId) => {
      schedulePeerReconnect(disconnectedPeerId)
    },
  })

  await createPeer({
    contentId: options.contentId,
    peerId,
    displayName: localName,
    color: localColor,
    joinToken: join.joinToken,
  })

  const flushSignalDeletes = async () => {
    while (pendingSignalDeleteIds.size) {
      const signalIds = [...pendingSignalDeleteIds].slice(
        0,
        SIGNAL_DELETE_MAX_BATCH_SIZE
      )

      signalIds.forEach((signalId) => {
        pendingSignalDeleteIds.delete(signalId)
      })

      try {
        await deleteSignals({
          contentId: options.contentId,
          signalIds,
        })
      } catch (error) {
        signalIds.forEach((signalId) => {
          pendingSignalDeleteIds.add(signalId)
        })
        console.error("[collab] Failed to delete signals", error)
        break
      }
    }

    if (!isDestroyed && pendingSignalDeleteIds.size) {
      scheduleSignalDeleteFlush()
    }
  }

  const scheduleSignalDeleteFlush = () => {
    if (signalDeleteTimer !== null || !pendingSignalDeleteIds.size) {
      return
    }

    signalDeleteTimer = setTimeout(() => {
      signalDeleteTimer = null
      void flushSignalDeletes()
    }, SIGNAL_DELETE_DEBOUNCE_MS)
  }

  const queueSignalDelete = (signalId: string) => {
    pendingSignalDeleteIds.add(signalId)

    if (pendingSignalDeleteIds.size >= SIGNAL_DELETE_MAX_BATCH_SIZE) {
      if (signalDeleteTimer !== null) {
        clearTimeout(signalDeleteTimer)
        signalDeleteTimer = null
      }
      void flushSignalDeletes()
      return
    }

    scheduleSignalDeleteFlush()
  }

  const sendHeartbeat = () => {
    void heartbeatPeer({
      contentId: options.contentId,
      peerId,
      joinToken: join.joinToken,
    }).catch((error) => {
      console.error("[collab] Failed to heartbeat peer", error)
    })
  }

  let heartbeatTimer: number | null = null

  const restartHeartbeatTimer = () => {
    if (typeof window === "undefined") {
      return
    }

    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer)
    }

    const intervalMs = document.hidden
      ? HEARTBEAT_INTERVAL_HIDDEN_MS
      : HEARTBEAT_INTERVAL_ACTIVE_MS

    heartbeatTimer = window.setInterval(() => {
      sendHeartbeat()
    }, intervalMs)
  }

  const handleVisibilityChange = () => {
    if (isDestroyed) {
      return
    }

    restartHeartbeatTimer()
  }

  if (typeof window !== "undefined") {
    sendHeartbeat() // Send first heartbeat immediately so peers see us right away
    restartHeartbeatTimer()
  }
  const stopVisibilityChange =
    typeof document !== "undefined"
      ? useEventListener(document, "visibilitychange", handleVisibilityChange)
      : undefined

  const unsubscribePeers = subscribePeers(
    options.contentId,
    (peers) => {
      const currentPeerIds = new Set<string>()
      peers.forEach((peer) => {
        if (peer.peerId !== peerId) {
          currentPeerIds.add(peer.peerId)
        }
      })

      knownPeerIds.clear()
      currentPeerIds.forEach((currentPeerId) => {
        knownPeerIds.add(currentPeerId)
        mesh?.ensurePeer(currentPeerId)
      })

      mesh?.getPeerIds().forEach((existingPeerId) => {
        if (currentPeerIds.has(existingPeerId)) {
          return
        }
        clearReconnectTimer(existingPeerId)
        mesh?.removePeer(existingPeerId)
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
          queueSignalDelete(signal.id)
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
    stopVisibilityChange?.()

    if (signalDeleteTimer !== null) {
      clearTimeout(signalDeleteTimer)
      signalDeleteTimer = null
    }
    reconnectTimers.forEach((timer) => {
      clearTimeout(timer)
    })
    reconnectTimers.clear()
    reconnectAttempts.clear()
    knownPeerIds.clear()
    await flushSignalDeletes()

    ydoc.off("update", handleYdocUpdate)
    awareness.off("update", handleAwarenessUpdate)

    // Clear local awareness state before destroying mesh so the removal
    // update is broadcast to connected peers
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
    ydoc,
    hasSnapshot,
    scheduleSave: () => snapshotManager.scheduleSave(),
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

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })

function isPeerGoneSignalError(error: unknown): boolean {
  return hasFirebaseErrorCode(error, FirestoreErrorCodes.NOT_FOUND)
}

async function sendSignalWithRetry(payload: SendSignalRequest): Promise<void> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= SIGNAL_SEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      await sendSignal(payload)
      return
    } catch (error) {
      if (isPeerGoneSignalError(error)) {
        // Peer lists are eventually consistent. If either side has already
        // disconnected, treat the signal as stale and continue silently.
        return
      }

      if (!isRetryableFirebaseError(error)) {
        throw error
      }

      lastError = error
      if (attempt >= SIGNAL_SEND_MAX_ATTEMPTS) {
        break
      }

      const retryDelay =
        SIGNAL_SEND_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
      await sleep(retryDelay)
    }
  }

  throw lastError ?? new Error("[collab] Failed to send signaling payload.")
}

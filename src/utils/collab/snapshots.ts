import { firestore } from "@/modules/firebase"
import {
  FirestoreErrorCodes,
  hasFirebaseErrorCode,
} from "@/utils/firebase/firebase-errors"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { useEventListener } from "@vueuse/core"
import { doc, getDoc, Timestamp } from "firebase/firestore"
import {
  fromBase64 as base64ToBytes,
  toBase64 as bytesToBase64,
} from "lib0/buffer"
import * as Y from "yjs"

const DEFAULT_SNAPSHOT_DEBOUNCE_MS = 10_000 // 10s - balance between cost and data safety
const MAX_SNAPSHOT_BYTES = 750_000 // ~750KB limit before base64 expansion hits Firestore's 1MB doc cap

interface SnapshotDoc {
  contentId: string
  teamId: string
  workspaceId: string
  updatedAt: Timestamp
  updatedBy: string
  ydocBase64: string
}

export async function loadSnapshot(
  contentId: string
): Promise<Uint8Array | null> {
  const snapshotRef = doc(firestore, "snapshots", contentId)

  let snapshot

  try {
    // Server-authoritative read (NOT cache-first): the snapshot is mutated
    // server-side by agent edits without a client listener, so a cached read
    // would keep returning a stale/deleted snapshot on reopen — clobbering the
    // newer `content` and reverting agent edits. `getDoc` still falls back to
    // the cache when offline.
    snapshot = await getDoc(snapshotRef)
  } catch (error) {
    // Older rulesets deny reads for missing snapshot docs. Treat that as a miss
    // so collaboration can still initialize while rules are being rolled out.
    if (hasFirebaseErrorCode(error, FirestoreErrorCodes.PERMISSION_DENIED)) {
      return null
    }

    throw error
  }

  if (!snapshot.exists()) {
    return null
  }

  const data = snapshot.data() as Partial<SnapshotDoc>
  if (typeof data.ydocBase64 !== "string" || !data.ydocBase64.length) {
    return null
  }

  return base64ToBytes(data.ydocBase64)
}

export async function saveSnapshot(
  contentId: string,
  teamId: string,
  workspaceId: string,
  ydoc: Y.Doc,
  userId: string
): Promise<void> {
  const stateUpdate = Y.encodeStateAsUpdate(ydoc)

  if (stateUpdate.byteLength > MAX_SNAPSHOT_BYTES) {
    console.warn(
      `[collab:snapshot] Skipping save — doc size ${stateUpdate.byteLength} exceeds ${MAX_SNAPSHOT_BYTES} byte limit`
    )
    return
  }

  const ydocBase64 = bytesToBase64(stateUpdate)

  await mutateSetDocument(
    doc(firestore, "snapshots", contentId),
    {
      contentId,
      teamId,
      workspaceId,
      updatedAt: Timestamp.now(),
      updatedBy: userId,
      ydocBase64,
    },
    { source: "collab.saveSnapshot", merge: true }
  )
}

export interface SnapshotManagerOptions {
  contentId: string
  teamId: string
  workspaceId: string
  ydoc: Y.Doc
  userId: string
  enabled?: boolean
  debounceMs?: number
}

export interface SnapshotManager {
  scheduleSave: () => void
  flush: () => Promise<void>
  destroy: () => Promise<void>
}

export function createSnapshotManager(
  options: SnapshotManagerOptions
): SnapshotManager {
  const enabled = options.enabled ?? true
  const debounceMs = options.debounceMs ?? DEFAULT_SNAPSHOT_DEBOUNCE_MS

  let destroyed = false
  let dirty = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let inFlightSave: Promise<void> | null = null

  const runSave = async (): Promise<void> => {
    if (!enabled || destroyed || !dirty) {
      return
    }

    if (inFlightSave) {
      await inFlightSave
      // Re-check after the in-flight save completes — new changes
      // may have arrived while we were waiting (fixes data loss on destroy)
      if (dirty && !destroyed) {
        return runSave()
      }
      return
    }

    dirty = false

    inFlightSave = saveSnapshot(
      options.contentId,
      options.teamId,
      options.workspaceId,
      options.ydoc,
      options.userId
    )
      .catch((error) => {
        dirty = true
        console.error("[collab:snapshot] Failed to persist snapshot", error)
      })
      .finally(() => {
        inFlightSave = null
      })

    await inFlightSave
  }

  const flush = async () => {
    if (!enabled) {
      return
    }

    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }

    await runSave()
  }

  const scheduleSave = () => {
    if (!enabled || destroyed) {
      return
    }

    dirty = true
    if (saveTimer) {
      return
    }

    saveTimer = setTimeout(() => {
      saveTimer = null
      void runSave()
    }, debounceMs)
  }

  const handleBeforeUnload = () => {
    if (!enabled || !dirty) {
      return
    }

    void runSave()
  }

  const handleVisibilityChange = () => {
    if (typeof document === "undefined") {
      return
    }

    if (document.visibilityState === "hidden") {
      void flush()
    }
  }

  const handlePageHide = () => {
    void flush()
  }

  const stopBeforeUnload =
    typeof window !== "undefined"
      ? useEventListener(window, "beforeunload", handleBeforeUnload)
      : undefined
  const stopPageHide =
    typeof window !== "undefined"
      ? useEventListener(window, "pagehide", handlePageHide)
      : undefined
  const stopVisibilityChange =
    typeof document !== "undefined"
      ? useEventListener(document, "visibilitychange", handleVisibilityChange)
      : undefined

  const destroy = async () => {
    stopBeforeUnload?.()
    stopPageHide?.()
    stopVisibilityChange?.()

    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }

    // Final flush before marking as destroyed
    await runSave()
    destroyed = true
  }

  return {
    scheduleSave,
    flush,
    destroy,
  }
}

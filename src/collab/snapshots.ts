import { base64ToBytes, bytesToBase64 } from "@/collab/base64"
import { firestore } from "@/modules/firebase"
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from "firebase/firestore"
import * as Y from "yjs"

const DEFAULT_SNAPSHOT_DEBOUNCE_MS = 15_000

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
  const snapshotRef = doc(firestore, "content_snapshots", contentId)
  const snapshot = await getDoc(snapshotRef)

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
  const ydocBase64 = bytesToBase64(Y.encodeStateAsUpdate(ydoc))

  await setDoc(
    doc(firestore, "content_snapshots", contentId),
    {
      contentId,
      teamId,
      workspaceId,
      updatedAt: serverTimestamp(),
      updatedBy: userId,
      ydocBase64,
    },
    { merge: true }
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

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", handleBeforeUnload)
  }

  const destroy = async () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }

    await flush()
    destroyed = true
  }

  return {
    scheduleSave,
    flush,
    destroy,
  }
}

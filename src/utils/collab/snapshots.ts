import { firestore } from "@/modules/firebase"
import {
  FirestoreErrorCodes,
  hasFirebaseErrorCode,
} from "@/utils/firebase/firebase-errors"
import { withCloudSyncOperation } from "@/utils/firebase/firebase-optimistic"
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

// Escalating re-arm delays after a failed snapshot save (capped at the last).
export const SNAPSHOT_RETRY_DELAYS_MS: readonly number[] = [
  15_000, 30_000, 60_000,
]
// Cap on how long destroy() waits for the final save's verdict — see destroy.
const DESTROY_SAVE_WAIT_MS = 5_000

export interface SnapshotRetryScheduler {
  /** Arm (or re-arm) the retry timer with the next escalated delay. */
  scheduleNext: () => void
  /**
   * Cancel an armed retry WITHOUT resetting the escalation — used when
   * another save path takes over (edit debounce, flush, teardown).
   */
  cancel: () => void
  /** Cancel and reset the escalation back to the shortest delay (save succeeded). */
  reset: () => void
  isArmed: () => boolean
}

/**
 * Bounded escalating retry for failed snapshot saves.
 *
 * A failed save used to set `dirty` and then wait for the next edit or
 * visibility event — on an idle-but-open editor the last debounce window of
 * edits could sit unsaved indefinitely. Each consecutive failure re-arms with
 * an escalating delay (15s → 30s → 60s cap, retrying at the cap thereafter),
 * a successful save resets the ladder, and an edit/flush/teardown cancels the
 * armed timer because its own save path owns the next attempt.
 */
export function createSnapshotRetryScheduler(
  run: () => void,
  delaysMs: readonly number[] = SNAPSHOT_RETRY_DELAYS_MS
): SnapshotRetryScheduler {
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const scheduleNext = () => {
    cancel()
    const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)]
    attempt += 1
    timer = setTimeout(() => {
      timer = null
      run()
    }, delay)
  }

  const reset = () => {
    cancel()
    attempt = 0
  }

  return {
    scheduleNext,
    cancel,
    reset,
    isArmed: () => timer !== null,
  }
}

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
  // The most recent save failure — re-reported when the indicator's Retry is
  // clicked after the manager was destroyed (see `retrySnapshotSave`).
  let lastSaveError: unknown = null

  // Re-arms a save after a failure so an idle-but-open editor doesn't sit on
  // unsaved edits until the next edit or visibility event.
  const retryScheduler = createSnapshotRetryScheduler(() => {
    void runSave()
  })

  /**
   * The sync indicator's "Retry" action. The indicator clears the error
   * state optimistically BEFORE invoking the handler, so a handler that
   * outlives its manager must not silently no-op — the click would wipe the
   * error while retrying nothing. After destroy (the editor and its ydoc are
   * being torn down; nothing can be re-saved) the handler re-reports the
   * original failure through the same telemetry lane WITHOUT a retry
   * affordance, restoring the honest error instead of swallowing it.
   */
  const retrySnapshotSave = (): Promise<void> => {
    if (!destroyed) return flush()
    return withCloudSyncOperation(
      () =>
        Promise.reject(
          lastSaveError instanceof Error
            ? lastSaveError
            : new Error("Couldn't retry the snapshot save (editor closed)")
        ),
      {
        id: `collab.snapshot.${options.contentId}`,
        source: "collab.saveSnapshot",
      }
    ).catch(() => {
      // The rejection above exists only to restore the indicator's error
      // state; the original failure was already logged when it happened.
    })
  }

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

    inFlightSave = withCloudSyncOperation(
      () =>
        saveSnapshot(
          options.contentId,
          options.teamId,
          options.workspaceId,
          options.ydoc,
          options.userId
        ),
      {
        id: `collab.snapshot.${options.contentId}`,
        source: "collab.saveSnapshot",
        // Surfaced as the sync indicator's "Retry" action on failure —
        // destroy-guarded, see `retrySnapshotSave`.
        retry: () => retrySnapshotSave(),
      }
    )
      .then(() => {
        lastSaveError = null
        retryScheduler.reset()
      })
      .catch((error) => {
        dirty = true
        lastSaveError = error
        console.error("[collab:snapshot] Failed to persist snapshot", error)
        if (!destroyed) {
          retryScheduler.scheduleNext()
        }
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
    // The immediate save below supersedes any armed failure retry.
    retryScheduler.cancel()

    await runSave()
  }

  const scheduleSave = () => {
    if (!enabled || destroyed) {
      return
    }

    dirty = true
    // A fresh edit supersedes any armed failure retry — the debounce below
    // owns the next save attempt.
    retryScheduler.cancel()
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
    retryScheduler.cancel()

    // Final flush before marking as destroyed — BOUNDED. The write is
    // durable the moment it enters the sync outbox; only the server VERDICT
    // is awaited beyond that, and a parked op's verdict can stay pending
    // indefinitely (offline / unreachable backend). The doc-switch path
    // awaits destroy() before creating the next session, so an unbounded
    // wait here wedges the editor with no error. Past the cap the save keeps
    // settling in the background via the outbox.
    await Promise.race([
      runSave(),
      new Promise<void>((resolve) => setTimeout(resolve, DESTROY_SAVE_WAIT_MS)),
    ])
    destroyed = true
    // The final save runs before `destroyed` flips, so a failure re-arms the
    // retry — cancel again so nothing fires after teardown.
    retryScheduler.cancel()
  }

  return {
    scheduleSave,
    flush,
    destroy,
  }
}

import { Timestamp } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import { db } from "./firebase.js"

const DEFAULT_EVENT_LOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_STALE_PROCESSING_MS = 10 * 60 * 1000

type EventLockStatus = "processing" | "done" | "error"

interface EventLockDoc {
  status: EventLockStatus
  updatedAtMs: number
  expiresAt: Timestamp
  lastError: string | null
}

interface RunIdempotentEventOptions {
  key: string
  ttlMs?: number
  staleProcessingMs?: number
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function toLockRef(key: string) {
  return db.collection("functionEventLocks").doc(key)
}

export function makeEventIdempotencyKey(
  functionName: string,
  eventId: string
): string {
  const source = `${functionName}:${eventId}`
  return Buffer.from(source).toString("base64url")
}

export async function runIdempotentEvent(
  options: RunIdempotentEventOptions,
  action: () => Promise<void>
): Promise<{ executed: boolean }> {
  const now = Date.now()
  const ttlMs = Math.max(60_000, options.ttlMs ?? DEFAULT_EVENT_LOCK_TTL_MS)
  const staleProcessingMs = Math.max(
    5_000,
    options.staleProcessingMs ?? DEFAULT_STALE_PROCESSING_MS
  )
  const lockRef = toLockRef(options.key)

  const shouldExecute = await db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef)

    if (lockSnap.exists) {
      const lock = lockSnap.data() as Partial<EventLockDoc>
      const status = getString(lock.status)
      const updatedAtMs = getNumber(lock.updatedAtMs) ?? 0
      const isActiveProcessing =
        status === "processing" && now - updatedAtMs < staleProcessingMs

      if (status === "done" || isActiveProcessing) {
        return false
      }
    }

    transaction.set(
      lockRef,
      {
        status: "processing" satisfies EventLockStatus,
        updatedAtMs: now,
        expiresAt: Timestamp.fromMillis(now + ttlMs),
        lastError: null,
      },
      { merge: true }
    )
    return true
  })

  if (!shouldExecute) {
    return { executed: false }
  }

  try {
    await action()
    await lockRef.set(
      {
        status: "done" satisfies EventLockStatus,
        updatedAtMs: Date.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + ttlMs),
        lastError: null,
      },
      { merge: true }
    )
    return { executed: true }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : String(error)
    await lockRef.set(
      {
        status: "error" satisfies EventLockStatus,
        updatedAtMs: Date.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + ttlMs),
        lastError: message,
      },
      { merge: true }
    )
    logger.warn("[idempotency] Event processing failed", {
      key: options.key,
      message,
    })
    throw error
  }
}

export async function cleanupExpiredIdempotencyLocks(
  options: { batchSize: number } = { batchSize: 450 }
): Promise<number> {
  const batchSize = Math.max(1, Math.min(450, options.batchSize))
  const now = Timestamp.now()
  let totalDeleted = 0

  while (true) {
    const staleLocks = await db
      .collection("functionEventLocks")
      .where("expiresAt", "<", now)
      .limit(batchSize)
      .get()

    if (staleLocks.empty) {
      break
    }

    const batch = db.batch()
    staleLocks.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
    totalDeleted += staleLocks.size

    if (staleLocks.size < batchSize) {
      break
    }
  }

  return totalDeleted
}

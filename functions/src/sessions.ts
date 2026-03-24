import { HttpsError, onCall } from "firebase-functions/v2/https"
import { COST_BUDGET } from "./costBudget.js"
import { admin, db } from "./firebase.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"

const SESSION_ID_RE = /^[A-Za-z0-9-]{8,128}$/

interface RegisterSessionRequest {
  sessionId: string
  deviceName: string
  browser: string
  os: string
  deviceType: "desktop" | "mobile" | "tablet"
}

interface RegisterSessionResponse {
  registered: boolean
  ip: string
}

interface RevokeAllSessionsRequest {
  currentSessionId: string
}

interface RevokeAllSessionsResponse {
  revoked: boolean
  count: number
}

interface RevokeSessionRequest {
  sessionId: string
  currentSessionId?: string
}

interface RevokeSessionResponse {
  revoked: boolean
}

const VALID_DEVICE_TYPES = new Set(["desktop", "mobile", "tablet"])
const MAX_SESSIONS = COST_BUDGET.MAX_SESSIONS

function validateSessionId(id: unknown): asserts id is string {
  if (!id || typeof id !== "string" || !SESSION_ID_RE.test(id)) {
    throw new HttpsError(
      "invalid-argument",
      "sessionId must be 8-128 alphanumeric or hyphen characters."
    )
  }
}

function sanitizeString(
  value: unknown,
  maxLength: number,
  fallback: string
): string {
  if (!value || typeof value !== "string") return fallback
  return value.trim().slice(0, maxLength) || fallback
}

/**
 * Registers a device session for the authenticated user.
 * Captures the client IP from the request headers.
 * Uses merge to preserve createdAt on re-login from the same device.
 */
export const registerSession = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }

  const uid = request.auth.uid
  const data = request.data as RegisterSessionRequest

  validateSessionId(data.sessionId)

  // Firebase Cloud Functions always run behind Google's load balancer,
  // so x-forwarded-for is trustworthy and contains the real client IP first.
  const ip =
    request.rawRequest?.headers?.["x-forwarded-for"]
      ?.toString()
      .split(",")[0]
      ?.trim() ||
    request.rawRequest?.ip ||
    "unknown"

  const deviceName = sanitizeString(data.deviceName, 200, "Unknown Device")
  const browser = sanitizeString(data.browser, 100, "Unknown Browser")
  const os = sanitizeString(data.os, 100, "Unknown OS")
  const deviceType = VALID_DEVICE_TYPES.has(data.deviceType)
    ? data.deviceType
    : "desktop"

  const sessionRef = db.doc(`users/${uid}/sessions/${data.sessionId}`)
  const now = admin.firestore.FieldValue.serverTimestamp()

  const existing = await sessionRef.get()

  await sessionRef.set(
    {
      deviceName,
      browser,
      os,
      deviceType,
      ip,
      // Only set createdAt on first registration
      ...(existing.exists ? {} : { createdAt: now }),
      lastActiveAt: now,
    },
    { merge: true }
  )

  // Evict oldest sessions if the user exceeds the limit
  const sessionsRef = db.collection(`users/${uid}/sessions`)
  const allSessions = await sessionsRef
    .orderBy("lastActiveAt", "asc")
    .limit(MAX_SESSIONS + 1)
    .get()

  if (allSessions.size > MAX_SESSIONS) {
    const batch = db.batch()
    // Filter out current session before slicing to avoid under-eviction
    // when the current session is among the oldest
    const candidates = allSessions.docs.filter((d) => d.id !== data.sessionId)
    const excess = allSessions.size - MAX_SESSIONS
    const toEvict = candidates.slice(0, excess)
    for (const d of toEvict) {
      batch.delete(d.ref)
    }
    if (toEvict.length > 0) {
      await batch.commit()
    }
  }

  return { registered: true, ip } satisfies RegisterSessionResponse
})

/**
 * Revokes all sessions for the authenticated user except the current one.
 * Deletes session documents only — does NOT call revokeRefreshTokens
 * because Firebase Auth has no per-session token revocation and revoking
 * all tokens would also invalidate the caller's own session.
 */
export const revokeAllSessions = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }

  const uid = request.auth.uid
  const data = request.data as RevokeAllSessionsRequest

  validateSessionId(data.currentSessionId)

  const sessionsRef = db.collection(`users/${uid}/sessions`)
  const snapshot = await sessionsRef.get()

  const docsToDelete = snapshot.docs.filter(
    (d) => d.id !== data.currentSessionId
  )

  // Firestore batch limit is 500 — chunk if needed
  const BATCH_LIMIT = COST_BUDGET.MAX_BATCH_SIZE
  for (let i = 0; i < docsToDelete.length; i += BATCH_LIMIT) {
    const batch = db.batch()
    const chunk = docsToDelete.slice(i, i + BATCH_LIMIT)
    for (const d of chunk) {
      batch.delete(d.ref)
    }
    await batch.commit()
  }

  return {
    revoked: true,
    count: docsToDelete.length,
  } satisfies RevokeAllSessionsResponse
})

/**
 * Revokes a single session for the authenticated user.
 * Refuses to delete the caller's current session to prevent self-revocation.
 */
export const revokeSession = onCall(CALLABLE_OPTS, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }

  const uid = request.auth.uid
  const data = request.data as RevokeSessionRequest

  validateSessionId(data.sessionId)

  // Prevent self-revocation — the caller should not revoke their own active session
  if (data.currentSessionId && data.sessionId === data.currentSessionId) {
    throw new HttpsError(
      "invalid-argument",
      "Cannot revoke your own active session."
    )
  }

  const sessionRef = db.doc(`users/${uid}/sessions/${data.sessionId}`)
  const sessionDoc = await sessionRef.get()

  if (!sessionDoc.exists) {
    throw new HttpsError("not-found", "Session not found.")
  }

  await sessionRef.delete()

  return { revoked: true } satisfies RevokeSessionResponse
})

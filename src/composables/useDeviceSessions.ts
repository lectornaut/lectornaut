import {
  registerSessionCallable,
  revokeAllSessions,
  revokeSession,
} from "@/composables/useFunctions"
import { parseUserAgent } from "@/helpers/device"
import { generateRandomString } from "@/helpers/utilities"
import { firestore } from "@/modules/firebase"
import { emitter } from "@/modules/mitt"
import type { IUserSession } from "@/types/session"
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore"
import { useCollection, useCurrentUser, useFirestore } from "vuefire"

const SESSION_ID_KEY = "lectornaut.session.id"

function getOrCreateSessionId(): string {
  let sessionId = localStorage.getItem(SESSION_ID_KEY)
  if (!sessionId) {
    sessionId = generateRandomString()
    localStorage.setItem(SESSION_ID_KEY, sessionId)
  }
  return sessionId
}

// ── Global heartbeat (runs once per app, not per component) ──────────────

let heartbeatInterval: ReturnType<typeof setInterval> | null = null
let unsubscribeSnapshot: (() => void) | null = null
let sessionRevoked = false
let registrationInProgress = false
let verificationInProgress = false

/**
 * Verifies whether the session was genuinely revoked before emitting the event.
 * Firebase Auth tokens expire every ~60 min; during the brief refresh window,
 * Firestore operations can fail with `permission-denied` even though the
 * session doc is perfectly valid. This gate prevents those false positives.
 */
async function verifyRevocation(uid: string) {
  if (sessionRevoked || verificationInProgress) return
  verificationInProgress = true

  const sessionId = getOrCreateSessionId()
  const sessionRef = doc(
    collection(firestore, "users", uid, "sessions"),
    sessionId
  )

  const confirmRevoked = () => {
    sessionRevoked = true
    stopGlobalHeartbeat()
    stopSessionWatcher()
    emitter.emit("session:revoked")
  }

  const tryGetDoc = async (): Promise<boolean | null> => {
    try {
      const snap = await getDoc(sessionRef)
      return snap.exists()
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === "not-found") return false
      if (code === "permission-denied") return null // indeterminate
      return null
    }
  }

  try {
    // Wait for a potential in-flight token refresh to complete
    await new Promise((r) => setTimeout(r, 2000))
    if (sessionRevoked) return

    const exists = await tryGetDoc()
    if (sessionRevoked) return

    if (exists === true) {
      // False positive — session is valid, restart listeners
      console.warn(
        "[session] Verification confirmed session exists — false positive avoided"
      )
      startGlobalHeartbeat(uid)
      startSessionWatcher(uid, true)
      return
    }

    if (exists === false) {
      confirmRevoked()
      return
    }

    // Indeterminate (permission-denied) — retry once after another delay
    await new Promise((r) => setTimeout(r, 3000))
    if (sessionRevoked) return

    const retryExists = await tryGetDoc()
    if (retryExists === true) {
      console.warn(
        "[session] Verification retry confirmed session exists — false positive avoided"
      )
      startGlobalHeartbeat(uid)
      startSessionWatcher(uid, true)
    } else {
      confirmRevoked()
    }
  } finally {
    verificationInProgress = false
  }
}

function startGlobalHeartbeat(uid: string) {
  stopGlobalHeartbeat()
  const sessionId = getOrCreateSessionId()
  const sessionRef = doc(
    collection(firestore, "users", uid, "sessions"),
    sessionId
  )

  const tick = () => {
    updateDoc(sessionRef, { lastActiveAt: serverTimestamp() }).catch(
      (error) => {
        if (
          !sessionRevoked &&
          !registrationInProgress &&
          (error?.code === "not-found" || error?.code === "permission-denied")
        ) {
          verifyRevocation(uid)
        }
      }
    )
  }

  // Skip immediate tick — registerSession already sets lastActiveAt via the
  // cloud function, and an immediate updateDoc could race with Firestore
  // propagation, causing a spurious not-found → false revocation event.
  heartbeatInterval = setInterval(tick, 5 * 60 * 1000) // 5 min
}

function stopGlobalHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
}

// ── Session watcher (detects revocation in real-time) ────────────────────

function startSessionWatcher(uid: string, isResume = false) {
  stopSessionWatcher()

  const sessionId = getOrCreateSessionId()
  const sessionRef = doc(
    collection(firestore, "users", uid, "sessions"),
    sessionId
  )

  let initialSnapshotReceived = false

  unsubscribeSnapshot = onSnapshot(
    sessionRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!initialSnapshotReceived) {
        // On resume, a missing doc from cache is not authoritative — the
        // session doc was created server-side (cloud function) and may not
        // be in the local IndexedDB cache. Wait for the server-confirmed
        // snapshot before deciding on revocation.
        if (isResume && !snapshot.exists() && snapshot.metadata.fromCache) {
          return
        }

        initialSnapshotReceived = true

        if (!snapshot.exists() && isResume) {
          verifyRevocation(uid)
        }
        return
      }

      // After initial snapshot, only react to server-confirmed deletions
      if (snapshot.metadata.fromCache) return

      if (!snapshot.exists() && !sessionRevoked) {
        verifyRevocation(uid)
      }
    },
    (error) => {
      if (
        !sessionRevoked &&
        !registrationInProgress &&
        (error?.code === "permission-denied" || error?.code === "not-found")
      ) {
        verifyRevocation(uid)
      }
    }
  )
}

function stopSessionWatcher() {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot()
    unsubscribeSnapshot = null
  }
}

/**
 * Cleans up all session-related state: heartbeat, snapshot listener, flags.
 * Called during logout (both normal and revoked).
 */
export function cleanupSessionState() {
  stopGlobalHeartbeat()
  stopSessionWatcher()
  sessionRevoked = false
  verificationInProgress = false
}

/**
 * Clears the persisted session ID from localStorage.
 * Called after revoked logout to prevent stale session checks on refresh.
 */
export function clearPersistedSessionId() {
  localStorage.removeItem(SESSION_ID_KEY)
}

/**
 * Resumes the session watcher and heartbeat for an already-authenticated user.
 * Called on app startup (page refresh) to detect sessions revoked while offline.
 */
export function resumeSessionWatcher(uid: string) {
  if (registrationInProgress) return // Fresh login in progress — registerSession handles it
  const sessionId = localStorage.getItem(SESSION_ID_KEY)
  if (!sessionId) return // No persisted session — nothing to resume

  startGlobalHeartbeat(uid)
  startSessionWatcher(uid, true)
}

/**
 * Registers a new session for the given user and starts the heartbeat.
 * Called after successful authentication.
 */
export async function registerSession(uid: string) {
  registrationInProgress = true
  try {
    const sessionId = getOrCreateSessionId()
    const device = await parseUserAgent()

    await registerSessionCallable({
      sessionId,
      deviceName: device.deviceName,
      browser: device.browser,
      os: device.os,
      deviceType: device.deviceType,
    })

    // Start heartbeat and watcher only after the session doc exists
    startGlobalHeartbeat(uid)
    startSessionWatcher(uid)
  } finally {
    registrationInProgress = false
  }
}

/**
 * Removes the current session document from Firestore and stops the heartbeat.
 * Called before signing out — uses the raw Firestore instance
 * since this runs outside Vue component context.
 */
export async function removeCurrentSession(uid: string) {
  cleanupSessionState()

  const sessionId = localStorage.getItem(SESSION_ID_KEY)
  if (!sessionId) return

  const sessionRef = doc(
    collection(firestore, "users", uid, "sessions"),
    sessionId
  )
  await deleteDoc(sessionRef)
  clearPersistedSessionId()
}

/**
 * Composable for managing device sessions in the settings UI.
 * The heartbeat is managed globally (started at login, stopped at logout),
 * so this composable only handles the reactive session list and actions.
 */
export function useDeviceSessions() {
  const db = useFirestore()
  const user = useCurrentUser()
  const currentSessionId = getOrCreateSessionId()

  // Reactive query for user sessions
  const sessionsQueryRef = computed(() => {
    if (!user.value?.uid) return null
    return query(
      collection(db, "users", user.value.uid, "sessions"),
      orderBy("lastActiveAt", "desc")
    )
  })

  const { data: sessionsData, pending } =
    useCollection<IUserSession>(sessionsQueryRef)

  // Sort current device to the front, keep the rest sorted by lastActiveAt desc
  const sessions = computed(() => {
    const all = sessionsData.value ?? []
    const current = all.filter((s) => s.id === currentSessionId)
    const others = all.filter((s) => s.id !== currentSessionId)
    return [...current, ...others]
  })

  const isCurrentSession = (sessionId: string) => sessionId === currentSessionId

  // ── Actions ────────────────────────────────────────────────────────────

  async function revokeAllOtherSessions() {
    return revokeAllSessions({ currentSessionId })
  }

  async function revokeSingleSession(sessionId: string) {
    return revokeSession({ sessionId, currentSessionId })
  }

  return {
    sessions,
    pending,
    currentSessionId,
    isCurrentSession,
    revokeAllOtherSessions,
    revokeSingleSession,
  }
}

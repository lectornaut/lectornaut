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
          sessionRevoked = true
          stopGlobalHeartbeat()
          emitter.emit("session:revoked")
        }
      }
    )
  }

  tick()
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

  unsubscribeSnapshot = onSnapshot(sessionRef, (snapshot) => {
    if (!initialSnapshotReceived) {
      initialSnapshotReceived = true
      // On resume (page refresh), a missing doc means the session was revoked
      // while the page was closed. On fresh login, the doc may not exist yet.
      if (!snapshot.exists() && isResume) {
        sessionRevoked = true
        stopGlobalHeartbeat()
        emitter.emit("session:revoked")
      }
      return
    }

    if (!snapshot.exists() && !sessionRevoked) {
      sessionRevoked = true
      stopGlobalHeartbeat()
      emitter.emit("session:revoked")
    }
  })
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

  const { data: sessionsData } = useCollection<IUserSession>(sessionsQueryRef)

  const sessions = computed(() => sessionsData.value ?? [])

  const isCurrentSession = (sessionId: string) => sessionId === currentSessionId

  // ── Actions ────────────────────────────────────────────────────────────

  async function revokeAllOtherSessions() {
    return revokeAllSessions({ currentSessionId })
  }

  async function revokeSingleSession(sessionId: string) {
    return revokeSession({ sessionId })
  }

  return {
    sessions,
    currentSessionId,
    isCurrentSession,
    revokeAllOtherSessions,
    revokeSingleSession,
  }
}

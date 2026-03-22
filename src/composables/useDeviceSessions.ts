import {
  registerSessionCallable,
  revokeAllSessions,
  revokeSession,
} from "@/composables/useFunctions"
import { parseUserAgent } from "@/helpers/device"
import { generateRandomString } from "@/helpers/utilities"
import { firestore } from "@/modules/firebase"
import type { IUserSession } from "@/types/session"
import {
  collection,
  deleteDoc,
  doc,
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

function startGlobalHeartbeat(uid: string) {
  stopGlobalHeartbeat()
  const sessionId = getOrCreateSessionId()
  const sessionRef = doc(
    collection(firestore, "users", uid, "sessions"),
    sessionId
  )

  const tick = () => {
    updateDoc(sessionRef, { lastActiveAt: serverTimestamp() }).catch(() => {
      // Silently ignore — session may not exist yet
    })
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

/**
 * Registers a new session for the given user and starts the heartbeat.
 * Called after successful authentication.
 */
export async function registerSession(uid: string) {
  const sessionId = getOrCreateSessionId()
  const device = await parseUserAgent()

  await registerSessionCallable({
    sessionId,
    deviceName: device.deviceName,
    browser: device.browser,
    os: device.os,
    deviceType: device.deviceType,
  })

  // Start heartbeat only after the session doc exists
  startGlobalHeartbeat(uid)
}

/**
 * Removes the current session document from Firestore and stops the heartbeat.
 * Called before signing out — uses the raw Firestore instance
 * since this runs outside Vue component context.
 */
export async function removeCurrentSession(uid: string) {
  stopGlobalHeartbeat()

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

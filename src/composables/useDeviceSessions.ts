import {
  registerSessionCallable,
  revokeAllSessions,
  revokeSession,
} from "@/composables/useFunctions"
import { parseUserAgent } from "@/helpers/device"
import {
  getSessionVerificationDecision,
  isSessionMonitorRecoveryCode,
  type SessionVerificationStatus,
} from "@/helpers/session"
import { generateRandomString } from "@/helpers/utilities"
import { auth, firestore } from "@/modules/firebase"
import { emitter } from "@/modules/mitt"
import type { IUserSession } from "@/types/session"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import {
  useDocumentVisibility,
  useEventListener,
  useOnline,
  useWindowFocus,
} from "@vueuse/core"
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore"
import { useCurrentUser } from "vuefire"

const SESSION_ID_KEY = "lectornaut.session.id"
const SESSION_REGISTERED_KEY = "lectornaut.session.registered"
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
const SESSION_TOUCH_THROTTLE_MS = 30_000
const REGISTER_RETRY_DELAYS_MS = [1_000, 2_500]
const VERIFICATION_DELAYS_MS = [1_500, 4_000]

// Activity refs (online/focus/visibility), created LAZILY on first use rather
// than at module load. Each of these VueUse composables attaches window/document
// listeners immediately; evaluating them at import time touched the DOM during
// SSR/test imports and leaked listeners even when the session feature was never
// used. `??=` creates them exactly once, after the `typeof window` guard in
// `startActivityListeners`, then shares them for the app's lifetime.
let activityRefs: {
  isOnline: ReturnType<typeof useOnline>
  isWindowFocused: ReturnType<typeof useWindowFocus>
  documentVisibility: ReturnType<typeof useDocumentVisibility>
} | null = null

function getActivityRefs() {
  return (activityRefs ??= {
    isOnline: useOnline(),
    isWindowFocused: useWindowFocus(),
    documentVisibility: useDocumentVisibility(),
  })
}

interface SessionMonitorContext {
  uid: string
  sessionId: string
  generation: number
}

function getOrCreateSessionId(): string {
  let sessionId = localStorage.getItem(SESSION_ID_KEY)
  if (!sessionId) {
    sessionId = generateRandomString()
    localStorage.setItem(SESSION_ID_KEY, sessionId)
  }
  return sessionId
}

function markSessionRegistered(sessionId: string) {
  localStorage.setItem(SESSION_REGISTERED_KEY, sessionId)
}

function isSessionRegistered(sessionId: string): boolean {
  return localStorage.getItem(SESSION_REGISTERED_KEY) === sessionId
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Global heartbeat (runs once per app, not per component) ──────────────

const sessionMonitor = {
  heartbeatInterval: null as ReturnType<typeof setInterval> | null,
  unsubscribeSnapshot: null as (() => void) | null,
  cleanupActivityListeners: null as (() => void) | null,
  sessionRevoked: false,
  registrationInProgress: false,
  verificationPromise: null as Promise<void> | null,
  generation: 0,
  activeUid: null as string | null,
  activeSessionId: null as string | null,
  lastTouchedAt: 0,
}

function stopGlobalHeartbeat() {
  if (sessionMonitor.heartbeatInterval) {
    clearInterval(sessionMonitor.heartbeatInterval)
    sessionMonitor.heartbeatInterval = null
  }
}

function stopSessionWatcher() {
  if (sessionMonitor.unsubscribeSnapshot) {
    sessionMonitor.unsubscribeSnapshot()
    sessionMonitor.unsubscribeSnapshot = null
  }
}

function stopActivityListeners() {
  if (sessionMonitor.cleanupActivityListeners) {
    sessionMonitor.cleanupActivityListeners()
    sessionMonitor.cleanupActivityListeners = null
  }
}

function resetMonitoringInternals() {
  stopGlobalHeartbeat()
  stopSessionWatcher()
  stopActivityListeners()
  sessionMonitor.lastTouchedAt = 0
}

function buildSessionRef(context: SessionMonitorContext) {
  return doc(
    collection(firestore, "users", context.uid, "sessions"),
    context.sessionId
  )
}

function isContextActive(context: SessionMonitorContext): boolean {
  return (
    !sessionMonitor.sessionRevoked &&
    sessionMonitor.generation === context.generation &&
    sessionMonitor.activeUid === context.uid &&
    sessionMonitor.activeSessionId === context.sessionId
  )
}

function confirmRevoked(context: SessionMonitorContext) {
  if (!isContextActive(context)) return

  sessionMonitor.sessionRevoked = true
  resetMonitoringInternals()
  emitter.emit("session:revoked")
}

function startSessionMonitoring(
  uid: string,
  options: {
    forceRestart?: boolean
    persistedOnly?: boolean
    sessionId?: string
  } = {}
): SessionMonitorContext | null {
  const sessionId =
    options.sessionId ??
    (options.persistedOnly
      ? localStorage.getItem(SESSION_ID_KEY)
      : getOrCreateSessionId())

  if (!sessionId) return null

  const hasActiveMonitor =
    !!sessionMonitor.heartbeatInterval || !!sessionMonitor.unsubscribeSnapshot
  const sameContext =
    sessionMonitor.activeUid === uid &&
    sessionMonitor.activeSessionId === sessionId

  if (sameContext && hasActiveMonitor && !options.forceRestart) {
    return {
      uid,
      sessionId,
      generation: sessionMonitor.generation,
    }
  }

  sessionMonitor.generation += 1
  sessionMonitor.activeUid = uid
  sessionMonitor.activeSessionId = sessionId
  sessionMonitor.sessionRevoked = false
  sessionMonitor.verificationPromise = null

  resetMonitoringInternals()

  const context: SessionMonitorContext = {
    uid,
    sessionId,
    generation: sessionMonitor.generation,
  }

  startGlobalHeartbeat(context)
  startSessionWatcher(context)
  startActivityListeners(context)

  return context
}

async function readSessionStatus(
  context: SessionMonitorContext,
  refreshToken = false
): Promise<SessionVerificationStatus> {
  if (!isContextActive(context)) return "indeterminate"
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "indeterminate"
  }

  const currentUser = auth.currentUser
  if (!currentUser || currentUser.uid !== context.uid) {
    return "indeterminate"
  }

  if (refreshToken) {
    try {
      await currentUser.getIdToken(true)
    } catch {
      return "indeterminate"
    }
  }

  try {
    const snapshot = await getDocFromServer(buildSessionRef(context))
    return snapshot.exists() ? "exists" : "missing"
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code
    if (code === "not-found") return "missing"
    return "indeterminate"
  }
}

function restartMonitoring(context: SessionMonitorContext) {
  if (!isContextActive(context)) return
  startSessionMonitoring(context.uid, {
    forceRestart: true,
    sessionId: context.sessionId,
  })
}

function verifyRevocation(context: SessionMonitorContext) {
  if (
    sessionMonitor.sessionRevoked ||
    sessionMonitor.verificationPromise ||
    !isContextActive(context)
  ) {
    return sessionMonitor.verificationPromise
  }

  const verificationTask = (async () => {
    const statuses: SessionVerificationStatus[] = []

    for (let attempt = 0; attempt <= VERIFICATION_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await delay(VERIFICATION_DELAYS_MS[attempt - 1])
      }

      if (!isContextActive(context)) return

      const status = await readSessionStatus(context, attempt > 0)
      statuses.push(status)

      const decision = getSessionVerificationDecision(statuses)
      if (decision === "recover") {
        console.warn(
          "[session] Verification confirmed session exists — keeping session active"
        )
        restartMonitoring(context)
        return
      }

      if (decision === "revoke") {
        confirmRevoked(context)
        return
      }
    }

    if (!isContextActive(context)) return

    console.warn(
      "[session] Verification stayed inconclusive — keeping session active"
    )
    restartMonitoring(context)
  })()

  sessionMonitor.verificationPromise = verificationTask
  void verificationTask.finally(() => {
    if (sessionMonitor.verificationPromise === verificationTask) {
      sessionMonitor.verificationPromise = null
    }
  })

  return verificationTask
}

function shouldCheckRevocationOnWrite(error: unknown): boolean {
  const code = (error as { code?: string })?.code
  return (
    code === "not-found" ||
    code === "permission-denied" ||
    code === "unauthenticated"
  )
}

async function touchSessionActivity(
  context: SessionMonitorContext,
  force = false
) {
  if (!isContextActive(context) || sessionMonitor.registrationInProgress) return

  const now = Date.now()
  if (
    !force &&
    now - sessionMonitor.lastTouchedAt < SESSION_TOUCH_THROTTLE_MS
  ) {
    return
  }

  sessionMonitor.lastTouchedAt = now

  try {
    await updateDoc(buildSessionRef(context), {
      lastActiveAt: serverTimestamp(),
    })
  } catch (error) {
    if (shouldCheckRevocationOnWrite(error)) {
      void verifyRevocation(context)
    }
  }
}

function startGlobalHeartbeat(context: SessionMonitorContext) {
  stopGlobalHeartbeat()

  // Skip immediate tick — registerSession already sets lastActiveAt via the
  // cloud function, and an immediate updateDoc could race with Firestore
  // propagation, causing a spurious not-found → false revocation event.
  sessionMonitor.heartbeatInterval = setInterval(() => {
    void touchSessionActivity(context, true)
  }, HEARTBEAT_INTERVAL_MS)
}

// ── Session watcher (detects revocation in real-time) ────────────────────

function startSessionWatcher(context: SessionMonitorContext) {
  stopSessionWatcher()

  let hasServerSnapshot = false

  sessionMonitor.unsubscribeSnapshot = onSnapshot(
    buildSessionRef(context),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!isContextActive(context)) return

      if (
        !snapshot.exists() &&
        snapshot.metadata.fromCache &&
        !hasServerSnapshot
      ) {
        return
      }

      if (!snapshot.metadata.fromCache) {
        hasServerSnapshot = true
      }

      if (!snapshot.exists() && !snapshot.metadata.fromCache) {
        void verifyRevocation(context)
      }
    },
    (error) => {
      if (!isContextActive(context) || sessionMonitor.registrationInProgress) {
        return
      }

      if (isSessionMonitorRecoveryCode((error as { code?: string })?.code)) {
        void verifyRevocation(context)
      }
    }
  )
}

function startActivityListeners(context: SessionMonitorContext) {
  stopActivityListeners()

  if (typeof window === "undefined" || typeof document === "undefined") return

  const { isOnline, isWindowFocused, documentVisibility } = getActivityRefs()

  const wakeSession = () => {
    if (!isContextActive(context)) return
    if (documentVisibility.value === "hidden") return

    void touchSessionActivity(context)
  }

  const stopVisibilityWatch = watch(documentVisibility, (visibilityState) => {
    if (visibilityState === "visible") {
      wakeSession()
    }
  })
  const stopFocusWatch = watch(isWindowFocused, (focused) => {
    if (focused) {
      wakeSession()
    }
  })
  const stopOnlineWatch = watch(isOnline, (online) => {
    if (online) {
      wakeSession()
    }
  })
  const stopPageShowListener = useEventListener(window, "pageshow", () => {
    wakeSession()
  })

  sessionMonitor.cleanupActivityListeners = () => {
    stopVisibilityWatch()
    stopFocusWatch()
    stopOnlineWatch()
    stopPageShowListener()
  }
}

/**
 * Cleans up all session-related state: heartbeat, snapshot listener, flags.
 * Called during logout (both normal and revoked).
 */
export function cleanupSessionState() {
  sessionMonitor.generation += 1
  sessionMonitor.sessionRevoked = false
  sessionMonitor.registrationInProgress = false
  sessionMonitor.verificationPromise = null
  sessionMonitor.activeUid = null
  sessionMonitor.activeSessionId = null
  resetMonitoringInternals()
}

/**
 * Clears the persisted session ID from localStorage.
 * Called after revoked logout to prevent stale session checks on refresh.
 */
export function clearPersistedSessionId() {
  localStorage.removeItem(SESSION_ID_KEY)
  localStorage.removeItem(SESSION_REGISTERED_KEY)
}

/**
 * Resumes the session watcher and heartbeat for an already-authenticated user.
 * Called on app startup (page refresh) to detect sessions revoked while offline.
 */
export function resumeSessionWatcher(uid: string) {
  if (sessionMonitor.registrationInProgress) return
  const sessionId = localStorage.getItem(SESSION_ID_KEY)
  if (!sessionId) return

  if (!isSessionRegistered(sessionId)) {
    void registerSession(uid).catch((error) => {
      console.error("[session] Failed to re-register persisted session:", error)
    })
    return
  }

  startSessionMonitoring(uid, {
    sessionId,
  })
}

/**
 * Registers a new session for the given user and starts the heartbeat.
 * Called after successful authentication.
 */
export async function registerSession(uid: string) {
  sessionMonitor.registrationInProgress = true
  try {
    const sessionId = getOrCreateSessionId()
    const device = await parseUserAgent()

    let lastError: unknown = null

    for (
      let attempt = 0;
      attempt <= REGISTER_RETRY_DELAYS_MS.length;
      attempt++
    ) {
      try {
        if (attempt > 0) {
          await auth.currentUser?.getIdToken(true).catch(() => undefined)
        }

        await registerSessionCallable({
          sessionId,
          deviceName: device.deviceName,
          browser: device.browser,
          os: device.os,
          deviceType: device.deviceType,
        })

        markSessionRegistered(sessionId)
        startSessionMonitoring(uid, {
          forceRestart: true,
          sessionId,
        })
        return
      } catch (error) {
        lastError = error

        if (
          attempt === REGISTER_RETRY_DELAYS_MS.length ||
          !isSessionMonitorRecoveryCode((error as { code?: string })?.code)
        ) {
          throw error
        }

        await delay(REGISTER_RETRY_DELAYS_MS[attempt])

        if (auth.currentUser?.uid !== uid) {
          return
        }
      }
    }

    throw lastError
  } finally {
    sessionMonitor.registrationInProgress = false
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
  clearPersistedSessionId()
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
  const user = useCurrentUser()
  const currentSessionId = getOrCreateSessionId()

  // Reactive query for user sessions
  const sessionsQueryRef = computed(() => {
    if (!user.value?.uid) return null
    return query(
      collection(firestore, "users", user.value.uid, "sessions"),
      orderBy("lastActiveAt", "desc")
    )
  })

  const { data: sessionsData, isLoading: pending } =
    useCollectionQuery<IUserSession>(() => {
      const activeQuery = sessionsQueryRef.value
      const uid = user.value?.uid
      return activeQuery && uid
        ? { query: activeQuery, path: `users/${uid}/sessions` }
        : null
    })

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

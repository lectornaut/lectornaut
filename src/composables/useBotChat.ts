/**
 * useBotChat — orchestrates a Genkit chat session for the active
 * team/workspace with three visibility modes (private / shared / public).
 *
 * The composable owns:
 *   - the local message list (what the UI renders)
 *   - the current `sessionId` (returned by the server on first send,
 *     reused on subsequent sends to resume history)
 *   - two reactive lists for the sidebar:
 *       * `mySessions`     — sessions the user owns (any visibility)
 *       * `sharedSessions` — sessions shared by other team members
 *   - permission derivations: `canEditActive` (who can send to the
 *     active session), `canChangeVisibilityActive` (who can flip its
 *     visibility), and the active session's metadata.
 *   - actions: `sendMessage`, `selectSession`, `startNewSession`,
 *     `setActiveVisibility`.
 *
 * The full per-session message history lives server-side in Firestore at
 * `teams/{teamId}/workspaces/{workspaceId}/botSessions/{sessionId}`.
 * Switching teams or workspaces clears local state because session IDs
 * are scoped to one (team, workspace) pair.
 */

import { useCurrentTeamRole } from "@/composables/useCurrentTeamRole"
import {
  archiveBotSession,
  deleteBotSession,
  loadBotSession,
  renameBotSession,
  sendBotMessage,
  updateBotSessionVisibility,
} from "@/composables/useFunctions"
import { useAuthStore } from "@/stores/authStore"
import type { IBotSession, IBotSessionVisibility } from "@/types/domain"
import {
  createBotSessionsQuery,
  createSharedBotSessionsQuery,
  getBotSessionRef,
} from "@/utils/firebase/firebase-helpers"
import { storeToRefs } from "pinia"
import { computed, ref, watch, type InjectionKey, type Ref } from "vue"
import { toast } from "vue-sonner"
import { useCollection, useDocument } from "vuefire"

export type BotChatRole = "user" | "agent"

export interface BotChatMessage {
  role: BotChatRole
  content: string
}

export interface BotChatContext {
  messages: Ref<BotChatMessage[]>
  sessionId: Ref<string | null>
  isSending: Ref<boolean>
  isLoadingSession: Ref<boolean>
  isUpdatingVisibility: Ref<boolean>
  isMutatingSession: Ref<boolean>
  canSend: Ref<boolean>
  mySessions: Ref<IBotSession[]>
  archivedMySessions: Ref<IBotSession[]>
  sharedSessions: Ref<IBotSession[]>
  isLoadingSessions: Ref<boolean>
  activeSession: Ref<IBotSession | null>
  activeVisibility: Ref<IBotSessionVisibility>
  isActiveOwner: Ref<boolean>
  isActiveArchived: Ref<boolean>
  canEditActive: Ref<boolean>
  canChangeVisibilityActive: Ref<boolean>
  canManageActive: Ref<boolean>
  sendMessage: (text: string) => Promise<void>
  selectSession: (id: string) => Promise<void>
  startNewSession: () => void
  setActiveVisibility: (visibility: IBotSessionVisibility) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  archiveSession: (id: string, archived: boolean) => Promise<void>
  removeSession: (id: string) => Promise<void>
}

export const BotChatContextKey: InjectionKey<BotChatContext> =
  Symbol("BotChatContext")

const ADMIN_ROLES = new Set(["owner", "admin"])

export function useBotChat(): BotChatContext {
  const authStore = useAuthStore()
  const { currentUser, currentTeamId, currentWorkspaceId } =
    storeToRefs(authStore)

  const { currentRole } = useCurrentTeamRole(currentTeamId)
  const isTeamAdmin = computed(
    () => !!currentRole.value && ADMIN_ROLES.has(currentRole.value)
  )

  const messages = ref<BotChatMessage[]>([])
  const sessionId = ref<string | null>(null)
  const isSending = ref(false)
  const isLoadingSession = ref(false)
  const isUpdatingVisibility = ref(false)
  const isMutatingSession = ref(false)

  // Cancellation handle for the in-flight `sendBotMessage.stream(...)`.
  // Aborted whenever the user switches to a different session, starts a
  // new chat, or the composable's scope is disposed (page unmount). This
  // prevents zombie streams from billing tokens after the user has moved
  // on, and keeps the local message list in sync with what's visible.
  let inflightController: AbortController | null = null
  const abortInflightSend = () => {
    if (inflightController) {
      inflightController.abort()
      inflightController = null
    }
  }

  const isArchived = (s: IBotSession) => !!s.archivedAt

  // ── Sessions list: own + shared-by-others ──────────────────────────────────

  const mySessionsQueryRef = computed(() => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    const uid = currentUser.value?.uid
    if (!teamId || !workspaceId || !uid) return null
    return createBotSessionsQuery(teamId, workspaceId, uid)
  })
  const _vuefireMySessions = useCollection<IBotSession>(mySessionsQueryRef, {
    reset: true,
  })
  const allMySessions = computed(() => _vuefireMySessions.data.value ?? [])
  // Active (non-archived) sessions — what the main "Your chats" list shows.
  const mySessions = computed(() =>
    allMySessions.value.filter((s) => !isArchived(s))
  )
  const archivedMySessions = computed(() =>
    allMySessions.value.filter(isArchived)
  )

  const sharedSessionsQueryRef = computed(() => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return null
    return createSharedBotSessionsQuery(teamId, workspaceId)
  })
  const _vuefireSharedSessions = useCollection<IBotSession>(
    sharedSessionsQueryRef,
    { reset: true }
  )
  const sharedSessions = computed(() => {
    const uid = currentUser.value?.uid
    const all = _vuefireSharedSessions.data.value ?? []
    // Exclude my own shared sessions (they live in `mySessions` already)
    // and archived sessions (their owners moved them out of view).
    return all.filter(
      (s) => (uid ? s.ownerUid !== uid : true) && !isArchived(s)
    )
  })

  const isLoadingSessions = computed(
    () =>
      _vuefireMySessions.pending.value || _vuefireSharedSessions.pending.value
  )

  // ── Real-time subscription to the active session ──────────────────────────
  //
  // Binds to the active session doc so every save (from this user OR another
  // owner/admin in a shared chat) flows back into the local message list as
  // a Firestore snapshot. The denormalized `messages` field on the doc is
  // the canonical wire format — clients don't unpack the SessionData blob.

  const activeSessionDocRef = computed(() => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    const id = sessionId.value
    if (!teamId || !workspaceId || !id) return null
    return getBotSessionRef(teamId, workspaceId, id)
  })

  const _vuefireActiveSessionDoc = useDocument<IBotSession>(
    activeSessionDocRef,
    { reset: true }
  )

  // Sync server-driven messages into local state. Skipped during in-flight
  // sends so the optimistic / streaming agent message stays visible until
  // the response lands. Genkit's `SessionStore.save` runs once at the end
  // of each chat turn, so a fresh snapshot will fire shortly after
  // `isSending` flips back to false and reconcile naturally.
  //
  // We deliberately don't re-read the snapshot when `isSending` flips
  // false — that introduced a race where the locally-built streaming
  // text could be overwritten with a stale pre-write snapshot before the
  // post-write snapshot arrived.
  watch(
    () => _vuefireActiveSessionDoc.data.value?.messages,
    (serverMessages) => {
      if (!serverMessages) return
      if (isSending.value) return
      messages.value = serverMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))
    }
  )

  // ── Active session derivations ─────────────────────────────────────────────

  const activeSession = computed<IBotSession | null>(() => {
    const id = sessionId.value
    if (!id) return null
    return (
      allMySessions.value.find((s) => s.id === id) ??
      _vuefireSharedSessions.data.value?.find((s) => s.id === id) ??
      null
    )
  })

  // Reactive access loss: when `activeSession` flips from a real value
  // back to null while `sessionId` is still set, the user has lost
  // their handle on the chat — either an owner just tightened a shared
  // chat to private (it disappears from `sharedSessions`) or another
  // admin deleted it (it disappears from both lists). The
  // `sharedSessions` query (`where("visibility", "==", "shared")`)
  // updates in real time via Firestore, so this fires the moment the
  // owner's write commits — no doc-subscription error path needed.
  //
  // Owners stay put: the session never leaves `mySessions` (which
  // filters by `ownerUid`, not visibility), so their `activeSession`
  // never goes null on a visibility flip. Initial loads (`null → session`)
  // don't match the `prev && !next` gate either.
  watch(activeSession, (next, prev) => {
    if (sessionId.value && prev && !next) {
      startNewSession()
    }
  })

  const activeVisibility = computed<IBotSessionVisibility>(
    () => activeSession.value?.visibility ?? "private"
  )

  const isActiveOwner = computed(() => {
    const uid = currentUser.value?.uid
    const session = activeSession.value
    // A new chat (no session row yet) is owned by the current user.
    if (!session) return !!uid
    return !!uid && session.ownerUid === uid
  })

  const isActiveArchived = computed(
    () => !!activeSession.value && isArchived(activeSession.value)
  )

  const canEditActive = computed(() => {
    if (!sessionId.value) return true // new chat — anyone with team+workspace can start
    if (isActiveArchived.value) return false // archived sessions are read-only
    if (isActiveOwner.value) return true
    return activeVisibility.value === "shared" && isTeamAdmin.value
  })

  const canChangeVisibilityActive = computed(() => {
    if (!sessionId.value) return false
    return isActiveOwner.value || isTeamAdmin.value
  })

  /** Owner OR team admin can rename, archive, delete. */
  const canManageActive = computed(() => {
    if (!sessionId.value) return false
    return isActiveOwner.value || isTeamAdmin.value
  })

  const canSend = computed(
    () =>
      !isSending.value &&
      !!currentTeamId.value &&
      !!currentWorkspaceId.value &&
      canEditActive.value
  )

  // ── Actions ────────────────────────────────────────────────────────────────

  const startNewSession = () => {
    abortInflightSend()
    sessionId.value = null
    messages.value = []
  }

  // Page unmount / composable teardown — kill any active stream so we
  // stop incurring model tokens for a chat the user has navigated away
  // from. Called automatically when the consuming component is unmounted.
  onScopeDispose(abortInflightSend)

  // Genkit session IDs are scoped server-side to (teamId, workspaceId).
  // Switching either invalidates the local session — start fresh.
  watch([currentTeamId, currentWorkspaceId], () => {
    startNewSession()
  })

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) {
      toast.error("Select a team and workspace before chatting.")
      return
    }
    if (isSending.value) return
    // Silent guard — the composer is `:disabled` for non-editors, so
    // reaching this branch means a programmatic call slipped through.
    // No toast: a user who legitimately shouldn't be sending shouldn't
    // see a "this is read-only" error narrated at them.
    if (!canEditActive.value) return

    messages.value.push({ role: "user", content: trimmed })
    // Empty agent placeholder; chunks mutate `.content` in place as they
    // stream in, so the bubble grows without the array shape changing.
    const agentIndex = messages.value.length
    messages.value.push({ role: "agent", content: "" })
    isSending.value = true

    const controller = new AbortController()
    inflightController = controller

    try {
      const result = await sendBotMessage.stream(
        {
          teamId,
          workspaceId,
          sessionId: sessionId.value,
          message: trimmed,
        },
        { signal: controller.signal }
      )

      for await (const chunk of result.stream) {
        if (chunk.sessionId && chunk.sessionId !== sessionId.value) {
          // Server's first chunk pins the session id — flip the URL early
          // so the chat is linkable before the reply finishes streaming.
          sessionId.value = chunk.sessionId
        }
        if (chunk.chunk) {
          const agent = messages.value[agentIndex]
          if (agent?.role === "agent") agent.content += chunk.chunk
        }
      }

      const final = await result.data
      sessionId.value = final.sessionId
      // Server's final reply is canonical; reconcile in case the stream
      // missed any chunk (a partial network blip during iteration).
      const agent = messages.value[agentIndex]
      if (agent?.role === "agent") agent.content = final.reply
    } catch (error) {
      // A user-driven cancel (session switch / unmount) lands here as an
      // AbortError — silent rollback, no toast.
      const isAbort = controller.signal.aborted
      if (!isAbort) {
        console.error("[useBotChat] sendBotMessage failed:", error)
        toast.error("Failed to send message. Please try again.")
      }
      // Roll back the agent placeholder + the user message we optimistically
      // pushed. Using splice (not two pops) so we only mutate the slice we
      // own, even if a snapshot reconciliation snuck a write in between.
      messages.value.splice(agentIndex - 1, 2)
    } finally {
      // Only clear the controller if it's still ours — a later send may
      // have already swapped a new one in (e.g., abort + immediate retry).
      if (inflightController === controller) inflightController = null
      isSending.value = false
    }
  }

  const selectSession = async (id: string) => {
    if (!id) return
    if (sessionId.value === id && messages.value.length > 0) return

    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) {
      toast.error("Select a team and workspace before opening a chat.")
      return
    }
    if (isLoadingSession.value) return

    // Switching to a different session — kill any in-flight stream from
    // the previous one so its chunks don't bleed into this load.
    abortInflightSend()

    isLoadingSession.value = true
    try {
      const { data } = await loadBotSession({
        teamId,
        workspaceId,
        sessionId: id,
      })
      sessionId.value = data.sessionId
      messages.value = data.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))
    } catch (error) {
      console.error("[useBotChat] loadBotSession failed:", error)
      toast.error("Failed to open chat. Please try again.")
    } finally {
      isLoadingSession.value = false
    }
  }

  const renameSession = async (id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error("Chat title cannot be empty.")
      return
    }
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    if (isMutatingSession.value) return

    isMutatingSession.value = true
    try {
      await renameBotSession({
        teamId,
        workspaceId,
        sessionId: id,
        title: trimmed,
      })
    } catch (error) {
      console.error("[useBotChat] renameBotSession failed:", error)
      toast.error("Failed to rename chat.")
    } finally {
      isMutatingSession.value = false
    }
  }

  const archiveSession = async (id: string, archived: boolean) => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    if (isMutatingSession.value) return

    isMutatingSession.value = true
    try {
      await archiveBotSession({
        teamId,
        workspaceId,
        sessionId: id,
        archived,
      })
      toast.success(archived ? "Chat archived." : "Chat restored.")
    } catch (error) {
      console.error("[useBotChat] archiveBotSession failed:", error)
      toast.error("Failed to update chat.")
    } finally {
      isMutatingSession.value = false
    }
  }

  const removeSession = async (id: string) => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    if (isMutatingSession.value) return

    isMutatingSession.value = true
    try {
      await deleteBotSession({ teamId, workspaceId, sessionId: id })
      // If the deleted session was the active one, drop local state so
      // the empty composer view takes over.
      if (sessionId.value === id) startNewSession()
      toast.success("Chat deleted.")
    } catch (error) {
      console.error("[useBotChat] deleteBotSession failed:", error)
      toast.error("Failed to delete chat.")
    } finally {
      isMutatingSession.value = false
    }
  }

  const setActiveVisibility = async (visibility: IBotSessionVisibility) => {
    const id = sessionId.value
    if (!id) {
      toast.error("Send at least one message before changing visibility.")
      return
    }

    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return

    if (visibility === "public") {
      toast.info("Public chats are coming soon.")
      return
    }
    // Silent guard — the radio is `:disabled` and `onVisibilityChange`
    // also early-returns for non-admins, so reaching this branch means
    // a programmatic call slipped through. No toast: members shouldn't
    // see permission errors narrated at them for actions the UI was
    // supposed to prevent.
    if (!canChangeVisibilityActive.value) return
    if (isUpdatingVisibility.value) return

    isUpdatingVisibility.value = true
    try {
      await updateBotSessionVisibility({
        teamId,
        workspaceId,
        sessionId: id,
        visibility,
      })
      // The Firestore snapshot listener will reflect the change reactively
      // through `mySessions` / `sharedSessions` — no local mutation needed.
      // Owners stay on their chat; non-owners who lose read access are
      // handled by the active-doc watcher below (it sees `data.value`
      // flip non-null → null when security rules revoke their read).
    } catch (error) {
      console.error("[useBotChat] updateBotSessionVisibility failed:", error)
      toast.error("Failed to update chat visibility.")
    } finally {
      isUpdatingVisibility.value = false
    }
  }

  return {
    messages,
    sessionId,
    isSending,
    isLoadingSession,
    isUpdatingVisibility,
    isMutatingSession,
    canSend,
    mySessions,
    archivedMySessions,
    sharedSessions,
    isLoadingSessions,
    activeSession,
    activeVisibility,
    isActiveOwner,
    isActiveArchived,
    canEditActive,
    canChangeVisibilityActive,
    canManageActive,
    sendMessage,
    selectSession,
    startNewSession,
    setActiveVisibility,
    renameSession,
    archiveSession,
    removeSession,
  }
}

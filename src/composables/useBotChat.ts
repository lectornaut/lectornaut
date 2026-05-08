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
  respondToBotInterrupt,
  sendBotMessage,
  updateBotSessionVisibility,
  type BotChatMode,
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

// Re-export so consumers (composer, side panel) only need to import
// from `useBotChat`, not also from `useFunctions`.
export type { BotChatMode }

/**
 * Static catalog of action-context modes the user can switch between.
 * Mirrors the server-side `MODE_CONFIG` in `functions/src/bot.ts` — keep
 * the names in sync. The descriptions here drive the UI affordances
 * (composer dropdown labels and the side-panel explainer); the server
 * owns the actual prompt-suffix and tool-list behavior.
 */
export interface BotChatModeOption {
  value: BotChatMode
  label: string
  shortDescription: string
  longDescription: string
  toolsEnabled: boolean
}

export const BOT_CHAT_MODE_OPTIONS: readonly BotChatModeOption[] = [
  {
    value: "auto",
    label: "Auto",
    shortDescription: "Balanced default",
    longDescription:
      "Concise replies. Calls tools only when they directly help.",
    toolsEnabled: true,
  },
  {
    value: "agent",
    label: "Agent",
    shortDescription: "Proactive, tool-heavy",
    longDescription:
      "Calls tools eagerly to gather data and chains them when useful. Replies tend to be longer and narrate what's happening.",
    toolsEnabled: true,
  },
  {
    value: "manual",
    label: "Manual",
    shortDescription: "Read-only conversation",
    longDescription:
      "Tools are disabled — the assistant can explain and suggest, but won't take actions on your behalf. Useful when you only want feedback.",
    toolsEnabled: false,
  },
] as const

const DEFAULT_BOT_CHAT_MODE: BotChatMode = "auto"

/**
 * Tool invocation captured on an agent message.
 *
 * `output` is `undefined` in two states:
 *   - During streaming, when a normal tool is still running on the
 *     server (rare — execution is fast).
 *   - When `isInterrupt` is true, meaning the chat is paused waiting
 *     for the user to fill in a form. The renderer uses the flag to
 *     pick between a "Running…" spinner and an interactive prompt.
 *
 * `ref` correlates the toolCall stream event with its matching
 * toolResult event (and with the resume callable's input).
 */
export interface BotChatToolCall {
  ref?: string
  name: string
  input?: unknown
  output?: unknown
  /**
   * Set when this is a paused Human-in-the-Loop interrupt awaiting user
   * input. Cleared once the user submits an answer (the segment then
   * carries the answer as `output`).
   */
  isInterrupt?: boolean
}

/**
 * One slice of an agent message: either a text run or a tool invocation.
 * The renderer walks segments in order and switches between markdown
 * bubbles and tool-call cards. User messages stay flat (no segments) —
 * they're always a single text run.
 */
export type BotChatSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: BotChatToolCall }

export interface BotChatMessage {
  // Stable client-side id for `v-for :key` and parse-tree memoization in
  // the chat view. Not persisted — every snapshot reconcile mints fresh
  // ids, which is fine because the array is rebuilt wholesale at that
  // point and the WeakMap parse cache resets along with it.
  id: string
  role: BotChatRole
  content: string
  /** Present on agent messages with tool calls; absent for plain text. */
  segments?: BotChatSegment[]
}

const createMessage = (m: {
  role: BotChatRole
  content: string
  segments?: BotChatSegment[]
}): BotChatMessage => ({
  id: crypto.randomUUID(),
  role: m.role,
  content: m.content,
  // Deep-clone segments so reactive mutations on this instance don't leak
  // back into the caller's object (e.g. server snapshot data passed into
  // `messages.value = serverMessages.map(createMessage)`). The `tool`
  // spread copies `isInterrupt` automatically so paused HITL prompts
  // round-trip correctly through Firestore reconciles.
  segments: m.segments
    ? m.segments.map((s) =>
        s.kind === "text"
          ? { kind: "text", text: s.text }
          : { kind: "tool", tool: { ...s.tool } }
      )
    : undefined,
})

export interface BotChatContext {
  messages: Ref<BotChatMessage[]>
  sessionId: Ref<string | null>
  isSending: Ref<boolean>
  isLoadingSession: Ref<boolean>
  isUpdatingVisibility: Ref<boolean>
  isMutatingSession: Ref<boolean>
  canSend: Ref<boolean>
  /** Active action-context mode used for the next `sendMessage`. */
  mode: Ref<BotChatMode>
  /** Convenience: `BOT_CHAT_MODE_OPTIONS` entry matching `mode.value`. */
  activeModeOption: Ref<BotChatModeOption>
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
  /**
   * Resume a chat that's paused on an `askQuestion` interrupt.
   * The `messageId` + `ref` locate the tool segment (so the UI can
   * mutate it in place); `answer` is the user's response, validated
   * against the interrupt's `outputSchema` server-side.
   */
  respondToInterrupt: (args: {
    messageId: string
    ref?: string
    name: string
    answer: { answer: string }
  }) => Promise<void>
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

  // Action-context mode for the next send. Plain ref (not persisted on
  // the session doc) — the user can flip modes mid-conversation and the
  // server applies the chosen mode to the active turn only. Defaulting
  // here means new chats start in `auto`; switching sessions doesn't
  // reset because the composable instance lives across the page lifetime.
  const mode = ref<BotChatMode>(DEFAULT_BOT_CHAT_MODE)
  const activeModeOption = computed<BotChatModeOption>(
    () =>
      BOT_CHAT_MODE_OPTIONS.find((o) => o.value === mode.value) ??
      BOT_CHAT_MODE_OPTIONS[0]
  )

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
      messages.value = serverMessages.map(createMessage)
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

  // Shared stream-chunk dispatchers for both `sendMessage` (new turn)
  // and `respondToInterrupt` (resumed turn). Both flows produce chunks
  // with the same `SendBotMessageStreamChunk` shape and route them into
  // an in-place agent message identified by `agentIndex`.
  //
  // The factory takes `agentIndex` (not a ref) so each closed-over
  // dispatcher always resolves the latest array slot — important if a
  // Firestore snapshot reconcile rebuilds the array mid-stream.
  const buildStreamHandlers = (agentIndex: number) => {
    const appendText = (text: string) => {
      const agent = messages.value[agentIndex]
      if (agent?.role !== "agent") return
      agent.content += text
      const segments = agent.segments
      if (!segments) return
      const last = segments[segments.length - 1]
      if (last && last.kind === "text") {
        // Mutate the existing text segment so its identity stays stable —
        // markdown parse caches downstream key off the message object,
        // not the segment object, but keeping segment identity stable
        // also helps Vue's reactive diff skip nodes that didn't change.
        last.text += text
      } else {
        segments.push({ kind: "text", text })
      }
    }
    const pushToolCall = (call: {
      ref?: string
      name: string
      input?: unknown
      isInterrupt?: boolean
    }) => {
      const agent = messages.value[agentIndex]
      if (agent?.role !== "agent") return
      const segments = agent.segments
      if (!segments) return
      // Dedupe: server sweeps `final.messages` after the live stream and
      // may resend events. We key on `ref` (always present in practice).
      if (
        call.ref &&
        segments.some((s) => s.kind === "tool" && s.tool.ref === call.ref)
      ) {
        return
      }
      segments.push({
        kind: "tool",
        tool: {
          ref: call.ref,
          name: call.name,
          input: call.input,
          output: undefined,
          // Pass through the HITL flag so the renderer draws an
          // interactive form instead of a spinner. `fillToolResult`
          // will drop the flag when an answer lands.
          ...(call.isInterrupt ? { isInterrupt: true } : {}),
        },
      })
    }
    const fillToolResult = (result: {
      ref?: string
      name: string
      output?: unknown
    }) => {
      const agent = messages.value[agentIndex]
      if (agent?.role !== "agent") return
      const segments = agent.segments
      if (!segments) return
      // Match by ref first (precise); fall back to "newest pending tool
      // segment with the same name" if ref is missing.
      const target =
        (result.ref &&
          segments.find(
            (s): s is Extract<BotChatSegment, { kind: "tool" }> =>
              s.kind === "tool" && s.tool.ref === result.ref
          )) ||
        [...segments]
          .reverse()
          .find(
            (s): s is Extract<BotChatSegment, { kind: "tool" }> =>
              s.kind === "tool" &&
              s.tool.name === result.name &&
              s.tool.output === undefined
          )
      if (target) {
        // Mutate output in place so the existing tool-card component
        // transitions from "running" to "done" without unmounting. If
        // this was a paused interrupt, the answer lands here and we
        // drop the flag so the form is replaced by the completed-card
        // view.
        target.tool.output = result.output
        delete target.tool.isInterrupt
      } else {
        // Result with no matching call (shouldn't happen in practice).
        // Push a synthetic completed call so nothing is lost.
        segments.push({
          kind: "tool",
          tool: {
            ref: result.ref,
            name: result.name,
            output: result.output,
          },
        })
      }
    }
    return { appendText, pushToolCall, fillToolResult }
  }

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

    messages.value.push(createMessage({ role: "user", content: trimmed }))
    // Empty agent placeholder; chunks mutate `.content` and `.segments`
    // in place as they stream in, so the bubble grows without the array
    // shape changing. Object identity is load-bearing: the renderer's
    // parse cache keys on the message object, so chunks must mutate this
    // same instance (not replace it) to keep the streaming-tail re-parse
    // path exclusive. We seed `segments: []` so tool calls (which arrive
    // as separate stream events from text) can splice in without
    // restructuring the message.
    const agentIndex = messages.value.length
    messages.value.push(
      createMessage({ role: "agent", content: "", segments: [] })
    )
    isSending.value = true

    const { appendText, pushToolCall, fillToolResult } =
      buildStreamHandlers(agentIndex)

    const controller = new AbortController()
    inflightController = controller

    try {
      const result = await sendBotMessage.stream(
        {
          teamId,
          workspaceId,
          sessionId: sessionId.value,
          message: trimmed,
          mode: mode.value,
        },
        { signal: controller.signal }
      )

      for await (const chunk of result.stream) {
        if (chunk.sessionId && chunk.sessionId !== sessionId.value) {
          // Server's first chunk pins the session id — flip the URL early
          // so the chat is linkable before the reply finishes streaming.
          sessionId.value = chunk.sessionId
        }
        if (chunk.chunk) appendText(chunk.chunk)
        if (chunk.toolCall) pushToolCall(chunk.toolCall)
        if (chunk.toolResult) fillToolResult(chunk.toolResult)
      }

      const final = await result.data
      sessionId.value = final.sessionId
      // Server's final reply is canonical for text; we don't overwrite
      // segments (the stream + sweep already filled them) because doing
      // so would clobber the in-place mutations the UI is rendering.
      // The next Firestore snapshot will reconcile any drift wholesale.
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

  // Resume a paused chat by submitting the user's answer to an interrupt.
  // Unlike `sendMessage`, we DON'T push a new bubble — the chat continues
  // streaming into the same agent message that contains the interrupt
  // segment. The optimistic UI step here is filling in the interrupt's
  // `output` immediately so the form vanishes the moment the user clicks
  // "Submit", before the model's continuation arrives.
  const respondToInterrupt: BotChatContext["respondToInterrupt"] = async ({
    messageId,
    ref,
    name,
    answer,
  }) => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    const sid = sessionId.value
    if (!teamId || !workspaceId || !sid) {
      toast.error("This chat hasn't been saved yet — try again in a moment.")
      return
    }
    if (isSending.value) return
    if (!canEditActive.value) return

    // Locate the agent message + interrupt segment we're answering. We
    // do this by id (stable for the lifetime of the array) so the call
    // site doesn't have to know array indices.
    const agentIndex = messages.value.findIndex((m) => m.id === messageId)
    if (agentIndex < 0) return
    const agent = messages.value[agentIndex]
    if (agent?.role !== "agent") return
    const segments = agent.segments
    if (!segments) return
    const target = segments.find(
      (s): s is Extract<BotChatSegment, { kind: "tool" }> =>
        s.kind === "tool" &&
        s.tool.name === name &&
        s.tool.isInterrupt === true &&
        (ref ? s.tool.ref === ref : true)
    )
    if (!target) return

    // Optimistic: mark the interrupt resolved with the user's answer so
    // the form disappears instantly. If the server rejects (validation,
    // permission, network), we restore the form in `catch` below.
    const previousOutput = target.tool.output
    target.tool.output = answer
    target.tool.isInterrupt = false

    isSending.value = true
    const { appendText, pushToolCall, fillToolResult } =
      buildStreamHandlers(agentIndex)

    const controller = new AbortController()
    inflightController = controller

    try {
      const result = await respondToBotInterrupt.stream(
        {
          teamId,
          workspaceId,
          sessionId: sid,
          ref,
          name,
          response: answer,
          mode: mode.value,
        },
        { signal: controller.signal }
      )

      for await (const chunk of result.stream) {
        if (chunk.sessionId && chunk.sessionId !== sessionId.value) {
          sessionId.value = chunk.sessionId
        }
        if (chunk.chunk) appendText(chunk.chunk)
        if (chunk.toolCall) pushToolCall(chunk.toolCall)
        if (chunk.toolResult) fillToolResult(chunk.toolResult)
      }

      const final = await result.data
      sessionId.value = final.sessionId
      // Don't overwrite `agent.content` here — it now holds (the existing
      // pre-interrupt text) + (the model's continuation). The server's
      // `final.reply` is just the continuation, so blindly assigning it
      // would lose the prefix. The next Firestore snapshot is the
      // canonical reconcile.
    } catch (error) {
      const isAbort = controller.signal.aborted
      if (!isAbort) {
        console.error("[useBotChat] respondToBotInterrupt failed:", error)
        toast.error("Couldn't submit your answer. Please try again.")
        // Roll back the optimistic resolution so the user can re-submit.
        target.tool.output = previousOutput
        target.tool.isInterrupt = true
      }
    } finally {
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
      messages.value = data.messages.map(createMessage)
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
    mode,
    activeModeOption,
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
    respondToInterrupt,
    selectSession,
    startNewSession,
    setActiveVisibility,
    renameSession,
    archiveSession,
    removeSession,
  }
}

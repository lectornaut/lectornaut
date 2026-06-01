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
  findBotSessionByPinnedNode,
  loadBotSession,
  renameBotSession,
  respondToBotInterrupt,
  sendBotMessage,
  updateBotSessionVisibility,
  type BotChatMode,
  type BotChatNodeRef,
} from "@/composables/useFunctions"
import {
  botModelProviders,
  botModels,
  type BotModelEntry,
} from "@/helpers/defaults"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import type {
  IBotAgentModel,
  IBotModelProvider,
  IBotSession,
  IBotSessionVisibility,
  ITeamAgent,
} from "@/types/domain"
import type { WorkspaceNodeScope } from "@/types/nodes"
import {
  createBotSessionsQuery,
  createSharedBotSessionsQuery,
  getBotSessionRef,
} from "@/utils/firebase/firebase-helpers"
import {
  useCollectionQuery,
  useDocumentQuery,
} from "@/utils/firebase/firebase-query"
import { storeToRefs } from "pinia"
import { computed, ref, watch, type InjectionKey, type Ref } from "vue"
import { toast } from "vue-sonner"

export type BotChatRole = "user" | "agent"

// Re-export so consumers (composer, side panel) only need to import
// from `useBotChat`, not also from `useFunctions`.
export type { BotChatMode, BotChatNodeRef }

/** Cap mirrors `CONTEXT_NODE_MAX` on the server. */
export const BOT_CHAT_MAX_ATTACHED_NODES = 10

/**
 * Static catalog of action-context modes the user can switch between.
 * Mirrors the server-side `MODE_CONFIG` in
 * `functions/src/botAgentConfig.ts` — keep the names in sync. The
 * descriptions here drive the UI affordances (composer dropdown labels
 * and the side-panel explainer); the server owns the actual prompt-suffix
 * behavior. Every tool is available in every mode, so modes differ only
 * in how proactively the assistant replies.
 */
export interface BotChatModeOption {
  value: BotChatMode
  label: string
  shortDescription: string
  longDescription: string
}

export const BOT_CHAT_MODE_OPTIONS: readonly BotChatModeOption[] = [
  {
    value: "auto",
    label: "Auto",
    shortDescription: "Balanced default",
    longDescription:
      "Concise replies. Calls tools only when they directly help.",
  },
  {
    value: "agent",
    label: "Agent",
    shortDescription: "Proactive, tool-heavy",
    longDescription:
      "Calls tools eagerly to gather data and chains them when useful. Replies tend to be longer and narrate what's happening.",
  },
  {
    value: "manual",
    label: "Manual",
    shortDescription: "Conversational, user-led",
    longDescription:
      "Discussion-first: the assistant explains and suggests, and uses tools only when you explicitly ask. Useful when you mostly want feedback.",
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
  /**
   * Firebase uid of the human who sent this message. Only populated for
   * user-role messages — agent turns have no human author. Drives
   * per-sender avatar rendering so shared/public sessions, where
   * multiple admins can post, attribute each turn to the right person.
   * Undefined on legacy messages (saved before authorship was tracked
   * server-side); the UI falls back to the session's `ownerUid` then.
   */
  authorUid?: string
}

const createMessage = (m: {
  role: BotChatRole
  content: string
  segments?: BotChatSegment[]
  authorUid?: string
}): BotChatMessage => ({
  id: crypto.randomUUID(),
  role: m.role,
  content: m.content,
  authorUid: m.authorUid,
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
  /**
   * Active model id used for the next `sendMessage`. New chats seed
   * from the team's admin default; switching to an existing chat
   * rehydrates from its persisted `lastModel`. The user can swap mid-
   * conversation; the server clamps to the team's current allowlist
   * before applying.
   */
  model: Ref<IBotAgentModel>
  /**
   * Provider-grouped list of currently allowed (provider on AND model
   * on) models the user can pick from. Drives the composer's model
   * picker — re-derived whenever an admin saves new policy. Each group
   * carries its provider id + display name plus the matching catalog
   * entries (badge/description included); groups with zero allowed
   * models are filtered out (so a fully-disabled publisher disappears
   * from the picker entirely).
   */
  availableModelsByProvider: Ref<
    { id: IBotModelProvider; name: string; models: BotModelEntry[] }[]
  >
  /**
   * Id of the custom agent currently driving this chat, or `null` for
   * the team default persona. Mutates on `selectAgent()`; the next
   * `sendMessage` forwards it to the server, which persists it on the
   * session doc so reloads stick to the same agent. New chats seed
   * from `null` (default); existing chats rehydrate from the doc's
   * `activeAgentId` field on `selectSession`.
   */
  activeAgentId: Ref<string | null>
  /**
   * The resolved active-agent record, or `null` when none is active
   * or the agent's doc has been hard-deleted. Returns the record
   * even when the agent is disabled or archived so the composer
   * badge can render the agent's name + avatar regardless — the
   * `activeAgentStatus` ref below provides the lifecycle detail.
   */
  activeAgent: Ref<ITeamAgent | null>
  /**
   * Lifecycle status of the currently-selected agent:
   *   `null` (none selected) | "active" | "disabled" | "archived" | "deleted".
   * The composer reads this to render the right status badge. The
   * server is the source of truth for dispatch — this is purely a
   * display affordance derived from the snapshot.
   */
  activeAgentStatus: Ref<"active" | "disabled" | "archived" | "deleted" | null>
  /**
   * Pick a custom agent (or pass `null` to clear back to the team
   * default). Mutation only — the server is told on the next send.
   * Composer badges and sidebar avatar clicks both route through here.
   */
  selectAgent: (agentId: string | null) => void
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
  // ── Attached workspace nodes (context) ──────────────────────────────
  /**
   * Workspace nodes the user has attached to the current session. Sent
   * with every `sendMessage` so the model sees them as ground-truth
   * context for each turn. Persists for the lifetime of the session;
   * cleared by `startNewSession`.
   */
  attachedNodes: Ref<BotChatNodeRef[]>
  /** Capacity gate — disables the "+" button in the UI past the cap. */
  canAttachMoreNodes: Ref<boolean>
  /**
   * Attach a workspace node to this chat session. Idempotent — re-
   * attaching the same `(scope, nodeId)` pair is a no-op. Rejected
   * silently when the session is already at `BOT_CHAT_MAX_ATTACHED_NODES`.
   */
  attachNode: (node: BotChatNodeRef) => void
  /** Detach a previously-attached node. Idempotent on missing refs. */
  detachNode: (node: BotChatNodeRef) => void
  /** Drop every attached node. */
  clearAttachedNodes: () => void
  // ── Per-node sessions (NodeInspectorSidebar Bot tab) ────────────────
  /**
   * Bind this chat to a workspace node:
   *   - Look up an existing session pinned to (scope, nodeId) for the
   *     current user; if found, load it.
   *   - Otherwise start a fresh session with `pinnedNode` set, so the
   *     next `sendMessage` creates the pin server-side.
   * Attached nodes are reset to `[node]` either way, so the node
   * inspector's chat always grounds the model in the inspected file.
   */
  selectOrCreateNodeSession: (node: BotChatNodeRef) => Promise<void>
  /**
   * Force-start a brand-new pinned chat for a node, even when one
   * already exists. Drops local state (messages, sessionId), attaches
   * the node, and stages it as `pendingPinnedNode` so the next
   * `sendMessage` server-creates the new pin. Multiple pinned chats
   * per (user, node) are allowed — the inspector's history list
   * surfaces older ones.
   */
  startNewPinnedNodeSession: (node: BotChatNodeRef) => void
  /**
   * `pinnedNode` is forwarded on the *next* `sendMessage` only when the
   * session is brand new — exposed here so the UI can reflect "this
   * chat is bound to that node" before the first send lands.
   */
  pendingPinnedNode: Ref<BotChatNodeRef | null>
  /**
   * One-shot text the composer consumes by prepending to its current
   * draft and then resetting back to null. Wired by the in-chat context
   * menu's "Reply" action to inject a Markdown blockquote of the message
   * being replied to. Kept on the shared context (rather than via an
   * event bus) so any future "stuff this into the composer" affordance
   * — quick-prompt buttons, drag-drop, etc. — has a single channel.
   */
  pendingComposerDraft: Ref<string | null>
}

export const BotChatContextKey: InjectionKey<BotChatContext> =
  Symbol("BotChatContext")

const ADMIN_ROLES = new Set(["owner", "admin"])

export function useBotChat(): BotChatContext {
  const authStore = useAuthStore()
  const { currentUser, currentTeamId, currentWorkspaceId } =
    storeToRefs(authStore)

  const { currentRole, canManageWorkspaceContent } =
    useCurrentTeamRole(currentTeamId)
  const isTeamAdmin = computed(
    () => !!currentRole.value && ADMIN_ROLES.has(currentRole.value)
  )

  const messages = ref<BotChatMessage[]>([])
  const sessionId = ref<string | null>(null)
  const isSending = ref(false)
  const isLoadingSession = ref(false)
  const isUpdatingVisibility = ref(false)
  const isMutatingSession = ref(false)

  // ── Attached node context ─────────────────────────────────────────────
  //
  // The user picks nodes from the composer's node-picker sheet (or the
  // inspector Bot tab auto-attaches the current node). These refs flow
  // along on every `sendMessage` and `respondToInterrupt` so the server
  // can re-fetch + inject them into the per-turn system prompt.
  //
  // `pendingPinnedNode` is a one-shot binding sent only on the *next*
  // send while we're still in a no-session state — once the server
  // returns a sessionId, the pin is persisted server-side and this ref
  // becomes irrelevant for subsequent sends.

  const attachedNodes = ref<BotChatNodeRef[]>([])
  const pendingPinnedNode = ref<BotChatNodeRef | null>(null)
  // One-shot composer prefill. `AiChat` sets this from the context menu
  // (Reply → blockquote of the message), `AiChatComposer` watches it,
  // prepends to its local draft, then resets the ref to null. Lives here
  // (not as a local ref in the composer) so the chat view — a sibling
  // component — can reach the composer through the already-shared
  // BotChatContext without a separate event channel.
  const pendingComposerDraft = ref<string | null>(null)

  const canAttachMoreNodes = computed(
    () => attachedNodes.value.length < BOT_CHAT_MAX_ATTACHED_NODES
  )

  const nodeRefMatches = (
    a: BotChatNodeRef,
    b: { scope: WorkspaceNodeScope; nodeId: string }
  ): boolean => a.scope === b.scope && a.nodeId === b.nodeId

  const attachNode = (node: BotChatNodeRef) => {
    if (!node?.nodeId) return
    if (
      attachedNodes.value.some((existing) => nodeRefMatches(existing, node))
    ) {
      return
    }
    if (attachedNodes.value.length >= BOT_CHAT_MAX_ATTACHED_NODES) {
      toast.error(
        `You can attach up to ${BOT_CHAT_MAX_ATTACHED_NODES} items per chat.`
      )
      return
    }
    attachedNodes.value.push({ scope: node.scope, nodeId: node.nodeId })
  }

  const detachNode = (node: BotChatNodeRef) => {
    attachedNodes.value = attachedNodes.value.filter(
      (existing) => !nodeRefMatches(existing, node)
    )
  }

  const clearAttachedNodes = () => {
    attachedNodes.value = []
  }

  // Team-scoped agent config — read directly from the Pinia store so
  // we share state with `SettingsAgents.vue`'s form. An admin saving a
  // new default mode propagates here in the same tick; no manual
  // invalidation or duplicate fetch. We only consume `defaultMode`
  // (to seed the composer + reset on `startNewSession`); the store
  // owns the writes.
  const agentConfigStore = useAgentConfigStore()
  const { config: teamAgentConfig } = storeToRefs(agentConfigStore)
  const teamDefaultMode = computed<BotChatMode>(
    () => teamAgentConfig.value.defaultMode ?? DEFAULT_BOT_CHAT_MODE
  )

  // Action-context mode for the next send. Plain ref (not persisted on
  // the session doc) — the user can flip modes mid-conversation and the
  // server applies the chosen mode to the active turn only. Initialized
  // to the team default (admin-configurable in Settings → Agents) then
  // carried across turns. Seeded with whatever `teamDefaultMode` resolves
  // to synchronously (the cached `defaultBotAgentConfig` fallback in
  // `useAgentConfig` makes this non-null from the first read).
  const mode = ref<BotChatMode>(teamDefaultMode.value)
  // Re-seed when the team's defaultMode flips IFF no chat is in progress
  // — i.e. no messages exchanged AND no session pinned. This catches:
  //   - initial async resolution after the team's config doc loads
  //     (the synchronous seed above was based on the local defaults)
  //   - team switches (currentTeamId flips, agent config refetches)
  //   - admin saves a new default while the user is sitting on an empty
  //     composer — still pristine, so it's safe to apply.
  // The condition deliberately doesn't track "user clicked the mode
  // dropdown but hasn't sent yet": admin saves are rare, and racing
  // them against an unsent user pick isn't worth the state machine.
  watch(teamDefaultMode, (next) => {
    if (messages.value.length === 0 && sessionId.value === null) {
      mode.value = next
    }
  })
  const activeModeOption = computed<BotChatModeOption>(
    () =>
      BOT_CHAT_MODE_OPTIONS.find((o) => o.value === mode.value) ??
      BOT_CHAT_MODE_OPTIONS[0]
  )

  // ── Model selection ───────────────────────────────────────────────────
  //
  // Mirrors the mode pattern almost exactly: plain ref seeded from the
  // team's admin-configured default, forwarded on every send/respond,
  // re-seeded when (a) the team's default flips while the session is
  // pristine, (b) the team's allowlist tightens such that the current
  // pick is no longer allowed, or (c) the user opens an existing chat
  // — in which case we rehydrate from the session's persisted
  // `lastModel` for continuity. This is the one place where model
  // diverges from mode: a chat's last-used model survives leaving the
  // chat, whereas mode always resets to the team default on session
  // switch. Persistence makes the picker behave like "this chat is
  // pinned to a model unless you explicitly change it", which is what
  // users expect for a setting that has real performance/cost impact.

  const teamDefaultModel = computed<IBotAgentModel>(
    () => teamAgentConfig.value.model
  )

  /**
   * Currently allowed (provider on AND model on) models, grouped by
   * provider for the composer's `<Select>`. `!== false` treats missing
   * toggles as enabled, matching the server's normalize-on-read behavior
   * — a brand-new model id that lands client-side before a team has saved
   * an updated config doc still shows up rather than disappearing.
   *
   * Provider iteration order is taken from `botModelProviders` (the
   * canonical display order); a provider with zero allowed models drops
   * out of the picker entirely so a fully-disabled publisher doesn't
   * leave an empty group.
   */
  const availableModelsByProvider = computed(() => {
    const cfg = teamAgentConfig.value
    return botModelProviders
      .filter((provider) => cfg.providers[provider.id] !== false)
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        models: botModels.filter(
          (model) =>
            model.provider === provider.id && cfg.models[model.id] !== false
        ) as BotModelEntry[],
      }))
      .filter((group) => group.models.length > 0)
  })

  /** Flat helper used by the in-allowlist check below. */
  const isModelAvailable = (id: IBotAgentModel | string): boolean =>
    availableModelsByProvider.value.some((group) =>
      group.models.some((model) => model.id === id)
    )

  // Initial seed picks the team default. `useAgentConfig` provides a
  // synchronous fallback to `defaultBotAgentConfig.model` until the
  // team's config doc lands, so this never reads `undefined`.
  const model = ref<IBotAgentModel>(teamDefaultModel.value)

  // Re-seed when the team's default flips IFF the session is pristine
  // (no messages exchanged AND no session pinned). Mirrors the mode
  // watcher's invariants — admin saves are rare, and racing them
  // against an unsent user pick isn't worth the state machine.
  watch(teamDefaultModel, (next) => {
    if (messages.value.length === 0 && sessionId.value === null) {
      model.value = next
    }
  })

  // Safety net: if an admin tightens the allowlist (disables a provider
  // or unchecks a model) such that the currently-selected model is no
  // longer allowed, fall back to the team default. The server applies
  // the same clamp on every send, so without this the picker would show
  // a "stuck" selection that silently maps to a different model on the
  // wire. Re-seeding here keeps the UI honest. Skipped when the team
  // default itself is missing from `availableModels` (impossible in
  // practice — the admin form enforces at least one available model —
  // but defensive anyway).
  watch(availableModelsByProvider, () => {
    if (!isModelAvailable(model.value)) {
      const fallback = isModelAvailable(teamDefaultModel.value)
        ? teamDefaultModel.value
        : availableModelsByProvider.value[0]?.models[0]?.id
      if (fallback) model.value = fallback
    }
  })

  // ── Active custom agent (multi-agent persona swap) ───────────────────
  //
  // `activeAgentId` is the in-memory pick the composer / sidebar mutates;
  // the next `sendMessage` ships it to the server, which persists it on
  // the session doc as the canonical `activeAgentId`. New chats start
  // with `null` (team default); existing chats rehydrate from the doc
  // on `selectSession`. The server's `resolveActiveAgent` decides what
  // actually dispatches — including silently falling back to the
  // default when the id points to a since-archived agent.
  //
  // We expose `activeAgent` as a computed lookup against the live agents
  // store so the badge in the composer always reflects the current
  // record (name + avatar seed). When the resolved agent is missing or
  // archived, this is `null` — the UI treats that identically to "no
  // agent selected" so a stale id never paints a broken badge.
  const teamAgentsStore = useTeamAgentsStore()
  // `allAgents` = built-ins + every custom (incl. disabled/archived).
  // Using the customs-only `agents` ref here would misclassify a
  // built-in selection as "deleted" because the lookup would miss.
  const { allAgents: allTeamAgents } = storeToRefs(teamAgentsStore)
  const activeAgentId = ref<string | null>(null)

  /**
   * Resolved record for the currently-selected agent — looks in the
   * FULL list, not just selectable, so the composer badge can still
   * render the agent's name + avatar even when it's disabled or
   * archived. `null` only when no agent is selected OR the id points
   * to a hard-deleted doc (the record is genuinely gone).
   *
   * The `activeAgentStatus` ref below carries the lifecycle detail
   * the badge needs to label what the user is looking at.
   */
  const activeAgent = computed<ITeamAgent | null>(() => {
    const id = activeAgentId.value
    if (!id) return null
    return allTeamAgents.value.find((agent) => agent.id === id) ?? null
  })

  /**
   * Lifecycle status of the currently-selected agent. Drives the
   * badge sub-label in the composer:
   *   - `null`     — no agent selected (default persona).
   *   - "active"   — selected agent is enabled + non-archived.
   *                  Render plain (no status sub-label).
   *   - "disabled" — admin disabled the agent. Dispatch falls back
   *                  to default; badge gains "(Disabled)".
   *   - "archived" — agent is deprecated. Dispatch STILL uses it
   *                  (existing chats keep running); badge gains
   *                  "(Archived)" to signal the deprecation.
   *   - "deleted"  — agent doc is gone (hard-deleted). Dispatch
   *                  falls back to default; badge shows "(Deleted)"
   *                  without an agent name (the record is missing).
   *
   * Disabled wins over archived when both apply — the stronger gate
   * is the one the user needs to see.
   */
  const activeAgentStatus = computed<
    "active" | "disabled" | "archived" | "deleted" | null
  >(() => {
    const id = activeAgentId.value
    if (!id) return null
    const match = allTeamAgents.value.find((agent) => agent.id === id)
    if (!match) return "deleted"
    if (match.enabled === false) return "disabled"
    if (match.archivedAt) return "archived"
    return "active"
  })

  const selectAgent = (agentId: string | null): void => {
    // Normalize empty strings to null so consumers don't have to.
    activeAgentId.value = agentId && agentId.length > 0 ? agentId : null
  }

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
  const mySessionsQuery = useCollectionQuery<IBotSession>(() => {
    const activeQuery = mySessionsQueryRef.value
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    const uid = currentUser.value?.uid
    return activeQuery && teamId && workspaceId && uid
      ? {
          query: activeQuery,
          path: `teams/${teamId}/workspaces/${workspaceId}/botSessions`,
          params: { ownerUid: uid },
        }
      : null
  })
  const allMySessions = computed(() => mySessionsQuery.data.value ?? [])
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
  const sharedSessionsQuery = useCollectionQuery<IBotSession>(() => {
    const activeQuery = sharedSessionsQueryRef.value
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    return activeQuery && teamId && workspaceId
      ? {
          query: activeQuery,
          path: `teams/${teamId}/workspaces/${workspaceId}/botSessions`,
          params: { visibility: "shared" },
        }
      : null
  })
  const sharedSessions = computed(() => {
    const uid = currentUser.value?.uid
    const all = sharedSessionsQuery.data.value ?? []
    // Exclude my own shared sessions (they live in `mySessions` already)
    // and archived sessions (their owners moved them out of view).
    return all.filter(
      (s) => (uid ? s.ownerUid !== uid : true) && !isArchived(s)
    )
  })

  const isLoadingSessions = computed(
    () => mySessionsQuery.isLoading.value || sharedSessionsQuery.isLoading.value
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

  const activeSessionQuery = useDocumentQuery<IBotSession>(activeSessionDocRef)

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
    () => activeSessionQuery.data.value?.messages,
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
      sharedSessionsQuery.data.value?.find((s) => s.id === id) ??
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

  // Snapshot-driven active-agent resync.
  //
  // The server may flip `activeAgentId` on the session doc *during* a
  // turn — specifically when the model calls `transferToAgent` and
  // the dispatcher runs a second turn under the target agent, whose
  // `SessionStore.save` writes the new `activeAgentId` to the doc.
  // Without this watcher, the composer badge would keep showing the
  // pre-transfer agent until the user reloaded the chat, and the
  // next `sendMessage` would forward the stale id.
  //
  // We watch the DOC-LEVEL subscription (`activeSessionQuery`) rather than the
  // collection-derived `activeSession`. The document query reassigns its `data`
  // ref to a fresh object on every snapshot, which ALWAYS schedules dependent
  // watchers — the messages-sync watcher above sources the same ref for the
  // same reason. (The collection-derived path was historically flaky for
  // in-place field updates under the previous VueFire stack, which reused one
  // array instance and patched items in place, so a `.find(...)`-based computed
  // didn't reliably re-trigger — symptom: the agent badge stuck on the previous
  // agent until reload.)
  //
  // The guard `next !== activeAgentId.value` prevents re-firing on
  // the local-mutation path: `selectAgent()` writes
  // `activeAgentId.value`, the next `sendMessage` writes the doc,
  // the snapshot lands with the same value, and we skip the no-op
  // assignment. Real transfers (where the doc's value diverges from
  // the local ref) flow through cleanly.
  //
  // Also handles cross-tab/device updates: another tab changes the
  // agent → doc updates → this tab's badge follows.
  watch(
    () => activeSessionQuery.data.value?.activeAgentId ?? null,
    (next) => {
      // Only sync while a session is bound — otherwise this would
      // clobber the new-chat default-null state with an unrelated
      // session's persisted agent during the brief window between
      // `selectSession` clearing and the next snapshot landing.
      if (!sessionId.value) return
      if (next === activeAgentId.value) return
      activeAgentId.value = next
    }
  )

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
    // Shared chats are collaborative: any full member (owner/admin/member)
    // can post into them. Guests — who lack MANAGE_WORKSPACE_CONTENT —
    // remain read-only. Renaming/archiving/visibility stay admin-only
    // (`canManageActive` / `canChangeVisibilityActive` below).
    return (
      activeVisibility.value === "shared" && canManageWorkspaceContent.value
    )
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
    // Attached context is a per-session concept: a fresh chat shouldn't
    // inherit the previous one's attached files. The composer's chip
    // list updates automatically through the ref. `pendingPinnedNode`
    // is also cleared so a stale node-tab binding can't leak into an
    // unrelated new chat.
    attachedNodes.value = []
    pendingPinnedNode.value = null
    // Reset to the team's configured default mode. The user's prior
    // pick was scoped to the just-ended conversation; a new chat should
    // start from the admin's preference (Settings → Agents → Default
    // mode). Falls back to `auto` if the agent config hasn't loaded.
    mode.value = teamDefaultMode.value
    // Same story for model: a fresh chat always boots on the team
    // default model. Continuity (rehydrating to the last-used model) is
    // an existing-chat concept and handled by `selectSession`.
    model.value = teamDefaultModel.value
    // Active custom agent resets too — a brand-new chat shouldn't
    // inherit the persona from whatever the user was just talking to.
    // Sidebar-launched chats (which DO want an agent preselected)
    // call `selectAgent(id)` right after this resets, so the order
    // (reset then re-select) is the safe path.
    activeAgentId.value = null
  }

  /**
   * Bind this composable to a node-pinned chat. If a session already
   * exists for the (current user, node) pair, load it. Otherwise reset
   * to a fresh-session state with the node staged as the pending pin so
   * the first send creates the pin server-side. Either way, the node
   * is also added to `attachedNodes` so the model sees it as context
   * for every turn in this chat.
   */
  const selectOrCreateNodeSession = async (
    node: BotChatNodeRef
  ): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    if (!node?.nodeId) return

    abortInflightSend()

    // Synchronous-first state: attach the inspected node immediately,
    // and reset the local message list / pending pin so the inspector
    // never shows stale chips or messages from a previously-selected
    // node while the find/load below is in flight. If the find call
    // resolves to an existing session we'll overwrite `sessionId` +
    // `messages`; if it fails (offline, backend not deployed, etc.)
    // the chip + empty-chat state still reflects the user's selection
    // and a fresh send will still create the pin via `pendingPinnedNode`.
    attachedNodes.value = [{ scope: node.scope, nodeId: node.nodeId }]
    sessionId.value = null
    messages.value = []
    pendingPinnedNode.value = { scope: node.scope, nodeId: node.nodeId }

    isLoadingSession.value = true
    try {
      const { data } = await findBotSessionByPinnedNode({
        teamId,
        workspaceId,
        scope: node.scope,
        nodeId: node.nodeId,
      })

      // Bail out if the user picked a different node while we were
      // waiting — the later watcher invocation has already set its own
      // synchronous state, and writing back stale values here would
      // briefly flash the previous node's chat into view.
      const stillCurrent =
        attachedNodes.value.length === 1 &&
        attachedNodes.value[0]?.scope === node.scope &&
        attachedNodes.value[0]?.nodeId === node.nodeId
      if (!stillCurrent) return

      if (data.sessionId) {
        // Existing pinned chat — load its history. The pin was
        // persisted server-side at creation time, so we don't need to
        // forward `pendingPinnedNode` on the next send.
        const loaded = await loadBotSession({
          teamId,
          workspaceId,
          sessionId: data.sessionId,
        })
        // Re-check after the second await for the same reason.
        const stillCurrentAfterLoad =
          attachedNodes.value.length === 1 &&
          attachedNodes.value[0]?.scope === node.scope &&
          attachedNodes.value[0]?.nodeId === node.nodeId
        if (!stillCurrentAfterLoad) return

        sessionId.value = loaded.data.sessionId
        messages.value = loaded.data.messages.map(createMessage)
        pendingPinnedNode.value = null
      }
      // else: no existing session — leave the synchronous state alone
      // (sessionId null, messages empty, pendingPinnedNode set).
    } catch (error) {
      console.error("[useBotChat] selectOrCreateNodeSession failed:", error)
      toast.error("Failed to open chat for this item.")
    } finally {
      isLoadingSession.value = false
    }
  }

  /**
   * Force a fresh pinned chat for the given node. Unlike
   * `selectOrCreateNodeSession` (which resumes if a pinned session
   * already exists), this always resets to a new-session state with
   * the node staged as the pending pin — the next `sendMessage` will
   * create another pinned-node entry server-side. Used by the
   * inspector's "new chat" button so each click spawns a new chat
   * while preserving older ones in history.
   */
  const startNewPinnedNodeSession = (node: BotChatNodeRef) => {
    if (!node?.nodeId) return
    abortInflightSend()
    sessionId.value = null
    messages.value = []
    attachedNodes.value = [{ scope: node.scope, nodeId: node.nodeId }]
    pendingPinnedNode.value = { scope: node.scope, nodeId: node.nodeId }
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
      // Optimistic active-agent sync on `transferToAgent`. The
      // toolCall chunk fires the instant the MODEL emits its
      // toolRequest — long before the server's post-turn
      // `SessionStore.save` writes `activeAgentId` to Firestore and
      // the snapshot makes it back to us (the doc-level snapshot
      // watcher's normal latency, ~100–400ms of Firestore-roundtrip).
      // Pivoting the composer badge here cuts that latency to zero;
      // the snapshot watcher then either confirms our guess (no-op
      // via its equality guard) or corrects it in the rare case the
      // server-side `availableTransferAgentIds` allowlist rejected
      // the target and the transfer never committed.
      //
      // `""` is the sentinel for "transfer back to the team default
      // persona" (matches the server's
      // `normalizeActiveAgentIdForStorage` mapping).
      if (
        call.name === "transferToAgent" &&
        call.input &&
        typeof call.input === "object"
      ) {
        const rawAgentId = (call.input as { agentId?: unknown }).agentId
        if (typeof rawAgentId === "string") {
          const next = rawAgentId === "" ? null : rawAgentId
          if (activeAgentId.value !== next) {
            activeAgentId.value = next
          }
        }
      }

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

    // Tag the optimistic user bubble with the current user's uid so the
    // avatar renders correctly from frame one. The server will write the
    // same value on its end (`save()` stamps `authorUid` from the
    // verified `auth.uid`), so the snapshot reconcile is a no-op for
    // this field.
    messages.value.push(
      createMessage({
        role: "user",
        content: trimmed,
        authorUid: currentUser.value?.uid,
      })
    )
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

    // Snapshot context refs at send time so a user toggling chips
    // mid-stream doesn't change what the model sees this turn.
    const contextNodes: BotChatNodeRef[] = attachedNodes.value.map((node) => ({
      scope: node.scope,
      nodeId: node.nodeId,
    }))
    // Only forward `pinnedNode` when we're creating a new session AND
    // the caller (typically NodeInspectorSidebar's Bot tab) set a
    // pending pin. The server ignores it on resumed sessions, but we
    // clear it locally either way to keep the invariant clean.
    const pinnedNode =
      !sessionId.value && pendingPinnedNode.value
        ? { ...pendingPinnedNode.value }
        : undefined

    try {
      const result = await sendBotMessage.stream(
        {
          teamId,
          workspaceId,
          sessionId: sessionId.value,
          message: trimmed,
          mode: mode.value,
          model: model.value,
          contextNodes,
          ...(pinnedNode ? { pinnedNode } : {}),
          // Always send `activeAgentId` (even when null) so the server
          // knows the user's intent for this turn. Omitting the field
          // is reserved for "use whatever the session already had" —
          // useful for legacy clients but never something this client
          // wants, since the picker always has a defined state.
          activeAgentId: activeAgentId.value,
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
      // Pin persisted server-side as part of session creation; clear the
      // local pending state so a subsequent send doesn't try to re-pin.
      if (pinnedNode) pendingPinnedNode.value = null
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

    const contextNodes: BotChatNodeRef[] = attachedNodes.value.map((node) => ({
      scope: node.scope,
      nodeId: node.nodeId,
    }))

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
          model: model.value,
          contextNodes,
          // Forward the current agent selection so a user who flipped
          // agents mid-interrupt has the resume turn dispatched under
          // the new persona instead of the one that asked the question.
          activeAgentId: activeAgentId.value,
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
      // Rehydrate chips from the session doc's `contextNodes` — the
      // unified field, re-written on every send so it always reflects
      // the latest attach/detach state. If the local listener hasn't
      // observed the doc yet (cold-load race), `matched` is undefined
      // and we leave the chip strip empty; the user can re-attach
      // manually or the next snapshot will sync.
      const matched = allMySessions.value.find((s) => s.id === data.sessionId)
      attachedNodes.value = matched?.contextNodes
        ? matched.contextNodes.map((node) => ({
            scope: node.scope,
            nodeId: node.nodeId,
          }))
        : []
      // Rehydrate the model picker from the session's persisted
      // `lastModel` so the chat continues on whichever model produced
      // its history (Opus's reply followed by a switch to Haiku reads
      // confusingly). Three fallback rungs cover the realistic gaps:
      //   - `matched` missing (cold-load race) → team default
      //   - `lastModel` missing (pre-feature session) → team default
      //   - `lastModel` no longer allowed (admin disabled it after
      //     this chat last ran) → team default
      // In all three cases the user's next send will overwrite
      // `lastModel` on the doc with whatever the picker shows.
      const persistedModel = matched?.lastModel
      model.value =
        persistedModel && isModelAvailable(persistedModel)
          ? persistedModel
          : teamDefaultModel.value
      // Same rehydration story for the active agent: pick up the
      // session's persisted id so the badge matches what the server
      // will dispatch with. The agent record may have been archived
      // since (admins manage agents independently of sessions); the
      // computed `activeAgent` returns null in that case so the badge
      // silently reverts to default. The server keeps the doc field
      // unchanged so restoring the agent re-binds this session.
      activeAgentId.value = matched?.activeAgentId ?? null
      pendingPinnedNode.value = null
    } catch (error) {
      console.error("[useBotChat] loadBotSession failed:", error)
      // If the session is gone (deleted from another tab, the user
      // just deleted it, or a stale link), don't leave the UI stuck
      // on a chat we can't open. Drop to a fresh-session state so the
      // page-level `state → URL` watcher pushes off /bot/{id}.
      const code = (error as { code?: string })?.code
      if (code === "functions/not-found" || code === "not-found") {
        startNewSession()
        toast.error("This chat is no longer available.")
      } else {
        toast.error("Failed to open chat. Please try again.")
      }
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

    // Optimistic local reset BEFORE the await: when we're deleting the
    // active session, we drop sessionId/messages immediately so the
    // page's `state → URL` watcher pushes off /bot/{id} right away.
    // Doing this after the await leaves a race window — the Firestore
    // listener can prune the doc from `mySessions`, which flips
    // `activeSession` to null and (via its own watcher) calls
    // startNewSession asynchronously. During that window the URL still
    // points at the doomed id, and the doc's onSnapshot can surface a
    // permission-denied error (rules need `resource.data` which no
    // longer exists), leaving the UI showing a stale "Failed to open
    // chat" toast for the session we just deleted.
    if (sessionId.value === id) startNewSession()

    isMutatingSession.value = true
    try {
      await deleteBotSession({ teamId, workspaceId, sessionId: id })
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
    model,
    availableModelsByProvider,
    activeAgentId,
    activeAgent,
    activeAgentStatus,
    selectAgent,
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
    attachedNodes,
    canAttachMoreNodes,
    attachNode,
    detachNode,
    clearAttachedNodes,
    selectOrCreateNodeSession,
    startNewPinnedNodeSession,
    pendingPinnedNode,
    pendingComposerDraft,
  }
}

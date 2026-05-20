/**
 * Bot Chat — Genkit chat sessions persisted to team/workspace context.
 *
 * Each chat session lives at:
 *   teams/{teamId}/workspaces/{workspaceId}/botSessions/{sessionId}
 *
 * The session document keeps the full Genkit `SessionData<S>` blob in
 * `data` (round-tripped opaquely by the SessionStore) plus a handful of
 * index fields (`ownerUid`, `visibility`, `title`, `preview`,
 * `messageCount`, `updatedAt`) so the history sidebar can render
 * without parsing the blob client-side.
 *
 * Visibility model:
 *   - private (default): only the owner can read/write.
 *   - shared:  any team member can read; only owner + team admins write.
 *   - public:  reserved for future — read path not implemented.
 *
 * Auth layering:
 *   - App Check + signed-in + email_verified are enforced at the callable
 *     boundary (via `enforceAppCheck` + `authPolicy` for `sendBotMessage`,
 *     and `requireVerifiedAuth` for the CRUD callables).
 *   - Membership / role / visibility / archived checks live inside the
 *     handlers, since they require Firestore reads.
 *
 * The `SessionStore.save()` deliberately does NOT touch `visibility` —
 * Genkit calls save on every chat turn, and we don't want a turn write
 * to race with the user's visibility toggle. Visibility is owned by the
 * `updateBotSessionVisibility` callable.
 */

import { onCallGenkit } from "firebase-functions/https"
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https"
import {
  z,
  type SessionData,
  type SessionStore,
  type ToolArgument,
} from "genkit/beta"
import {
  buildAgentSystemPrompt,
  normalizeActiveAgentIdForStorage,
  resolveActiveAgent,
} from "./agents.js"
import {
  BOT_AGENT_MODELS,
  loadTeamAgentConfig,
  MODE_CONFIG,
  PREVIEW_MAX_LENGTH,
  resolveEffectiveModel,
  TITLE_MAX_LENGTH,
  type BotAgentConfig,
  type BotAgentModel,
  type ChatToolName,
} from "./botAgentConfig.js"
import {
  askQuestionTool,
  BOT_CHAT_MODES,
  getWeatherTool,
  INTERRUPT_TOOL_NAMES,
  rollDiceTool,
  transferToAgentTool,
  type BotActionContext,
  type BotChatMode,
} from "./botBuiltinTools.js"
import {
  CONTEXT_NODE_MAX,
  loadAndBuildContextBlock,
  NodeRefSchema,
  type NodeRef,
} from "./botContext.js"
import { searchWorkspaceNodesTool } from "./botRag.js"
import { summarizeNodeTool } from "./botSummarize.js"
import { listBuiltInAgents } from "./builtInAgents.js"
import { admin, db } from "./firebase.js"
import {
  ai,
  isAiModelProviderConfigured,
  resolveModel,
} from "./genkitClient.js"
import { aiMiddlewares } from "./genkitMiddleware.js"
import { GENKIT_OPTS } from "./runtimeConfig.js"
import { anthropicApiKey, geminiApiKey, openaiApiKey } from "./secrets.js"
import { listTeamAgents, type TeamAgentDoc } from "./teamAgents.js"
import {
  buildCustomToolForChat,
  listTeamCustomTools,
} from "./teamCustomTools.js"
import type { IMembershipRole } from "./types.js"

// `AuthData` isn't re-exported from `firebase-functions/v2/https`, so derive
// it from `CallableRequest["auth"]` to avoid reaching into internal paths.
type AuthData = NonNullable<CallableRequest["auth"]>

export type SessionVisibility = "private" | "shared" | "public"
const ADMIN_ROLES: ReadonlyArray<IMembershipRole> = ["owner", "admin"]

const MAIN_THREAD = "main"
// TITLE_MAX_LENGTH and PREVIEW_MAX_LENGTH are imported from
// `./botAgentConfig.js` — they double as default truncation knobs for
// the SessionStore AND as the field-level defaults in
// `DEFAULT_BOT_AGENT_CONFIG`. Single source of truth lives there.

type ChatRole = "user" | "agent"

interface ToolCall {
  ref?: string
  name: string
  input?: unknown
  output?: unknown
  /** Set when this call is a paused interrupt awaiting user input. */
  isInterrupt?: boolean
}

type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: ToolCall }

export interface ChatMessage {
  role: ChatRole
  content: string
  segments?: MessageSegment[]
  /**
   * Firebase uid of the human who sent this message. Only populated for
   * user-role messages — agents have no human author. Filled in by
   * `FirestoreBotSessionStore.save()` (the extractor itself can't know
   * authorship because Genkit's thread doesn't carry it). Optional on
   * read to handle legacy docs persisted before this field existed.
   */
  authorUid?: string
}

interface ToolRequestLike {
  ref?: string
  name?: string
  input?: unknown
  partial?: boolean
}

interface ToolResponseLike {
  ref?: string
  name?: string
  output?: unknown
}

interface PartLike {
  text?: string
  toolRequest?: ToolRequestLike
  toolResponse?: ToolResponseLike
  /**
   * Genkit annotates interrupt-bearing toolRequests with
   * `metadata.interrupt`. The exact shape is opaque to us — we only
   * care whether the field exists (truthy = interrupt).
   */
  metadata?: {
    interrupt?: unknown
    [key: string]: unknown
  }
}

interface MessageLike {
  role?: string
  content?: PartLike[] | string
}

/**
 * Pull a denormalized message list out of a Genkit `SessionData` blob.
 *
 * Genkit threads are roles { user | model | tool | system } with multipart
 * content (text + toolRequest + toolResponse). Our client renders only
 * { user | agent } bubbles, so we collapse:
 *   - user           → user bubble (text-only)
 *   - model + tool*  → agent bubble whose `segments` interleave text and
 *                      tool segments. Tool responses arrive on the next
 *                      "tool"-role message and are matched to their
 *                      corresponding model-side toolRequest by `ref`.
 *
 * The "open agent message" stays open across consecutive model/tool turns
 * so a single user prompt that triggers two tool calls renders as one
 * bubble, not two. A new user message closes the open agent.
 */
export function extractMessagesFromSessionData(
  data: SessionData | undefined
): ChatMessage[] {
  if (!data?.threads) return []
  const thread = data.threads[MAIN_THREAD]
  if (!Array.isArray(thread)) return []

  const messages: ChatMessage[] = []
  let openAgent: ChatMessage | null = null

  const closeAgent = () => {
    if (!openAgent) return
    // Drop empty agent shells (model produced no content and no tools).
    const hasSegments = (openAgent.segments?.length ?? 0) > 0
    if (hasSegments || openAgent.content) messages.push(openAgent)
    openAgent = null
  }

  const ensureAgent = (): ChatMessage => {
    if (!openAgent) openAgent = { role: "agent", content: "", segments: [] }
    if (!openAgent.segments) openAgent.segments = []
    return openAgent
  }

  const appendText = (msg: ChatMessage, text: string) => {
    if (!text) return
    msg.content += text
    if (!msg.segments) {
      // User messages stay flat — no segments. Agents always get segments
      // populated via ensureAgent before this is called.
      return
    }
    const last = msg.segments[msg.segments.length - 1]
    if (last && last.kind === "text") {
      last.text += text
    } else {
      msg.segments.push({ kind: "text", text })
    }
  }

  for (const raw of thread as MessageLike[]) {
    const role = raw?.role
    const content = raw.content

    if (role === "user") {
      closeAgent()
      let text = ""
      if (typeof content === "string") {
        text = content
      } else if (Array.isArray(content)) {
        text = content
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .join("")
      }
      if (text.trim()) {
        // User messages are flat strings on the wire — no segments field.
        messages.push({ role: "user", content: text })
      }
      continue
    }

    if (role !== "model" && role !== "tool") continue

    // Coalesce model + tool turns into the same agent bubble. Genkit
    // sometimes emits a string content for legacy model messages; treat
    // that as a single text part.
    if (typeof content === "string") {
      const agent = ensureAgent()
      appendText(agent, content)
      continue
    }
    if (!Array.isArray(content)) continue

    const agent = ensureAgent()
    for (const part of content) {
      if (typeof part?.text === "string" && part.text) {
        appendText(agent, part.text)
        continue
      }
      if (part?.toolRequest && part.toolRequest.name) {
        const segments = agent.segments!
        // Two ways a request can be an interrupt: Genkit's part-level
        // metadata flag (set on the live ToolRequestPart), or our own
        // name-based fallback for older docs that pre-date that
        // annotation. Either signal flips the UI into form mode.
        const isInterrupt =
          !!part.metadata?.interrupt ||
          INTERRUPT_TOOL_NAMES.has(part.toolRequest.name)
        segments.push({
          kind: "tool",
          tool: {
            ref: part.toolRequest.ref,
            name: part.toolRequest.name,
            input: part.toolRequest.input,
            ...(isInterrupt ? { isInterrupt: true } : {}),
          },
        })
        continue
      }
      if (part?.toolResponse && part.toolResponse.name) {
        // Match the response back to the request that opened it. Genkit
        // ensures unique refs per tool round-trip; if `ref` is missing
        // we fall back to name-based match against the most recent open
        // tool segment without an output (rare, but defensive).
        const segments = agent.segments!
        const ref = part.toolResponse.ref
        const target =
          (ref &&
            segments.find(
              (s): s is Extract<MessageSegment, { kind: "tool" }> =>
                s.kind === "tool" && s.tool.ref === ref
            )) ||
          [...segments]
            .reverse()
            .find(
              (s): s is Extract<MessageSegment, { kind: "tool" }> =>
                s.kind === "tool" &&
                s.tool.name === part.toolResponse!.name &&
                s.tool.output === undefined
            )
        if (target) {
          target.tool.output = part.toolResponse.output
          // The interrupt has been answered — drop the flag so the UI
          // renders this as a completed tool card, not a pending form.
          delete target.tool.isInterrupt
        }
      }
    }
  }
  closeAgent()
  return messages
}

function deriveTitle(
  messages: ChatMessage[],
  maxLength: number = TITLE_MAX_LENGTH
): string {
  const firstUser = messages.find((m) => m.role === "user")
  const source = firstUser?.content?.trim() ?? ""
  if (!source) return "New chat"
  const collapsed = source.replace(/\s+/g, " ")
  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength).trimEnd()}…`
    : collapsed
}

function derivePreview(
  messages: ChatMessage[],
  maxLength: number = PREVIEW_MAX_LENGTH
): string {
  const last = messages[messages.length - 1]
  const source = last?.content?.trim() ?? ""
  if (!source) return ""
  const collapsed = source.replace(/\s+/g, " ")
  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength).trimEnd()}…`
    : collapsed
}

/**
 * Constructor options for `FirestoreBotSessionStore`. Named fields
 * replaced a previous 9-positional-arg constructor — that was bug-prone
 * (swapping `senderUid` and `turnActiveAgentId` silently broke both)
 * and unwieldy when only a handful of the args were turn-specific.
 *
 * Splitting `core` (teamId/workspaceId/ownerUid — fixed per
 * construction) from `turn` (everything else — re-computed per turn)
 * makes both call sites read like the data flow they describe.
 */
interface FirestoreBotSessionStoreOptions {
  /** Team + workspace + chat-owner identity. Fixed per construction. */
  readonly teamId: string
  readonly workspaceId: string
  readonly ownerUid: string

  /**
   * Per-workspace truncation knobs. The store doesn't read the agent
   * config doc itself — the calling flow loads it once per turn and
   * passes the relevant lengths in. Keeps the Genkit save callback
   * (which fires on every turn, sometimes mid-flight) free of extra
   * Firestore reads.
   */
  readonly titleMaxLength?: number
  readonly previewMaxLength?: number

  /**
   * Composite `${ownerUid}:${scope}:${nodeId}` index key for the
   * caller's node-pinned chat lookup. Written once on session
   * creation; never rewritten on subsequent saves. The pin's
   * scope/nodeId live as a normal entry inside `contextNodes` — this
   * field exists only to power `findBotSessionByPinnedNode`'s
   * single-equality Firestore query.
   */
  readonly pinnedNodeKey?: string

  /**
   * The full chip set the user has attached on the current turn.
   * Re-written on every save so detaches and reorders propagate
   * immediately. Includes the pinned node, if any — there is no
   * separate `pinnedNode` field on the doc. Empty array is a
   * meaningful state ("no chips") distinct from `undefined` on
   * docs that haven't been re-saved since this field was introduced.
   */
  readonly contextNodes?: NodeRef[]

  /**
   * Mode for the turn that triggered this save. Persisted as a
   * denormalized `lastMode` field so the history sidebar can filter
   * sessions by mode without parsing the SessionData blob. The most
   * recent turn wins — earlier turns' modes are not retained.
   */
  readonly turnMode?: BotChatMode

  /**
   * Effective model for the turn that triggered this save — the value
   * after the calling flow clamped a client-supplied override against
   * the team's current provider/model allowlist. Persisted as a
   * denormalized `lastModel` field so the client can rehydrate the
   * composer's model picker when it re-opens this chat (giving the
   * conversation a per-chat continuity that mode deliberately lacks).
   * Most recent turn wins — earlier turns' models are not retained.
   */
  readonly turnModel?: BotAgentModel

  /**
   * Firebase uid of the human who triggered this turn (the caller of
   * `sendBotMessage` / `respondToBotInterrupt`). `save()` uses it to
   * stamp the new user-role message with its real author so the
   * client can render per-sender avatars in shared chats — where
   * multiple admins may post turns into the same session and the
   * `ownerUid` heuristic falls apart.
   *
   * Optional because the interrupt-response path doesn't produce a
   * new user message; in that case nothing needs tagging.
   */
  readonly senderUid?: string

  /**
   * Effective active agent for this turn (after the calling flow's
   * `resolveActiveAgent` step). Persisted as `activeAgentId` on the
   * doc — drives the "sticky agent" behavior across turns and lets
   * the client rehydrate the composer's agent badge on session
   * re-open. `null` (or undefined) is the default-persona case and
   * results in `activeAgentId: null` being written, which is
   * deliberately distinct from the field being absent (legacy docs).
   */
  readonly turnActiveAgentId?: string | null
}

/**
 * Firestore-backed `SessionStore` scoped to one (teamId, workspaceId) pair.
 * Genkit calls `get(sessionId)` and `save(sessionId, data)` — we round-trip
 * the entire session blob as JSON, and on each save we additionally derive
 * sidebar metadata (title, preview, messageCount).
 *
 * Construction takes a single options object (`FirestoreBotSessionStoreOptions`)
 * to keep call sites readable — the prior 9-positional-arg shape was
 * easy to mis-order silently. All fields except `teamId`/`workspaceId`/`ownerUid`
 * are turn-specific and re-supplied on every per-turn instantiation.
 */
class FirestoreBotSessionStore implements SessionStore {
  private readonly teamId: string
  private readonly workspaceId: string
  private readonly ownerUid: string
  private readonly titleMaxLength: number
  private readonly previewMaxLength: number
  private readonly pinnedNodeKey?: string
  private readonly contextNodes: NodeRef[]
  private readonly turnMode?: BotChatMode
  private readonly turnModel?: BotAgentModel
  private readonly senderUid?: string
  private readonly turnActiveAgentId?: string | null

  constructor(options: FirestoreBotSessionStoreOptions) {
    this.teamId = options.teamId
    this.workspaceId = options.workspaceId
    this.ownerUid = options.ownerUid
    this.titleMaxLength = options.titleMaxLength ?? TITLE_MAX_LENGTH
    this.previewMaxLength = options.previewMaxLength ?? PREVIEW_MAX_LENGTH
    this.pinnedNodeKey = options.pinnedNodeKey
    this.contextNodes = options.contextNodes ?? []
    this.turnMode = options.turnMode
    this.turnModel = options.turnModel
    this.senderUid = options.senderUid
    this.turnActiveAgentId = options.turnActiveAgentId
  }

  private docRef(sessionId: string) {
    return db.doc(
      `teams/${this.teamId}/workspaces/${this.workspaceId}/botSessions/${sessionId}`
    )
  }

  async get(sessionId: string): Promise<SessionData | undefined> {
    const snap = await this.docRef(sessionId).get()
    if (!snap.exists) return undefined
    const raw = snap.data()?.data
    return raw ? (raw as SessionData) : undefined
  }

  async save(sessionId: string, data: SessionData): Promise<void> {
    const ref = this.docRef(sessionId)
    const snap = await ref.get()
    const isNew = !snap.exists
    const messages = extractMessagesFromSessionData(data)

    // Stamp each user-role message with its author uid. Genkit's thread
    // doesn't carry authorship, so we reconstruct it from two sources:
    //
    //   • Prior saves — every user-role message in the existing doc
    //     already has its `authorUid` (or `undefined` for legacy docs
    //     written before this field existed). We carry these forward
    //     positionally, matching the i-th user-role message in the new
    //     extracted list to the i-th user-role message of the prior doc.
    //
    //   • This turn — the *tail* user-role message (the one Genkit just
    //     appended in response to `chat.sendStream(message)`) wasn't in
    //     the prior doc. It gets `this.senderUid`.
    //
    // The positional zip works because user-role messages can only be
    // appended by `sendBotMessage` (one per successful turn); they're
    // never inserted in the middle of the thread or removed.
    if (this.senderUid) {
      const priorMessages =
        (snap.data()?.messages as ChatMessage[] | undefined) ?? []
      const priorUserAuthors: (string | undefined)[] = []
      for (const m of priorMessages) {
        if (m?.role === "user") priorUserAuthors.push(m.authorUid)
      }
      let userIndex = 0
      for (const m of messages) {
        if (m.role !== "user") continue
        const carried = priorUserAuthors[userIndex]
        m.authorUid = carried ?? this.senderUid
        userIndex++
      }
    }

    // Genkit's SessionData has `state?: S` and other optional fields that
    // arrive as `undefined` when not used. Firestore's default validator
    // rejects any undefined value in a write — so we round-trip through
    // JSON to drop them. The blob is JSON-serializable by contract (the
    // SessionStore interface is built for this round-trip).
    //
    // The same hazard applies to the denormalized `messages` array
    // extracted above: tool outputs can carry `undefined` properties
    // (e.g. an optional `distance` field a search tool didn't compute),
    // and any such value would explode the Firestore write later. Round-
    // tripping here makes the save path bulletproof regardless of which
    // tool the model invoked this turn.
    const sanitizedData = JSON.parse(JSON.stringify(data))
    const sanitizedMessages = JSON.parse(JSON.stringify(messages))

    const update: Record<string, unknown> = {
      // The codebase's `zodConverter` reads `id` from the document body
      // (not from `snap.id`), so it must live in the body to satisfy
      // `botSessionSchema` on read. Idempotent — same string every save,
      // so writing it always keeps legacy docs (saved before this field
      // existed) self-healing on the next chat turn.
      id: sessionId,
      data: sanitizedData,
      teamId: this.teamId,
      workspaceId: this.workspaceId,
      ownerUid: this.ownerUid,
      // Denormalized flat messages for real-time client subscriptions.
      // Clients shouldn't need to parse the opaque SessionData blob; this
      // field is the canonical "what does the conversation look like
      // right now" for every snapshot listener. Use the sanitized copy
      // — the in-place `messages` may carry `undefined` values from tool
      // outputs that Firestore would reject.
      messages: sanitizedMessages,
      preview: derivePreview(messages, this.previewMaxLength),
      messageCount: messages.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // The complete chip set, including the pinned node if any.
      // Re-written every turn so a detach shrinks the array on the doc
      // rather than leaving stale entries. Empty array is meaningful
      // ("no attachments this turn") and distinct from `undefined` on
      // legacy docs.
      contextNodes: this.contextNodes,
    }

    // Most recent turn's mode. Overwriting (rather than appending to a
    // history) keeps the field cheap and "filter by current mode"
    // intuitive — switching mode mid-conversation updates which bucket
    // the chat shows up in.
    if (this.turnMode) update.lastMode = this.turnMode

    // Most recent turn's effective model. Same overwrite-on-save shape
    // as `lastMode`; the client reads this on session re-open to
    // restore the picker (see `useBotChat.selectSession`). Only the
    // effective model lands here — if the caller's requested override
    // failed the allowlist clamp upstream, this field reflects the
    // fallback model that actually ran, not the rejected request.
    if (this.turnModel) update.lastModel = this.turnModel

    // Effective active agent for this turn. Written on every save
    // (including the explicit `null` case) so flipping back to the
    // default persona clears a previously-stuck agent id rather than
    // leaving stale data on the doc. `undefined` would have left the
    // field at its prior value via `set+merge`, which would silently
    // pin a session to an agent the user just deselected — surprising
    // and hard to debug.
    if (this.turnActiveAgentId !== undefined) {
      update.activeAgentId = this.turnActiveAgentId
    }

    // Title, createdAt, the null archivedAt sentinel, and pinnedNodeKey
    // are all one-shot writes — set on creation, never updated by
    // subsequent sends. (Rename is its own callable; the pin's
    // queryable identity is fixed when the chat is first launched
    // from an inspector tab.)
    if (isNew) {
      update.title = deriveTitle(messages, this.titleMaxLength)
      update.createdAt = admin.firestore.FieldValue.serverTimestamp()
      update.archivedAt = null
      if (this.pinnedNodeKey) {
        update.pinnedNodeKey = this.pinnedNodeKey
      }
    }

    await ref.set(update, { merge: true })
  }
}

// ===========================================================================
// Per-turn mode configuration — `MODE_CONFIG` is imported from
// `./botAgentConfig.js` because it carries the default prompt suffixes
// for `DEFAULT_BOT_AGENT_CONFIG.promptSuffixes`. The chat orchestration
// layer here reads `MODE_CONFIG[mode].actionToolsEnabled` inside
// `pickChatTools` to gate side-effecting tools.
// ===========================================================================

// ===========================================================================
// Built-in tools live in `botBuiltinTools.ts` (getWeather, rollDice,
// transferToAgent, askQuestion) — imported up top. This file orchestrates
// which tools to register per turn via `pickChatTools`; the tool
// definitions themselves stay out of this orchestration layer so the
// chat flow can read top-to-bottom without 200 lines of demo machinery.
// ===========================================================================

// ===========================================================================
// Team agent configuration lives in `./botAgentConfig.js` — the
// `BotAgentConfig` shape, defaults, normalization, `loadTeamAgentConfig`,
// and the `getTeamAgentConfig`/`updateTeamAgentConfig` callables. This
// file imports just the types and helpers it needs for chat
// orchestration; the standalone CRUD surface stays in its own module.
// ===========================================================================

// ===========================================================================
// Node-context loading lives in `./botContext.ts` — `loadAndBuildContextBlock`
// is the only entry point the chat flow uses. The supporting machinery
// (NodeRef schema, Firestore + Storage reads, markdown formatting,
// code-fence escape) all moved with it. Keep this file focused on
// orchestration: WHICH refs to load and WHERE the resulting block lands
// in the system prompt.
// ===========================================================================

/**
 * Deterministic Firestore-queryable key for a (user, node) pin. Written
 * once on session creation to power `findBotSessionByPinnedNode`'s
 * indexed lookup. The pin's `scope`/`nodeId` are not stored as their
 * own field — they live as a normal entry inside `contextNodes`.
 */
export function pinnedNodeKey(
  ownerUid: string,
  scope: "code" | "write",
  nodeId: string
): string {
  return `${ownerUid}:${scope}:${nodeId}`
}

/**
 * Pick which tools to register with the chat for a given (config, mode).
 *   - Mode strips action tools in `manual` (existing behavior).
 *   - Workspace-level toggles strip individual tools regardless of mode.
 *   - Interrupt tools (askQuestion) are gateable too — opt-in disable.
 *   - Read-only tools (searchWorkspaceNodes) are exposed in every mode
 *     including `manual` since they only retrieve, never act. It is
 *     still Google-gated because the current retriever uses Gemini
 *     embeddings under the hood.
 */
function pickChatTools(
  config: BotAgentConfig,
  mode: BotChatMode,
  agent: TeamAgentDoc | null = null,
  transferTargetCount: number = 0
) {
  const modeAllowsActionTools = MODE_CONFIG[mode].actionToolsEnabled
  const googleBackedSearchAvailable =
    config.providers.google && isAiModelProviderConfigured("google")
  // Agent-level intersection: a tool fires only when the team has it on
  // AND the active agent (if any) has it on. `!== false` treats missing
  // keys as enabled — keeps a newly-added tool key available to
  // existing agents without a migration. When `agent` is null this is
  // always `true`, preserving the default-persona behavior exactly.
  //
  // Parameter is narrowed to `ChatToolName` (the per-agent-relevant
  // subset) so we can never accidentally call `agentAllows("customAgents")`
  // — that flag is team-only and has no per-agent counterpart.
  const agentAllows = (name: ChatToolName): boolean =>
    !agent || agent.tools[name] !== false
  // Typed as Genkit's `ToolArgument` union — accepts every flavor of
  // tool reference Genkit's `chat({ tools })` understands: strict
  // ToolAction (the built-in tools), MultipartToolAction (any
  // interrupt tool), or a string lookup. Custom tools synthesize
  // their schemas from admin-defined field lists at runtime so they
  // come back as a wider ZodObject; `ToolArgument` is the supertype
  // that lets the heterogeneous mix coexist without per-push casts.
  const tools: ToolArgument[] = []
  if (
    modeAllowsActionTools &&
    config.tools.getWeather &&
    agentAllows("getWeather")
  )
    tools.push(getWeatherTool)
  if (modeAllowsActionTools && config.tools.rollDice && agentAllows("rollDice"))
    tools.push(rollDiceTool)
  if (config.tools.askQuestion && agentAllows("askQuestion"))
    tools.push(askQuestionTool)
  if (
    config.tools.searchWorkspaceNodes &&
    googleBackedSearchAvailable &&
    agentAllows("searchWorkspaceNodes")
  )
    tools.push(searchWorkspaceNodesTool)
  if (config.tools.summarizeNode && agentAllows("summarizeNode"))
    tools.push(summarizeNodeTool)
  // `transferToAgent` is only exposed when at least one OTHER agent
  // (or the team default, when an agent is currently active) is
  // reachable. Listing the tool with no available targets would
  // tempt the model into calls it can't actually satisfy. Mode and
  // agent-tool toggles deliberately don't gate this — transfer is a
  // meta-action, not a domain action like `getWeather`, and even
  // `manual` mode benefits from the ability to hand off to a more
  // capable persona.
  if (transferTargetCount > 0) tools.push(transferToAgentTool)
  return tools
}

// ===========================================================================
// Transfer helpers — shared by both `sendBotMessageFlow` and
// `respondToBotInterruptFlow`.
// ===========================================================================

/**
 * Build the "you can transfer to…" roster for the current turn. Each
 * entry is `{ id, name, description }` — passed to
 * `buildAgentSystemPrompt` (to enumerate targets in the system prompt)
 * and projected to ids only for `actionContext.availableTransferAgentIds`
 * (the runtime allowlist enforced inside the tool handler).
 *
 *   - When a custom agent is active: roster = every OTHER active
 *     custom agent + a synthetic team-default entry with `id: ""`.
 *     The default is included so the model can hand back to the
 *     generic persona without needing to know any other custom id.
 *
 *   - When no agent is active (default persona): roster = every
 *     active custom agent. The synthetic default is excluded — you
 *     can't transfer to where you already are.
 *
 *   - Always empty when `customAgents` is empty AND no agent is
 *     active (nothing to transfer to). The caller checks
 *     `length === 0` and skips the directive + the tool entirely.
 */
function buildTransferRoster(
  activeAgent: TeamAgentDoc | null,
  customAgents: ReadonlyArray<TeamAgentDoc>
): { id: string; name: string; description: string }[] {
  const roster: { id: string; name: string; description: string }[] = []
  for (const candidate of customAgents) {
    // Transfer targets must be SELECTABLE — enabled and non-archived.
    // Disabled agents are gated out by `resolveActiveAgent` anyway,
    // so transferring to one would just bounce back to default; not
    // useful to advertise as a target. Archived agents still
    // dispatch for chats that ALREADY reference them, but the whole
    // point of archive-as-deprecate is to discourage new selections —
    // so we don't advertise them as transfer targets either.
    if (candidate.enabled === false) continue
    if (candidate.archivedAt) continue
    if (activeAgent && candidate.id === activeAgent.id) continue
    roster.push({
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
    })
  }
  if (activeAgent) {
    // Synthetic "back to default" target — id is the empty string so
    // `normalizeActiveAgentIdForStorage` translates it to `null` on
    // the doc write below. Hardcoded English label/description here
    // because the directive lives in the system prompt (server-side,
    // not user-facing i18n).
    roster.push({
      id: "",
      name: "Default Assistant",
      description: "The team's default persona — broad-purpose helper.",
    })
  }
  return roster
}

/**
 * After-turn write that commits the model's `transferToAgent` request
 * (if any) to the session doc. The store's in-turn `save()` already
 * wrote the PRE-turn agent id; this merge updates the doc to whatever
 * the model handed off to so the next user message routes correctly.
 *
 * No-op when the model didn't call `transferToAgent`. A single
 * Firestore write in the rare transfer-happened case — added latency
 * is negligible against the model turn that just preceded it.
 *
 * The empty-string sentinel is translated to `null` here (the doc
 * field's "team default" representation) via
 * `normalizeActiveAgentIdForStorage`, keeping all sentinel handling
 * centralized in `agents.ts`.
 */
async function commitTransferIfRequested(
  teamId: string,
  workspaceId: string,
  sessionId: string,
  actionContext: BotActionContext
): Promise<void> {
  const requested = actionContext.requestedTransferAgentId
  if (requested === undefined) return
  const nextAgentId = normalizeActiveAgentIdForStorage(requested)
  await db
    .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
    .set(
      {
        activeAgentId: nextAgentId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
}

// ===========================================================================
// Auth helpers
// ===========================================================================

/**
 * Require the caller to be signed in with a verified email and return the
 * narrowed auth. Used by every non-Genkit callable in this file (the
 * Genkit-wrapped flow enforces `email_verified` via `authPolicy`, so it
 * doesn't need this helper).
 *
 * Returning the auth (instead of using an `asserts` helper) avoids
 * TypeScript's flaky narrowing of property accesses like `request.auth.uid`
 * across the call boundary.
 */
export function requireVerifiedAuth(auth: AuthData | undefined): AuthData {
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.")
  }
  if (auth.token?.email_verified !== true) {
    throw new HttpsError(
      "permission-denied",
      "Verify your email address to continue."
    )
  }
  return auth
}

/**
 * Read the caller's membership doc and return their role. Throws if the
 * caller has no membership in the team.
 */
export async function getMembershipRole(
  teamId: string,
  uid: string
): Promise<IMembershipRole> {
  const snap = await db.doc(`teams/${teamId}/memberships/${uid}`).get()
  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "You are not a member of this team."
    )
  }
  return snap.data()?.role as IMembershipRole
}

export function isAdminRole(role: IMembershipRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role)
}

interface BotSessionDocSummary {
  ownerUid: string
  visibility: SessionVisibility
  archived: boolean
  data?: SessionData
  /**
   * Persisted active custom-agent id from the previous turn. Used by
   * the dispatcher to "stick" the agent across turns even when the
   * client doesn't re-send `activeAgentId` (resumes, interrupt
   * responses, etc.). Null when the session uses the team default
   * persona — which is also the legacy state for sessions saved
   * before this feature shipped.
   */
  activeAgentId: string | null
}

/** Load a session doc and normalize visibility (absent ⇒ "private"). */
export async function readSessionDoc(
  teamId: string,
  workspaceId: string,
  sessionId: string
): Promise<BotSessionDocSummary | null> {
  const snap = await db
    .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
    .get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const rawVisibility = data.visibility
  const visibility: SessionVisibility =
    rawVisibility === "shared" || rawVisibility === "public"
      ? rawVisibility
      : "private"
  // `activeAgentId` is read as-stored — including ids that point to
  // since-archived agents. The dispatcher (`resolveActiveAgent`) does
  // the tombstone check at turn time and silently falls back to the
  // default when the id no longer resolves to an active agent. Keeping
  // the doc field unchanged means restoring an archived agent
  // automatically re-binds every session that referenced it.
  const rawActiveAgentId = data.activeAgentId
  const activeAgentId =
    typeof rawActiveAgentId === "string" && rawActiveAgentId.length > 0
      ? rawActiveAgentId
      : null
  return {
    ownerUid: data.ownerUid as string,
    visibility,
    archived: !!data.archivedAt,
    data: data.data as SessionData | undefined,
    activeAgentId,
  }
}

// ===========================================================================
// sendBotMessage — Genkit flow with streaming, exposed via onCallGenkit.
// ===========================================================================

// ===========================================================================
// Node context — workspace files/folders the user attached to a chat turn.
// ===========================================================================
//
// Two related shapes share the same `{scope, nodeId}` ref:
//   - `contextNodes` — per-turn attachments. Their content + attachment
//     metadata is fetched and injected into that turn's system prompt so
//     the model can ground its reply in the user's actual files.
//   - `pinnedNode`   — a one-shot field written when a new session is
//     created. Lets the NodeInspectorSidebar Bot tab find "the chat for
//     this node" later via `findBotSessionByPinnedNode`. Ignored when
//     resuming an existing session.
//
// `CONTEXT_NODE_MAX` (imported from `./botContext.js`) caps prompt size;
// without it a misbehaving client could attach hundreds of files per turn
// and blow past the model's context window (and our token budget). The
// `NodeRef` schema + per-node loading machinery also live in
// `./botContext.js` — see that module for fetching + markdown assembly.

const SendBotMessageInput = z.object({
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  /** Pass null/undefined to start a new session; the response carries the new id. */
  sessionId: z.string().nullable().optional(),
  message: z.string().min(1),
  /**
   * Action-context mode for this turn. Drives the system prompt, tool
   * exposure, and any context.mode-aware tool branching. Defaults to
   * `auto` — older clients that don't send the field still work.
   */
  mode: z.enum(BOT_CHAT_MODES).default("auto"),
  /**
   * Per-turn model override picked by the user in the composer's model
   * dropdown. Optional — when omitted (or when the requested id isn't
   * currently allowed by the team's provider/model toggles) the flow
   * silently falls back to `agentConfig.model`. The clamp keeps admin
   * policy authoritative; a client that holds onto a stale id (because
   * an admin just disabled it) can't escape the allowlist via a
   * crafted payload. The zod enum here is the first line of defense —
   * unknown wire-names are rejected before they reach the clamp.
   */
  model: z.enum(BOT_AGENT_MODELS).optional(),
  /**
   * Custom agent the user has selected for this turn. `null`/absent
   * means "use the team default persona". The server resolves the
   * effective agent at dispatch time via `resolveActiveAgent`:
   *   1. If the id is set and still points to an active (non-archived)
   *      agent, that agent's persona handles the turn AND the new id
   *      is persisted on the session doc.
   *   2. If the id is missing/stale and the session has a persisted
   *      `activeAgentId` from a prior turn, that one sticks.
   *   3. Otherwise the team default handles the turn.
   * Empty string is treated identically to null — keeps the wire
   * format forgiving for clients that round-trip JSON.
   */
  activeAgentId: z.string().nullable().optional(),
  /**
   * Workspace nodes the user attached to this turn. Fetched server-side
   * and injected into the system prompt as ground-truth context. Capped
   * at `CONTEXT_NODE_MAX` to bound prompt size and Firestore reads.
   */
  contextNodes: z.array(NodeRefSchema).max(CONTEXT_NODE_MAX).default([]),
  /**
   * Set only when creating a new session, to bind it to a specific
   * workspace node. Enables `findBotSessionByPinnedNode` to resume the
   * same chat the next time the node's inspector tab opens. Ignored on
   * resumed sessions (the pin is set once, at creation).
   */
  pinnedNode: NodeRefSchema.optional(),
})

const SendBotMessageOutput = z.object({
  sessionId: z.string(),
  reply: z.string(),
})

/**
 * Streaming chunks carry one of four payloads (any combination is valid;
 * the client routes by which fields are present):
 *   - `{ sessionId }` — emitted once, as the first chunk, so the client
 *     can pin the URL to a linkable `/bot/:id` before the reply has
 *     finished.
 *   - `{ chunk }`     — a raw text delta from the model.
 *   - `{ toolCall }`  — the model decided to invoke a tool. Emitted only
 *     for fully-formed (non-partial) toolRequest parts so the client
 *     never sees half-parsed JSON. `ref` correlates with the matching
 *     `toolResult` chunk that lands later.
 *   - `{ toolResult }` — the tool finished running and returned `output`.
 *     The client uses `ref` to flip the matching tool card from "running"
 *     to "done".
 * The final aggregated reply still lands on the unary response.
 */
const SendBotMessageStream = z.object({
  sessionId: z.string().optional(),
  chunk: z.string().optional(),
  toolCall: z
    .object({
      ref: z.string().optional(),
      name: z.string(),
      input: z.unknown().optional(),
      /**
       * Set when this tool call is an interrupt — the chat is paused
       * waiting for the client to call `respondToBotInterrupt`. The
       * client renders an interactive form for these instead of a
       * "Running…" spinner.
       */
      isInterrupt: z.boolean().optional(),
    })
    .optional(),
  toolResult: z
    .object({
      ref: z.string().optional(),
      name: z.string(),
      output: z.unknown().optional(),
    })
    .optional(),
})

type SendBotMessageStreamPayload = z.infer<typeof SendBotMessageStream>

/**
 * Result shape of `chat.sendStream(...)` reduced to the bits we read.
 * Genkit's full type is generic over schemas; we only need an iterable
 * stream of chunks (each carrying a `content` array of parts) plus a
 * final response promise that exposes `text` and `messages`.
 */
interface ChatStreamResult {
  stream: AsyncIterable<{ content?: PartLike[] }>
  response: Promise<{ text: string; messages?: MessageLike[] }>
}

/**
 * Collect all tool-call and tool-result refs from a pre-turn Genkit
 * thread, keyed identically to `streamChatToClientInner`'s `refKey()`.
 *
 * Why this exists: `chat.sendStream(...).response.messages` returns the
 * full session thread, not just this turn's new exchange. The sweep
 * pass that re-emits "missed" tool events (see `streamChatToClient`)
 * therefore walks the entire history. Without seeding its dedup sets
 * with prior refs, every new turn re-emits every historical
 * `toolCall` / `toolResult` chunk — the client appends them to the new
 * agent bubble's segments and the UI shows duplicated tool cards from
 * older turns. Pre-marking the prior refs makes the sweep skip them
 * cleanly while still catching legitimately-missed events from the
 * *current* turn (the original purpose of the sweep).
 *
 * Sequence-number fallback (`${name}#${seq}`) intentionally mirrors
 * `refKey()` so the dedup aligns for the rare case where Genkit emits
 * a ref-less tool part. In practice every modern provider supplies
 * stable refs and the fallback is just belt-and-suspenders.
 */
function collectPriorTurnToolRefs(data: SessionData | undefined): {
  calls: string[]
  results: string[]
} {
  const calls: string[] = []
  const results: string[] = []
  if (!data?.threads) return { calls, results }
  const thread = data.threads[MAIN_THREAD]
  if (!Array.isArray(thread)) return { calls, results }
  let callSeq = 0
  let resultSeq = 0
  for (const raw of thread as MessageLike[]) {
    const content = raw?.content
    if (!Array.isArray(content)) continue
    for (const part of content as PartLike[]) {
      if (part.toolRequest && part.toolRequest.name) {
        if (part.toolRequest.partial) continue
        const ref =
          part.toolRequest.ref ?? `${part.toolRequest.name}#${callSeq}`
        calls.push(`call:${ref}`)
        callSeq++
      } else if (part.toolResponse && part.toolResponse.name) {
        const ref =
          part.toolResponse.ref ?? `${part.toolResponse.name}#${resultSeq}`
        results.push(`result:${ref}`)
        resultSeq++
      }
    }
  }
  return { calls, results }
}

/**
 * Pump a Genkit `chat.sendStream(...)` result out to the client as
 * `SendBotMessageStreamPayload` chunks.
 *
 * Two passes:
 *   1. Live: walks each streamed chunk's `content` parts. Text becomes
 *      `chunk` payloads; non-partial `toolRequest` parts become
 *      `toolCall` payloads (with `isInterrupt` flagged for paused HITL
 *      requests); `toolResponse` parts become `toolResult` payloads.
 *   2. Sweep: after the stream drains, walks `final.messages` and
 *      re-emits any tool events the live stream missed. Some providers
 *      fold `toolResponse` parts into the next model turn's preamble
 *      instead of surfacing them as their own chunks, so without the
 *      sweep the UI can leave a tool card stuck on "Running…".
 *
 * Both passes dedupe via the same ref-keyed sets, so a part that *did*
 * surface in the live stream isn't double-emitted in the sweep.
 *
 * `preSentToolCalls` / `preSentToolResults` let a caller pre-mark refs
 * as "already emitted" so the sweep skips them:
 *   - `preSentToolResults` is also used by `respondToBotInterruptFlow`
 *     to avoid double-emitting the just-resolved interrupt's toolResult
 *     after the resume kicks off.
 *   - Both fields are populated from the pre-turn session thread (see
 *     `collectPriorTurnToolRefs`) so the sweep doesn't resurface
 *     historical tool round-trips into the new turn's agent bubble.
 *
 * Returns the resolved final response so the caller can use
 * `final.text` for the unary reply.
 */
/**
 * Detect Genkit's "model exhausted its tool budget" error so the chat
 * flow can convert it into a user-visible message instead of letting
 * `onCallGenkit` wrap it as `INTERNAL`.
 *
 * Matches on `status === "ABORTED"` AND the message string mentioning
 * tool-iteration exhaustion — narrowing past `ABORTED` alone, which
 * Genkit also uses for legitimate user-initiated cancellations that
 * should keep propagating.
 */
function isToolIterationsExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as {
    status?: string
    originalMessage?: string
    message?: string
  }
  if (e.status !== "ABORTED") return false
  const msg = e.originalMessage ?? e.message ?? ""
  return msg.includes("maximum tool call iterations")
}

/**
 * Per-turn hard deadline. The provider call (Gemini / Claude / OpenAI)
 * can hang indefinitely on a bad day — flaky network, provider
 * incident, model that gets stuck mid-thought. Without a deadline the
 * Cloud Function consumes its whole `timeoutSeconds` (typically 540s)
 * before returning anything to the client, who sees a generic
 * INTERNAL error long after the user moved on.
 *
 * 90s is generous for normal turns (most complete inside ~10s) and
 * tight enough to fail fast on hung providers. Teams paying for
 * top-tier models occasionally hit ~60s legitimately during heavy
 * tool chains, so we leave headroom.
 *
 * Note: this cancels OUR awaiting of the response, not the model
 * call itself. Genkit doesn't yet expose an abort signal we can
 * plumb into the underlying provider client, so the model keeps
 * computing in the background until either it finishes (and we
 * ignore the result) or the Cloud Function instance recycles. The
 * user-visible behavior is the same — a graceful fallback chunk
 * instead of a 540s hang.
 */
const TURN_DEADLINE_MS = 90_000

/**
 * Thrown from the timeout race below so the outer catch can distinguish
 * "deadline elapsed" from genuine model / network errors and convert
 * it into a user-visible fallback chunk. Identity-based detection
 * (`instanceof`) is more robust than string matching.
 */
class TurnTimeoutError extends Error {
  constructor() {
    super(`Turn exceeded deadline of ${TURN_DEADLINE_MS}ms.`)
    this.name = "TurnTimeoutError"
  }
}

async function streamChatToClient(
  result: ChatStreamResult,
  sendChunk: (chunk: SendBotMessageStreamPayload) => void,
  options: {
    preSentToolCalls?: Iterable<string>
    preSentToolResults?: Iterable<string>
  } = {}
): Promise<Awaited<ChatStreamResult["response"]>> {
  // Race the actual stream consumer against a wall-clock deadline.
  // Whoever finishes first decides the outcome. The timer is always
  // cleared in `finally` so a fast-finishing turn doesn't leave a
  // pending callback to fire later (a cheap leak per turn that would
  // accumulate over a Cloud Functions instance's lifetime).
  //
  // On timeout we send the user a graceful fallback chunk and return
  // a stub response — the model call itself may still be in flight
  // (no abort signal hook into Genkit yet), but the user has their
  // answer and the function can return cleanly. The wasted compute
  // is the price of not hanging the whole Cloud Function.
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      streamChatToClientInner(result, sendChunk, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TurnTimeoutError()),
          TURN_DEADLINE_MS
        )
      }),
    ])
  } catch (err) {
    if (err instanceof TurnTimeoutError) {
      const fallback =
        "The model is taking longer than usual to reply. Please try sending your message again — provider hiccups usually clear within a minute."
      sendChunk({ chunk: fallback })
      // Stub return — same pattern as the tool-iterations fallback
      // below. The client's streaming side already saw the fallback
      // chunk; the unary echo just mirrors it.
      return { text: fallback, messages: [] } as unknown as Awaited<
        ChatStreamResult["response"]
      >
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * The actual stream consumer — extracted from `streamChatToClient` so
 * the outer wrapper can race it against `TURN_DEADLINE_MS` without
 * tangling the timeout machinery with the for-await loop.
 */
async function streamChatToClientInner(
  result: ChatStreamResult,
  sendChunk: (chunk: SendBotMessageStreamPayload) => void,
  options: {
    preSentToolCalls?: Iterable<string>
    preSentToolResults?: Iterable<string>
  } = {}
): Promise<Awaited<ChatStreamResult["response"]>> {
  const sentToolCalls = new Set<string>(options.preSentToolCalls ?? [])
  const sentToolResults = new Set<string>(options.preSentToolResults ?? [])
  const refKey = (
    part: ToolRequestLike | ToolResponseLike,
    kind: "call" | "result",
    seq: number
  ): string => `${kind}:${part.ref ?? `${part.name}#${seq}`}`

  let liveCallSeq = 0
  let liveResultSeq = 0
  for await (const chunk of result.stream) {
    // Iterate parts directly — `chunk.text` collapses text parts and
    // hides tool requests/responses. Only the parts walk gives us
    // structured access to the tool round-trip.
    const parts = chunk.content ?? []
    for (const part of parts) {
      if (typeof part.text === "string" && part.text) {
        sendChunk({ chunk: part.text })
        continue
      }
      if (part.toolRequest && part.toolRequest.name) {
        // Skip partial toolRequests — Gemini streams the JSON input as
        // it tokenizes, and we don't want the client to render a half-
        // parsed `{"locat`. The terminal non-partial chunk carries the
        // complete input.
        if (part.toolRequest.partial) continue
        const key = refKey(part.toolRequest, "call", liveCallSeq++)
        if (sentToolCalls.has(key)) continue
        sentToolCalls.add(key)
        const isInterrupt =
          !!part.metadata?.interrupt ||
          INTERRUPT_TOOL_NAMES.has(part.toolRequest.name)
        sendChunk({
          toolCall: {
            ref: part.toolRequest.ref,
            name: part.toolRequest.name,
            input: part.toolRequest.input,
            ...(isInterrupt ? { isInterrupt: true } : {}),
          },
        })
        continue
      }
      if (part.toolResponse && part.toolResponse.name) {
        const key = refKey(part.toolResponse, "result", liveResultSeq++)
        if (sentToolResults.has(key)) continue
        sentToolResults.add(key)
        sendChunk({
          toolResult: {
            ref: part.toolResponse.ref,
            name: part.toolResponse.name,
            output: part.toolResponse.output,
          },
        })
      }
    }
  }

  // `result.response` rejects with a `GenkitError` whose `status` is
  // `ABORTED` when the model exhausts its tool-call budget without
  // producing a final text. Without this catch, that reject would
  // propagate to `onCallGenkit`, which wraps it as the opaque
  // `INTERNAL` the client sees — and then the optimistic UI rollback
  // makes the chat look like it was wiped. Convert the abort into a
  // user-visible "couldn't find that" reply on the same stream so the
  // chat ends gracefully instead of vanishing.
  let final: Awaited<ChatStreamResult["response"]>
  try {
    final = await result.response
  } catch (err) {
    if (isToolIterationsExceededError(err)) {
      const fallback =
        "I tried a few searches but couldn't pin down what you're after. Could you give me more specific terms — a document name or a phrase from inside it — or attach the file to this turn so I can read it directly?"
      sendChunk({ chunk: fallback })
      // Stub return — caller only uses `final.text` for the unary reply.
      // Cast is justified because the streaming protocol with the client
      // already concluded successfully via `sendChunk`; the outer flow
      // is just turning the same text into its unary echo.
      return { text: fallback, messages: [] } as unknown as Awaited<
        ChatStreamResult["response"]
      >
    }
    throw err
  }

  let sweepCallSeq = 0
  let sweepResultSeq = 0
  for (const msg of final.messages ?? []) {
    const content = msg.content
    if (!Array.isArray(content)) continue
    for (const part of content as PartLike[]) {
      if (part.toolRequest && part.toolRequest.name) {
        if (part.toolRequest.partial) continue
        const key = refKey(part.toolRequest, "call", sweepCallSeq++)
        if (sentToolCalls.has(key)) continue
        sentToolCalls.add(key)
        const isInterrupt =
          !!part.metadata?.interrupt ||
          INTERRUPT_TOOL_NAMES.has(part.toolRequest.name)
        sendChunk({
          toolCall: {
            ref: part.toolRequest.ref,
            name: part.toolRequest.name,
            input: part.toolRequest.input,
            ...(isInterrupt ? { isInterrupt: true } : {}),
          },
        })
      } else if (part.toolResponse && part.toolResponse.name) {
        const key = refKey(part.toolResponse, "result", sweepResultSeq++)
        if (sentToolResults.has(key)) continue
        sentToolResults.add(key)
        sendChunk({
          toolResult: {
            ref: part.toolResponse.ref,
            name: part.toolResponse.name,
            output: part.toolResponse.output,
          },
        })
      }
    }
  }

  return final
}

/**
 * Shape returned by `prepareChatTurn`. Carries everything both flows
 * need to actually drive a chat turn — the configured Genkit `Chat`
 * object (not yet streamed), the action context the model + tools
 * will see, and the existing session doc (when one was loaded) so the
 * resume flow can locate its pending interrupt.
 */
interface PreparedChatTurn {
  /** Genkit `Chat` ready for `sendStream(...)`. Caller invokes streaming. */
  chat: ReturnType<Awaited<ReturnType<typeof ai.loadSession>>["chat"]>
  /** Genkit `Session` — `.id` is the canonical session id for this turn. */
  session: Awaited<ReturnType<typeof ai.loadSession>>
  /** Per-turn action context; tools read it via their handler's 2nd arg. */
  actionContext: BotActionContext
  /** The session doc loaded for this turn (null on fresh-session creation). */
  existingSession: BotSessionDocSummary | null
  /** Post-clamp model wire-name used for `chat.model` + persistence. */
  effectiveModel: BotAgentModel
}

/**
 * Shared per-turn setup for both `sendBotMessageFlow` and
 * `respondToBotInterruptFlow`. Extracted because the two flows
 * previously duplicated ~140 lines of identical logic — every change
 * to the chat-construction sequence had to be applied twice and
 * forgetting one half was a silent bug.
 *
 * What this owns:
 *   - Edit-permission gate (loads session doc, checks role / owner /
 *     archive flag).
 *   - Agent config + custom agents load (with the `customAgents`
 *     feature-flag short-circuit that skips the agents collection
 *     read when the team has the feature disabled).
 *   - Active agent resolution (composer override → session-persisted
 *     → default persona).
 *   - SessionStore construction with all the per-turn metadata.
 *   - Session creation OR load.
 *   - Context block build (parallel node + attachment fetch).
 *   - Transfer roster + action context + tool selection + system
 *     prompt assembly.
 *   - `session.chat(...)` construction with model/config/middleware.
 *
 * What the CALLER owns (small enough to keep flow-specific):
 *   - The actual `chat.sendStream(...)` invocation (message string
 *     for sends, `{ resume: { respond } }` for interrupt responses).
 *   - Pre/post-stream chunk emission (e.g. the resume flow emits a
 *     toolResult chunk before streaming, then pre-marks its ref).
 *   - Calling `commitTransferIfRequested` after streaming completes.
 *
 * The `archivedSessionMessage` parameter is the one user-visible
 * difference between flows — "before sending new messages" vs.
 * "before continuing" — so it stays a caller-supplied string.
 * `requireExistingSession` toggles between the two session-id
 * regimes (send allows null = create new; interrupt response
 * requires an existing session).
 */
async function prepareChatTurn(opts: {
  auth: AuthData
  teamId: string
  workspaceId: string
  sessionId: string | null
  mode: BotChatMode
  contextNodes: NodeRef[]
  activeAgentId: string | null | undefined
  model: BotAgentModel | undefined
  pinnedNode?: NodeRef
  requireExistingSession: boolean
  archivedSessionMessage: string
}): Promise<PreparedChatTurn> {
  const {
    auth,
    teamId,
    workspaceId,
    sessionId,
    mode,
    contextNodes,
    activeAgentId,
    pinnedNode,
    requireExistingSession,
    archivedSessionMessage,
  } = opts

  const role = await getMembershipRole(teamId, auth.uid)

  // Edit-permission gate. The owner always has edit; for shared sessions,
  // team admins also have edit. Archived sessions reject regardless of
  // role — archiving is a soft "read-only" flag.
  let existingSession: BotSessionDocSummary | null = null
  if (sessionId) {
    existingSession = await readSessionDoc(teamId, workspaceId, sessionId)
    if (!existingSession) {
      throw new HttpsError("not-found", "Session not found.")
    }
    if (existingSession.archived) {
      throw new HttpsError("failed-precondition", archivedSessionMessage)
    }
    const isOwner = existingSession.ownerUid === auth.uid
    const canEdit =
      isOwner || (existingSession.visibility === "shared" && isAdminRole(role))
    if (!canEdit) {
      throw new HttpsError(
        "permission-denied",
        "You don't have permission to send messages in this chat."
      )
    }
  } else if (requireExistingSession) {
    // Interrupt-response flow can't operate without a session — the
    // pending interrupt lives inside the SessionData blob.
    throw new HttpsError("invalid-argument", "sessionId is required.")
  }

  // Load the team's agent config — drives model, prompt, tools, generation
  // knobs, and the SessionStore's title/preview lengths. One Firestore
  // read per turn (negligible against model latency); we intentionally
  // don't cache because admin settings changes should apply on the next
  // send, not after a deploy.
  const agentConfig = await loadTeamAgentConfig(teamId)

  // Resolve active agent. Lookup precedence: input override →
  // session-persisted → null (team default). Two independently-gated
  // sources merge into a single available-agents list:
  //
  //   - **Built-in presets** (Researcher / Writer / Summarizer / Code
  //     helper) are always synthesizable from the local registry; the
  //     team's per-preset toggle in `agentConfig.builtInAgents` filters
  //     them. The team-wide `customAgents` feature gate ALSO hides
  //     built-ins — admins who disable the feature don't want any
  //     personas surfacing in pickers regardless of source, and the
  //     toggle's UI copy says "custom agents" because that's how the
  //     surface area is presented, not because built-ins are exempt.
  //
  //   - **Custom agents** (Firestore-backed) are fetched only when the
  //     team-wide `customAgents` gate is on. Disabled, archived, and
  //     deleted states are gated downstream by `resolveActiveAgent`.
  //
  // Concatenation order is built-ins first → custom agents after.
  // Order matters for the transfer roster (the model picks the FIRST
  // matching id when it has duplicates, though custom ids never collide
  // with the `_`-prefixed presets).
  const agentsEnabled = agentConfig.tools.customAgents
  const builtInAgents = agentsEnabled
    ? listBuiltInAgents(teamId, agentConfig.builtInAgents)
    : []
  const customAgents = agentsEnabled ? await listTeamAgents(teamId) : []
  const availableAgents: TeamAgentDoc[] = [...builtInAgents, ...customAgents]
  const activeAgent = resolveActiveAgent({
    requestedId: activeAgentId,
    sessionPersistedId: existingSession?.activeAgentId ?? null,
    availableAgents,
  })

  // What gets persisted on the doc this turn. Three cases:
  //   - undefined: client didn't send the field → leave the doc's
  //     prior value untouched (store skips the write). Critical for
  //     the "stale activeAgentId pointing at an archived agent" case:
  //     we silently dispatch the default persona this turn but keep
  //     the id on the doc so a future restore re-binds.
  //   - null: client explicitly cleared the agent → write null.
  //   - real id: write the resolved agent's id (or null when the id
  //     failed the active-agent lookup, e.g. archived between reads).
  const persistedActiveAgentId: string | null | undefined =
    activeAgentId === undefined
      ? undefined
      : activeAgent
        ? activeAgent.id
        : normalizeActiveAgentIdForStorage(activeAgentId)

  // Per-turn model: respect the client's pick when still allowed under
  // current toggles; otherwise fall back to the team's configured
  // default. The *effective* (post-clamp) value flows into both
  // `session.chat({ model })` and the SessionStore so the dispatched
  // model and the persisted `lastModel` field can't diverge.
  const effectiveModel = resolveEffectiveModel(opts.model, agentConfig)

  // Pinned-node key only flows in when creating a new session — the
  // store writes it once on `isNew` and never again, so dropping it on
  // resumed sessions keeps the invariant "pinnedNodeKey → exactly one
  // new session" crisp.
  const newSessionPinnedNodeKey =
    !sessionId && pinnedNode
      ? pinnedNodeKey(auth.uid, pinnedNode.scope, pinnedNode.nodeId)
      : undefined

  const store = new FirestoreBotSessionStore({
    teamId,
    workspaceId,
    ownerUid: auth.uid,
    titleMaxLength: agentConfig.titleMaxLength,
    previewMaxLength: agentConfig.previewMaxLength,
    pinnedNodeKey: newSessionPinnedNodeKey,
    contextNodes,
    turnMode: mode,
    turnModel: effectiveModel,
    senderUid: auth.uid,
    turnActiveAgentId: persistedActiveAgentId,
  })

  const session = sessionId
    ? await ai.loadSession(sessionId, { store })
    : ai.createSession({ store })

  // Resolve attached workspace nodes into a context block. Missing /
  // archived nodes are silently skipped so a stale chip doesn't fail
  // the turn. Capped upstream at `CONTEXT_NODE_MAX = 10`.
  // `loadAndBuildContextBlock` parallelizes the per-node Firestore +
  // Storage fetches.
  const contextBlock = await loadAndBuildContextBlock(
    teamId,
    workspaceId,
    contextNodes
  )

  // Transfer roster — other agents the active one can hand off to.
  // When a custom agent is active we include the team default
  // (`id: ""`) so the model has a way back to the generic assistant.
  // When no agent is active, only custom agents are eligible targets.
  const transferRoster = buildTransferRoster(activeAgent, availableAgents)

  // Custom tools — admin-authored Genkit tools. Gated by the team-wide
  // `customTools` feature flag. The list returned is every enabled +
  // non-archived doc; the tool factory rebuilds each one as a Genkit
  // tool every turn so admin schema changes propagate without a
  // deploy. Empty list when the feature is off OR the team has no
  // custom tools.
  const customTools = agentConfig.tools.customTools
    ? await listTeamCustomTools(teamId)
    : []
  const dispatchableCustomTools = customTools.filter(
    (tool) => tool.enabled && !tool.archivedAt
  )

  // Action context fed into `chat({ context })`. `availableTransferAgentIds`
  // is the runtime allowlist enforced by `transferToAgent`'s handler;
  // `requestedTransferAgentId` starts undefined and the handler writes
  // it on a successful transfer call. `effectiveModel` lets
  // promptTemplate custom tools fall back to the chat's current model
  // when no admin override is set.
  const actionContext: BotActionContext = {
    auth: { uid: auth.uid },
    mode,
    teamId,
    workspaceId,
    googleProviderEnabled:
      agentConfig.providers.google && isAiModelProviderConfigured("google"),
    availableTransferAgentIds:
      transferRoster.length > 0 ? transferRoster.map((r) => r.id) : undefined,
    effectiveModel,
  }

  // Tool catalog — `manual` mode strips action tools; per-team toggles
  // strip individual tools; the active agent layers ON TOP (a tool
  // fires only when both team AND agent allow it). `transferToAgent`
  // joins the catalog only when at least one other agent is reachable.
  // Custom tools are appended after the built-ins; each one rebuilds
  // its Genkit registration per-turn (admin schema changes apply
  // without a deploy).
  const chatTools = pickChatTools(
    agentConfig,
    mode,
    activeAgent,
    transferRoster.length
  )
  for (const tool of dispatchableCustomTools) {
    // Per-agent intersection — mirrors the built-in `agentAllows()`
    // pattern. Missing keys normalize to `true` (the `!== false`
    // check), so a custom tool the admin hasn't explicitly opted-
    // out of stays available to every agent automatically. Default
    // persona (`activeAgent === null`) always gets every tool.
    if (activeAgent && activeAgent.customTools[tool.id] === false) {
      continue
    }
    chatTools.push(buildCustomToolForChat(tool))
  }

  // System prompt is mode-aware, context-augmented, AND agent-aware.
  // When a custom agent is active, its `systemPromptBase + suffix`
  // REPLACES (not appends to) the team's default — keeps each persona
  // auditable end-to-end. When transfer targets exist, a directive
  // enumerating them is appended so the model knows which `agentId`
  // strings `transferToAgent` will accept.
  const baseSystem = buildAgentSystemPrompt({
    agent: activeAgent,
    teamBaseSystem: agentConfig.systemPromptBase,
    teamModeSuffix: agentConfig.promptSuffixes[mode],
    mode,
    otherAgents: transferRoster,
  })
  const systemPrompt = contextBlock
    ? `${baseSystem}\n\n${contextBlock}`
    : baseSystem

  const chat = session.chat({
    model: resolveModel(effectiveModel),
    system: systemPrompt,
    tools: chatTools,
    context: actionContext,
    config: {
      temperature: agentConfig.temperature,
      topP: agentConfig.topP,
      topK: agentConfig.topK,
      maxOutputTokens: agentConfig.maxOutputTokens,
    },
    // Middleware stack applied to every turn: logging captures token
    // usage; the budget gate trips before a runaway context window
    // reaches the provider; the redactor scrubs PII out of user parts
    // only (tool outputs and system prompt pass through unchanged).
    use: aiMiddlewares(),
  })

  return { chat, session, actionContext, existingSession, effectiveModel }
}

const sendBotMessageFlow = ai.defineFlow(
  {
    name: "sendBotMessage",
    inputSchema: SendBotMessageInput,
    outputSchema: SendBotMessageOutput,
    streamSchema: SendBotMessageStream,
  },
  async (input, { sendChunk, context }) => {
    const auth = context?.auth as AuthData | undefined
    if (!auth?.uid) {
      // Defense in depth — `authPolicy` should have already rejected this.
      throw new HttpsError("unauthenticated", "Sign-in required.")
    }

    const message = input.message.trim()
    if (!message) {
      throw new HttpsError("invalid-argument", "message cannot be empty.")
    }

    const { chat, session, actionContext, existingSession } =
      await prepareChatTurn({
        auth,
        teamId: input.teamId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId ?? null,
        mode: input.mode,
        contextNodes: input.contextNodes,
        activeAgentId: input.activeAgentId,
        model: input.model,
        pinnedNode: input.pinnedNode,
        requireExistingSession: false,
        archivedSessionMessage:
          "This chat is archived. Restore it before sending new messages.",
      })

    // Emit the session id before we touch the model. For brand-new sessions
    // this lets the client update the URL immediately; for resumed sessions
    // it's a redundant confirmation but harmless.
    sendChunk({ sessionId: session.id })

    // Pre-mark every historical tool-call/result ref so the post-stream
    // sweep doesn't re-emit them into the new turn's agent bubble. See
    // `collectPriorTurnToolRefs` for the why — empty arrays for a brand-
    // new session (no existingSession), so this is a no-op on first turns.
    const priorRefs = collectPriorTurnToolRefs(existingSession?.data)

    const final = await streamChatToClient(
      chat.sendStream(message) as ChatStreamResult,
      sendChunk,
      {
        preSentToolCalls: priorRefs.calls,
        preSentToolResults: priorRefs.results,
      }
    )

    // Post-turn: commit any cross-agent transfer the model requested
    // via `transferToAgent`. The in-turn `store.save()` already wrote
    // the pre-turn agent id; this follow-up merge updates the doc to
    // the new owner so the next user message routes correctly. Skipped
    // on partial turns (errors above this point throw before reaching
    // here, leaving the doc on the pre-turn agent — the safer fallback).
    await commitTransferIfRequested(
      input.teamId,
      input.workspaceId,
      session.id,
      actionContext
    )

    return {
      sessionId: session.id,
      reply: final.text,
    }
  }
)

export const sendBotMessage = onCallGenkit(
  {
    ...GENKIT_OPTS,
    secrets: [geminiApiKey, anthropicApiKey, openaiApiKey],
    authPolicy: (auth) => !!auth?.token?.email_verified,
    enforceAppCheck: true,
  },
  sendBotMessageFlow
)

// ===========================================================================
// respondToBotInterrupt — resume a paused (Human-in-the-Loop) chat with
// the user's answer to a previously-emitted `askQuestion` interrupt.
// ===========================================================================
//
// Flow:
//   1. Client receives a `toolCall` chunk with `isInterrupt: true` from
//      `sendBotMessage`. The chat is paused server-side; the SessionData
//      blob holds the unresolved `toolRequest` part.
//   2. User answers via the rendered form. Client invokes this callable
//      with the same (teamId, workspaceId, sessionId), the interrupt's
//      `ref` and `name`, plus the user's answer.
//   3. We re-load the session, find the matching `ToolRequestPart` by
//      ref/name in the latest model message, and call
//      `askQuestion.respond(part, answer)` to construct the response.
//   4. `chat.sendStream({ resume: { respond: [response] } })` re-enters
//      the model with the answer folded in. We stream chunks back using
//      the same protocol as `sendBotMessage` so the client can reuse all
//      of its existing chunk routing.
//
// The chat may interrupt again on the resumed turn (the model can chain
// askQuestion calls). The same callable handles that case — the client
// just renders another form when a new `toolCall` chunk with
// `isInterrupt` arrives.

const RespondToBotInterruptInput = z.object({
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  /**
   * The `ref` carried on the original interrupt's toolRequest part.
   * Optional because some models / older sessions may not have one;
   * when missing we fall back to a name-based match against the most
   * recent unresolved interrupt of the same name.
   */
  ref: z.string().optional(),
  name: z.string().min(1),
  /**
   * The user's answer. Shape must match the interrupt tool's
   * `outputSchema` — for `askQuestion` that's `{ answer: string }`.
   * We accept `unknown` here and let `askQuestion.respond()` validate
   * against the schema, surfacing a clean error to the client on
   * mismatch.
   */
  response: z.unknown(),
  /** Mode at the moment of response — drives system prompt + tool set. */
  mode: z.enum(BOT_CHAT_MODES).default("auto"),
  /**
   * Per-turn model override. Same semantics + allowlist clamp as
   * `SendBotMessageInput.model`. Forwarded so a user resuming an
   * interrupted chat doesn't snap back to the team default just
   * because the interrupt-response codepath went through a different
   * callable.
   */
  model: z.enum(BOT_AGENT_MODELS).optional(),
  /**
   * Same shape as `SendBotMessageInput.contextNodes` — passed through so
   * a chat that resumes from an interrupt keeps the attached files in
   * scope. Without this, the model would lose grounding the moment it
   * returned from a clarifying question.
   */
  contextNodes: z.array(NodeRefSchema).max(CONTEXT_NODE_MAX).default([]),
  /**
   * Carries the composer's currently-selected agent through the resume
   * path. When omitted the dispatcher falls back to the session's
   * persisted `activeAgentId` (the usual case — interrupts almost
   * always resolve under the same persona that asked the question).
   * Same shape + semantics as `SendBotMessageInput.activeAgentId`.
   */
  activeAgentId: z.string().nullable().optional(),
})

const RespondToBotInterruptOutput = z.object({
  sessionId: z.string(),
  reply: z.string(),
})

interface ToolRequestPartLike {
  toolRequest: ToolRequestLike
  metadata?: { interrupt?: unknown; [key: string]: unknown }
}

/**
 * Walk the session's main thread and return all pending interrupt
 * `toolRequest` parts — interrupts that the model has issued but the
 * application has not yet responded to.
 *
 * "Pending" means: a model-message `toolRequest` with `metadata.interrupt`
 * (or a name in our interrupt-tool catalog) for which no subsequent
 * `toolResponse` part with the same `ref` exists in the thread. We scan
 * the entire thread (not just the last message) for safety; in practice
 * pending interrupts only ever live on the latest model message.
 */
function findPendingInterruptParts(
  data: SessionData | undefined
): ToolRequestPartLike[] {
  if (!data?.threads) return []
  const thread = data.threads[MAIN_THREAD]
  if (!Array.isArray(thread)) return []

  const respondedRefs = new Set<string>()
  // Pre-pass: collect every ref that has a toolResponse — those are
  // resolved and shouldn't be re-emitted.
  for (const raw of thread as MessageLike[]) {
    const content = raw?.content
    if (!Array.isArray(content)) continue
    for (const part of content as PartLike[]) {
      if (part.toolResponse?.ref) respondedRefs.add(part.toolResponse.ref)
    }
  }

  const pending: ToolRequestPartLike[] = []
  for (const raw of thread as MessageLike[]) {
    if (raw?.role !== "model") continue
    const content = raw.content
    if (!Array.isArray(content)) continue
    for (const part of content as PartLike[]) {
      if (!part.toolRequest?.name) continue
      const isInterrupt =
        !!part.metadata?.interrupt ||
        INTERRUPT_TOOL_NAMES.has(part.toolRequest.name)
      if (!isInterrupt) continue
      if (part.toolRequest.ref && respondedRefs.has(part.toolRequest.ref)) {
        continue
      }
      // Cast — we just verified `toolRequest` exists.
      pending.push(part as ToolRequestPartLike)
    }
  }
  return pending
}

const respondToBotInterruptFlow = ai.defineFlow(
  {
    name: "respondToBotInterrupt",
    inputSchema: RespondToBotInterruptInput,
    outputSchema: RespondToBotInterruptOutput,
    streamSchema: SendBotMessageStream,
  },
  async (input, { sendChunk, context }) => {
    const auth = context?.auth as AuthData | undefined
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign-in required.")
    }

    const { ref, name, response } = input

    const { chat, session, actionContext, existingSession } =
      await prepareChatTurn({
        auth,
        teamId: input.teamId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        mode: input.mode,
        contextNodes: input.contextNodes,
        activeAgentId: input.activeAgentId,
        model: input.model,
        // No `pinnedNode` — interrupts always run on an existing session.
        requireExistingSession: true,
        archivedSessionMessage:
          "This chat is archived. Restore it before continuing.",
      })

    // `requireExistingSession: true` guarantees `existingSession` is
    // non-null below — the helper would have thrown otherwise. The
    // `existing.data` blob is where pending interrupts live.
    const existing = existingSession!

    // Find the interrupt part the user is responding to. We prefer
    // `ref` (Genkit's stable per-call id) and fall back to "most recent
    // pending of the same name" — handles older sessions or models that
    // don't emit refs.
    const pending = findPendingInterruptParts(existing.data)
    if (pending.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "There is no pending question to answer in this chat."
      )
    }
    const interruptPart =
      (ref &&
        pending.find(
          (p) => p.toolRequest.ref === ref && p.toolRequest.name === name
        )) ||
      [...pending].reverse().find((p) => p.toolRequest.name === name)
    if (!interruptPart) {
      throw new HttpsError(
        "failed-precondition",
        "Could not find the pending question this answer was for. " +
          "It may have been answered already."
      )
    }

    if (interruptPart.toolRequest.name !== "askQuestion") {
      // Future-proofing: if we add more interrupt tools, the dispatch
      // table belongs here. For now there's only one.
      throw new HttpsError(
        "failed-precondition",
        `Unsupported interrupt tool: ${interruptPart.toolRequest.name}`
      )
    }

    // Validate + construct the tool response. `askQuestion.respond` checks
    // the answer against `askQuestionOutputSchema` and throws on mismatch
    // — that surfaces as a 400 to the client.
    let respondPart
    try {
      respondPart = askQuestionTool.respond(
        // The respond() helper expects a ToolRequestPart. Our pending
        // collector returns the part shape Genkit emits.
        interruptPart as Parameters<typeof askQuestionTool.respond>[0],
        response as Parameters<typeof askQuestionTool.respond>[1]
      )
    } catch (error) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid answer for ${name}: ${(error as Error).message}`
      )
    }

    sendChunk({ sessionId: session.id })

    // First chunk to the client: flip the just-answered interrupt's
    // tool segment from "form" to "done" with the user's answer as the
    // output. Doing this preemptively (before the model's continuation
    // streams) keeps the UI responsive — the user sees their submission
    // land instantly, then the model's reply types in below.
    sendChunk({
      toolResult: {
        ref: interruptPart.toolRequest.ref,
        name: interruptPart.toolRequest.name,
        output: response,
      },
    })

    // Pre-mark every historical tool-call/result ref (same reasoning as
    // in `sendBotMessageFlow`: `final.messages` covers the full thread,
    // and without seeding we'd resurface prior turns' tool cards). Then
    // also pre-mark the just-answered interrupt's *toolResult* ref so
    // the sweep doesn't double-emit it — we already emitted it via the
    // pre-stream `sendChunk` above to make the form vanish instantly.
    // The interrupt's *toolCall* ref is naturally covered by the prior
    // sweep skip (it lives in the pre-turn thread).
    const priorRefs = collectPriorTurnToolRefs(existing.data)
    const preSentResults = interruptPart.toolRequest.ref
      ? [...priorRefs.results, `result:${interruptPart.toolRequest.ref}`]
      : priorRefs.results

    const final = await streamChatToClient(
      chat.sendStream({
        resume: { respond: [respondPart] },
      }) as ChatStreamResult,
      sendChunk,
      {
        preSentToolCalls: priorRefs.calls,
        preSentToolResults: preSentResults,
      }
    )

    // Post-turn cross-agent transfer commit, mirroring the same step
    // in `sendBotMessageFlow`. Skipped silently when the model didn't
    // call `transferToAgent`.
    await commitTransferIfRequested(
      input.teamId,
      input.workspaceId,
      session.id,
      actionContext
    )

    return {
      sessionId: session.id,
      reply: final.text,
    }
  }
)

export const respondToBotInterrupt = onCallGenkit(
  {
    ...GENKIT_OPTS,
    secrets: [geminiApiKey, anthropicApiKey, openaiApiKey],
    authPolicy: (auth) => !!auth?.token?.email_verified,
    enforceAppCheck: true,
  },
  respondToBotInterruptFlow
)

// ===========================================================================
// Session metadata callables (load, find-by-pinned-node, visibility,
// rename, archive, delete) live in `./botSessionCrud.js`. They share
// auth helpers + `readSessionDoc` + `pinnedNodeKey` with this file —
// kept there because they're a clean "session-doc-CRUD" surface separate
// from the chat-flow orchestration in this file.
// ===========================================================================

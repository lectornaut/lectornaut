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
 *   - shared:  any team member can read; the owner + any full member
 *              (owner/admin/member) can write — guests stay read-only.
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

import { cacheControl } from "@genkit-ai/anthropic"
import { FieldValue, Timestamp } from "firebase-admin/firestore"
import { onCallGenkit } from "firebase-functions/https"
import * as logger from "firebase-functions/logger"
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https"
import {
  z,
  type Part,
  type SessionData,
  type SessionStore,
  type ToolArgument,
} from "genkit/beta"
import {
  buildAgentSystemPrompt,
  DEFAULT_AGENT_ID,
  normalizeActiveAgentIdForStorage,
  resolveActiveAgent,
  WORKSPACE_SAFETY_DIRECTIVE,
} from "./agents.js"
import {
  BOT_AGENT_MODELS,
  loadTeamAgentConfig,
  PREVIEW_MAX_LENGTH,
  resolveEffectiveModel,
  TITLE_MAX_LENGTH,
  type BotAgentModel,
  type ChatToolName,
} from "./botAgentConfig.js"
import {
  askQuestionTool,
  BOT_CHAT_MODES,
  browseInternetTool,
  INTERRUPT_TOOL_NAMES,
  rollDiceTool,
  transferToAgentTool,
  type BotActionContext,
  type BotChatMode,
} from "./botBuiltinTools.js"
import { compareNodesTool } from "./botCompare.js"
import {
  CONTEXT_NODE_MAX,
  loadAndBuildContextBlock,
  NodeRefSchema,
  type NodeRef,
} from "./botContext.js"
import { findRelatedNodesTool } from "./botLink.js"
import {
  loadSessionAttachmentMediaParts,
  materializeSessionAttachments,
  type PendingSessionAttachmentInput,
} from "./botMedia.js"
import {
  NODE_READ_TOOLS,
  NODE_WRITE_TOOLS,
  type CapturedNodeChange,
} from "./botNodeTools.js"
import {
  buildAutoContextBlock,
  listWorkspaceNodesTool,
  searchWorkspaceNodesTool,
} from "./botRag.js"
import { summarizeNodeTool } from "./botSummarize.js"
import {
  buildTurnConfig,
  deliveryToSendArgs,
  getMissingToolName,
  isToolInputValidationError,
  isToolIterationsExceededError,
  type TurnDelivery,
} from "./botTurn.js"
import {
  DEFAULT_AGENT_DEFINITION,
  hydrateBuiltInAgent,
} from "./builtInAgents.js"
import type { BotChatRole, BotSessionVisibility } from "./domain.js"
import { db } from "./firebase.js"
import {
  ai,
  getModelProvider,
  isAiModelProviderConfigured,
  resolveModel,
} from "./genkitClient.js"
import { aiMiddlewares } from "./genkitMiddleware.js"
import {
  listDispatchable,
  listIntegrations,
  type AgentSpec,
  type ResolvedIntegration,
  type ToolSpec,
} from "./integrations.js"
import { can, Capabilities } from "./permissions.js"
import { GENKIT_OPTS } from "./runtimeConfig.js"
import { anthropicApiKey, geminiApiKey, openaiApiKey } from "./secrets.js"
import type { TeamAgentDoc } from "./teamAgents.js"
import {
  buildCustomToolForChat,
  type TeamCustomToolDoc,
} from "./teamCustomTools.js"
import type { IMembershipRole, WorkspaceNodeScope } from "./types.js"
import { assertWithinBudget, incrementTeamTokenUsage } from "./usageMetering.js"
import { generateId } from "./utilities.js"
import { resolveParticipation } from "./workspaceRoles.js"

// `AuthData` isn't re-exported from `firebase-functions/v2/https`, so derive
// it from `CallableRequest["auth"]` to avoid reaching into internal paths.
type AuthData = NonNullable<CallableRequest["auth"]>

/**
 * Who a chat turn runs as.
 *
 *   - `user`  — an interactive caller, built from the verified callable
 *               request auth (`sendBotMessage` / `respondToBotInterrupt`).
 *   - `agent` — a headless Workflows run, acting AS a team agent that is
 *               itself a Member-role team member. No human is in the loop;
 *               the agent's own membership role is the sole authority.
 *
 * `prepareChatTurn` resolves the acting role + node permissions from
 * whichever principal it's handed, so the same turn engine drives both the
 * interactive callables and the server-triggered Workflows worker.
 */
type TurnPrincipal =
  | { kind: "user"; uid: string }
  | { kind: "agent"; agentId: string }

/**
 * The id used for membership/role lookups, session ownership, audit + sender
 * stamping, and the node-tool action context — the caller's uid for a user
 * principal, the agent's id for an agent principal.
 */
function principalId(principal: TurnPrincipal): string {
  return principal.kind === "user" ? principal.uid : principal.agentId
}

/**
 * Resolve the membership role a turn acts under.
 *
 *   - user  → `getMembershipRole` (throws `permission-denied` when the caller
 *             isn't a team member — unchanged interactive behavior).
 *   - agent → `getMembershipRoleOrNull`; a missing membership is a hard
 *             `failed-precondition` (a Workflows agent MUST be added as a
 *             team member before it can run on team content).
 */
async function resolveActingRole(
  principal: TurnPrincipal,
  teamId: string
): Promise<IMembershipRole> {
  if (principal.kind === "user") {
    return getMembershipRole(teamId, principal.uid)
  }
  const role = await getMembershipRoleOrNull(teamId, principal.agentId)
  if (!role) {
    throw new HttpsError(
      "failed-precondition",
      "This workflow's agent is not a team member, so it can't act on team " +
        "content. Add it as a team member first."
    )
  }
  return role
}

export type SessionVisibility = BotSessionVisibility

const MAIN_THREAD = "main"
// TITLE_MAX_LENGTH and PREVIEW_MAX_LENGTH are imported from
// `./botAgentConfig.js` — they double as default truncation knobs for
// the SessionStore AND as the field-level defaults in
// `DEFAULT_BOT_AGENT_CONFIG`. Single source of truth lives there.

type ChatRole = BotChatRole

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
  /**
   * Model chain-of-thought, emitted as its own part by Gemini when
   * `thinkingConfig.includeThoughts` is on. We fold runs of these into
   * `<thinking>…</thinking>` so the chat renderer shows them collapsibly.
   */
  reasoning?: string
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

const THINKING_BLOCK_RE = /<thinking\b[^>]*>[\s\S]*?(?:<\/thinking\s*>\s*|$)/gi

function escapeThinkingMarkdown(text: string): string {
  return text.replace(/</g, "&lt;")
}

function stripThinkingBlocks(text: string): string {
  return text.replace(THINKING_BLOCK_RE, "").trim()
}

/**
 * Folds a model turn's `reasoning` parts into a single
 * `<thinking>…</thinking>` block so the chat surface's `BotThinkingBlock`
 * custom-tag renderer turns them into a collapsible disclosure. Gemini
 * (with `thinkingConfig.includeThoughts`) emits reasoning as its own
 * `{ reasoning }` parts, interleaved before the answer; this tracks the
 * open/close state so a contiguous run becomes one tag. `emit` is the
 * per-sink writer: a stream `chunk` payload (server→client) while live
 * streaming, or `appendText` into the persisted bubble during
 * reconstruction.
 */
function createThinkingFolder(emit: (text: string) => void) {
  let open = false
  return {
    /** Feed a `reasoning` part; opens the tag on the first non-empty run. */
    reasoning(text: string): void {
      if (!text) return
      if (!open) {
        emit("<thinking>")
        open = true
      }
      // Keep streamed model text from closing or nesting the wrapper tag.
      emit(escapeThinkingMarkdown(text))
    },
    /** Close the tag if open — call before any non-reasoning part and at end. */
    close(): void {
      if (!open) return
      emit("</thinking>\n\n")
      open = false
    },
  }
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
    const thinking = createThinkingFolder((text) => appendText(agent, text))
    for (const part of content) {
      // Gemini reasoning parts (thinkingConfig.includeThoughts) arrive
      // before the answer — fold a contiguous run into one <thinking>
      // block the chat surface renders as a collapsible disclosure.
      if (typeof part?.reasoning === "string" && part.reasoning) {
        thinking.reasoning(part.reasoning)
        continue
      }
      // Any non-reasoning part ends the reasoning run.
      thinking.close()
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
    // A turn that ended on reasoning (no trailing answer text) still
    // needs the tag closed so the disclosure renders.
    thinking.close()
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
  const source = stripThinkingBlocks(last?.content ?? "")
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
      const priorDoc = snap.data()
      const priorMessages = Array.isArray(priorDoc?.messages)
        ? (priorDoc.messages as ChatMessage[])
        : extractMessagesFromSessionData(
            priorDoc?.data as SessionData | undefined
          )
      const priorUserAuthors: (string | undefined)[] = []
      for (const m of priorMessages) {
        if (m?.role === "user") priorUserAuthors.push(m.authorUid)
      }
      let userIndex = 0
      for (const m of messages) {
        if (m.role !== "user") continue
        if (userIndex < priorUserAuthors.length) {
          const carried = priorUserAuthors[userIndex]
          if (carried) m.authorUid = carried
        } else {
          m.authorUid = this.senderUid
        }
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
      updatedAt: FieldValue.serverTimestamp(),
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
      update.createdAt = FieldValue.serverTimestamp()
      update.archivedAt = null
      if (this.pinnedNodeKey) {
        update.pinnedNodeKey = this.pinnedNodeKey
      }
    }

    await ref.set(update, { merge: true })
  }
}

// ===========================================================================
// Built-in tools live in `botBuiltinTools.ts` (rollDice, browseInternet,
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
  scope: WorkspaceNodeScope,
  nodeId: string
): string {
  return `${ownerUid}:${scope}:${nodeId}`
}

// ───────────────────────────────────────────────────────────────────────────
// Integration → dispatch-shape adapters.
//
// The unified `teams/{teamId}/integrations` collection is resolved by
// `integrations.ts` into `ResolvedIntegration`s (built-in specs overlaid from
// the code catalog). Dispatch still speaks the original per-kind shapes
// (`TeamAgentDoc` for the persona / transfer machinery, `TeamCustomToolDoc`
// for the Genkit tool factory), so we adapt at the boundary rather than
// rewriting every downstream consumer.
// ───────────────────────────────────────────────────────────────────────────

const ALL_AGENT_TOOLS_ENABLED: TeamAgentDoc["tools"] = {
  rollDice: true,
  browseInternet: true,
  askQuestion: true,
  searchWorkspaceNodes: true,
  listWorkspaceNodes: true,
  summarizeNode: true,
  compareNodes: true,
  findRelatedNodes: true,
  manageContent: true,
  readContent: true,
}

/** Hydrate an agent integration into the canonical `TeamAgentDoc`. */
function agentIntegrationToDoc(
  teamId: string,
  i: ResolvedIntegration
): TeamAgentDoc {
  const spec = (i.spec ?? null) as AgentSpec | null
  return {
    id: i.id,
    teamId,
    name: i.name,
    description: i.description,
    avatarSeed: i.avatarSeed,
    systemPromptBase: spec?.systemPromptBase ?? "",
    promptSuffixes: spec?.promptSuffixes ?? { auto: "", agent: "", manual: "" },
    tools: spec?.tools ?? { ...ALL_AGENT_TOOLS_ENABLED },
    customTools: spec?.customTools ?? {},
    enabled: i.enabled,
    archivedAt: i.archivedAt,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    createdByUid: i.createdByUid,
  }
}

/** Adapt a custom tool integration into the `TeamCustomToolDoc` the factory wants. */
function customToolIntegrationToDoc(
  teamId: string,
  i: ResolvedIntegration
): TeamCustomToolDoc {
  const spec = i.spec as ToolSpec
  return {
    id: i.id,
    teamId,
    name: spec.wireName,
    displayName: i.name,
    description: i.description,
    avatarSeed: i.avatarSeed,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    action: spec.action,
    enabled: i.enabled,
    archivedAt: i.archivedAt,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    createdByUid: i.createdByUid,
  }
}

/**
 * Pick which tools to register with the chat for a given config.
 *   - Tools are available in EVERY mode (auto / agent / manual). Mode
 *     affects prompt style only, not which tools the model can call.
 *   - Workspace-level toggles strip individual tools.
 *   - Interrupt tools (askQuestion) are gateable too — opt-in disable.
 *   - Per-agent toggles intersect with team toggles (both must allow).
 *   - `browseInternet` / `searchWorkspaceNodes` run on the server's
 *     Gemini key, independent of the team's chat-provider policy.
 */
function pickChatTools(
  // Wire-names of the built-in tools that are installed + enabled this turn
  // (resolved from the unified integrations collection in `prepareChatTurn`).
  enabledBuiltInTools: ReadonlySet<string>,
  agent: TeamAgentDoc | null = null,
  transferTargetCount: number = 0,
  // Headless Workflows runs pass `false`: an autonomous turn has no human to
  // answer an `askQuestion` interrupt, so the interrupt tool is withheld
  // rather than letting the run stall on a question nobody can resolve.
  allowInterrupts: boolean = true
) {
  // `browseInternet` and `searchWorkspaceNodes` both run on the server's
  // Gemini key — web-search grounding and workspace embeddings
  // respectively. Neither is tied to the team's `providers.google`
  // chat-provider toggle: a team chatting on Claude/GPT still gets both,
  // as long as the server has the Gemini secret configured.
  const googleSecretConfigured = isAiModelProviderConfigured("google")
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
  // A built-in tool fires when its integration is installed + enabled (the
  // unified `teams/{teamId}/integrations` collection, resolved upstream into
  // `enabledBuiltInTools`). Per-agent intersection (`agentAllows`) and the
  // per-tool special gates below still apply on top.
  const toolEnabled = (name: ChatToolName): boolean =>
    enabledBuiltInTools.has(name)
  // Typed as Genkit's `ToolArgument` union — accepts every flavor of
  // tool reference Genkit's `chat({ tools })` understands: strict
  // ToolAction (the built-in tools), MultipartToolAction (any
  // interrupt tool), or a string lookup. Custom tools synthesize
  // their schemas from admin-defined field lists at runtime so they
  // come back as a wider ZodObject; `ToolArgument` is the supertype
  // that lets the heterogeneous mix coexist without per-push casts.
  const tools: ToolArgument[] = []
  if (toolEnabled("rollDice") && agentAllows("rollDice"))
    tools.push(rollDiceTool)
  // Read-only retrieval — exposed in every mode (incl. `manual`), like
  // searchWorkspaceNodes. Gated on the server Gemini key, NOT
  // `config.providers.google`: web search is its own capability axis, so
  // a team that chats on Claude/GPT can still enable it.
  if (
    toolEnabled("browseInternet") &&
    googleSecretConfigured &&
    agentAllows("browseInternet")
  )
    tools.push(browseInternetTool)
  if (
    allowInterrupts &&
    toolEnabled("askQuestion") &&
    agentAllows("askQuestion")
  )
    tools.push(askQuestionTool)
  if (
    toolEnabled("searchWorkspaceNodes") &&
    googleSecretConfigured &&
    agentAllows("searchWorkspaceNodes")
  )
    tools.push(searchWorkspaceNodesTool)
  // `listWorkspaceNodes` enumerates the node tree (a directory listing the
  // model uses instead of abusing `searchWorkspaceNodes` with a wildcard). A
  // plain Firestore read — no embeddings — so NO Google-key gate, unlike
  // search; same as summarizeNode / compareNodes / findRelatedNodes.
  if (toolEnabled("listWorkspaceNodes") && agentAllows("listWorkspaceNodes"))
    tools.push(listWorkspaceNodesTool)
  if (toolEnabled("summarizeNode") && agentAllows("summarizeNode"))
    tools.push(summarizeNodeTool)
  // `compareNodes` is provider-agnostic — uses the team's selected chat
  // model (same as `summarizeNode`) and reads node bodies directly from
  // Firestore, so no embedder/Google-key dependency.
  if (toolEnabled("compareNodes") && agentAllows("compareNodes"))
    tools.push(compareNodesTool)
  // `findRelatedNodes` reuses each node's pre-computed embedding (stored
  // by the embed-on-write triggers in `botRag.ts`) as the query vector,
  // so it never calls the embedder at lookup time. No Gemini-key gate
  // here — the source embedding already exists on disk; the query is
  // pure Firestore vector search.
  if (toolEnabled("findRelatedNodes") && agentAllows("findRelatedNodes"))
    tools.push(findRelatedNodesTool)
  // `transferToAgent` is only exposed when at least one OTHER agent
  // (or the team default, when an agent is currently active) is
  // reachable. Listing the tool with no available targets would
  // tempt the model into calls it can't actually satisfy. Mode and
  // agent-tool toggles deliberately don't gate this — transfer is a
  // meta-action, not a domain action like `rollDice`, and even
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
  // Synthetic "back to default" target — id is the empty string so
  // `normalizeActiveAgentIdForStorage` translates it to `null` on the doc
  // write below. Hardcoded English label/description here because the
  // directive lives in the system prompt (server-side, not user-facing
  // i18n). Skipped when the Default agent is ITSELF the active persona
  // (e.g. a headless workflow run as `_default`) — transferring to default
  // would be a no-op self-handoff.
  if (activeAgent && activeAgent.id !== DEFAULT_AGENT_ID) {
    roster.push({
      id: "",
      name: "Default Assistant",
      description: "The team's default persona — broad-purpose helper.",
    })
  }
  return roster
}

/**
 * Safety-net write that commits the model's `transferToAgent` request
 * (if any) to the session doc when the in-line second turn couldn't.
 *
 * The normal path is `runTransferTurnIfRequested`: it runs a second
 * Genkit chat turn under the target agent and that turn's own
 * `SessionStore.save` writes the new `activeAgentId` as part of the
 * usual save. This helper is the fallback for the abnormal path —
 * if the second turn throws before reaching its save (e.g. target
 * agent disappeared mid-request, model deadline hit on the handoff),
 * we still want the next user message to route to the agent the
 * model picked, so we write it directly here.
 *
 * No-op when the model didn't call `transferToAgent`. Idempotent
 * with the second-turn save — same field, same value — so calling it
 * unconditionally after the second turn is harmless.
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
  const requested = actionContext.transferRequest?.agentId
  if (requested === undefined) return
  const nextAgentId = normalizeActiveAgentIdForStorage(requested)
  await db
    .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
    .set(
      {
        activeAgentId: nextAgentId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
}

/**
 * If the just-completed turn requested a cross-agent handoff via
 * `transferToAgent`, drive a SECOND chat turn under the target agent
 * inside the same HTTP request so the user's message gets answered
 * without a manual re-send.
 *
 * How the new agent sees the user's message:
 *   - Genkit's `chat.send` for the first turn appended the user
 *     message AND the original agent's response (with the tool call
 *     + tool response) to the thread, then awaited `store.save`.
 *   - Before the second turn we TRUNCATE the thread back to the
 *     pre-turn baseline + the user's just-sent message. The new
 *     agent then sees only what the user typed, with no residue from
 *     the original agent's "transferring…" reply or the tool call
 *     plumbing. This matters for two reasons:
 *
 *     1. **Provider compliance**: OpenAI/Anthropic chat APIs want
 *        the thread to end on a `user` turn before they generate.
 *        Leaving the original agent's `model`/`tool` messages at the
 *        end causes some providers to return empty content — the
 *        symptom is the second turn silently producing no chunks
 *        and the user seeing only the first agent's reply, with
 *        nothing else streaming in.
 *
 *     2. **Persisted-history hygiene**: the persisted thread becomes
 *        `[…prior, user, new-agent-response]` — a clean handoff
 *        record. A user re-opening the chat sees the new agent
 *        answering their question directly, not a confusing trail
 *        of intermediate "transferring you" text from a persona
 *        that no longer drives the conversation.
 *
 *   - `prepareChatTurn` on the same `sessionId` calls `ai.loadSession`
 *     AFTER the truncation, so the fresh Session it constructs picks
 *     up the truncated thread for its `Chat`.
 *   - We call `chat.sendStream(...)` with NO `prompt`. Generate then
 *     runs on the (truncated) thread alone — single user message at
 *     the tail, ready for an assistant reply.
 *
 * Streaming bridges naturally: both turns push through the SAME
 * `sendChunk`, so the client's open `sendBotMessage.stream` sees
 * tool-call chunks for the transfer, then text chunks from the new
 * agent — all appended into the same agent message bubble. No
 * special client-side framing required.
 *
 * Recursion bound: `disableTransfer: true` strips `transferToAgent`
 * from the target agent's tool catalog and replaces the transfer
 * directive with the "no targets" guard. One hop max — chains of
 * handoffs would be confusing and risk exhausting `TURN_DEADLINE_MS`.
 *
 * Returns the post-handoff response. When no transfer was requested
 * the first turn's response is returned unchanged, so callers can
 * use the return value uniformly as "the response the user sees."
 */
async function runTransferTurnIfRequested(opts: {
  firstFinal: Awaited<ChatStreamResult["response"]>
  /**
   * The Genkit session driving the first turn. Used here only to
   * call `updateMessages` for the thread truncation — passing the
   * already-loaded session avoids re-reading the doc just to mutate
   * the threads field.
   */
  firstSession: Awaited<ReturnType<typeof ai.loadSession>>
  /**
   * Length of the thread BEFORE the first turn ran. For new sessions
   * this is 0; for resumes it's the previously-saved message count.
   * The truncation keeps `[0 .. preTurnThreadLength)` (the prior
   * conversation) + the user message at index `preTurnThreadLength`.
   */
  preTurnThreadLength: number
  firstActionContext: BotActionContext
  principal: TurnPrincipal
  teamId: string
  workspaceId: string
  sessionId: string
  mode: BotChatMode
  contextNodes: NodeRef[]
  model: BotAgentModel | undefined
  /**
   * Forwarded so the handed-off turn captures, meters, and scope-restricts
   * exactly like the first turn. All undefined for interactive chat (the
   * second turn behaves as before); the Workflows worker sets them so a
   * transferred run stages its changeset into the SAME sink, accumulates the
   * SAME per-run usage, honors `targetScope`, and withholds interrupts.
   */
  captureChanges?: { sink: CapturedNodeChange[]; captureOnly: boolean }
  onUsage?: (u: {
    model: string
    inputTokens: number
    outputTokens: number
  }) => void
  targetScope?: WorkspaceNodeScope | null
  allowInterrupts?: boolean
  /**
   * Marks a headless (Workflows) run — no human, throwaway session per run.
   * Flips the transfer-failure handling from the interactive soft fallback
   * ("send your message again…", which a workflow can't act on) to:
   * retry the handoff once when safe, then THROW — so the worker records a
   * visible `error` instead of a misleading `success`.
   */
  headless?: boolean
  archivedSessionMessage: string
  sendChunk: (chunk: SendBotMessageStreamPayload) => void
}): Promise<Awaited<ChatStreamResult["response"]>> {
  const requested = opts.firstActionContext.transferRequest?.agentId
  if (requested === undefined) return opts.firstFinal

  // The first turn's `firstFinal.messages` is the canonical post-turn
  // thread (Genkit's `chat.send` returns it after `updateMessages`). A
  // real turn always carries at least the prior conversation, the user
  // message, AND the agent's reply, so its length exceeds
  // `preTurnThreadLength + 1`. When it doesn't, the first turn ended in
  // one of `streamChatToClient`'s stub fallbacks — deadline timeout,
  // tool-iteration cap, missing tool, or invalid tool argument — all of
  // which return `{ messages: [] }`.
  //
  // A stub means two things, and BOTH say "don't run a second turn":
  //   1. There's nothing to hand off — the first turn produced no real
  //      reply, only the fallback the user/run already saw.
  //   2. The session may never have been persisted. Genkit saves only
  //      when `generate` resolves (`Chat.send` → `updateMessages` →
  //      `store.save`); a stub means it rejected/was abandoned, so a
  //      FRESH headless session (the Workflows worker always starts one)
  //      has no `botSessions` doc at all. Proceeding would call
  //      `prepareChatTurn({ requireExistingSession: true })` on a
  //      missing session and throw `not-found` ("Session not found.") —
  //      an `HttpsError` the catch below re-throws, crashing the run.
  //
  // So bail out with the first turn's fallback. The agent-id commit still
  // lands in the caller's `finally` (`commitTransferIfRequested`), so a
  // resumed chat's next message still routes to the requested agent.
  const fullThread = opts.firstFinal.messages
  if (
    !Array.isArray(fullThread) ||
    fullThread.length <= opts.preTurnThreadLength + 1
  ) {
    return opts.firstFinal
  }

  // Truncate the thread back to "pre-turn + the user message" — slice off
  // everything the first agent appended at indices `preTurnThreadLength +
  // 1` onward. This `updateMessages` doubles as the guarantee that the
  // session is persisted before the second turn's `prepareChatTurn`
  // reloads it.
  const truncated = fullThread.slice(0, opts.preTurnThreadLength + 1)
  // Cast — `MessageLike` (this codebase's shape) is structurally a subset
  // of Genkit's `MessageData`. `updateMessages` accepts both Message
  // instances and raw `MessageData` (it normalizes via `m.toJSON ?
  // m.toJSON() : m`), so the cast is safe.
  await opts.firstSession.updateMessages(
    MAIN_THREAD,
    truncated as Parameters<typeof opts.firstSession.updateMessages>[1]
  )

  const targetAgentId = normalizeActiveAgentIdForStorage(requested)

  // The second turn as ONE retryable attempt: re-prepare the chat as the
  // target agent (reloading the truncated thread) and stream its reply. A
  // failed attempt persists nothing — Genkit's `chat.send` saves only once
  // `generate` resolves — so the thread stays truncated and a retry re-runs
  // from the same clean base.
  const attemptSecondTurn = async (): Promise<
    Awaited<ChatStreamResult["response"]>
  > => {
    const transferPrep = await prepareChatTurn({
      principal: opts.principal,
      teamId: opts.teamId,
      workspaceId: opts.workspaceId,
      sessionId: opts.sessionId,
      mode: opts.mode,
      contextNodes: opts.contextNodes,
      activeAgentId: targetAgentId,
      model: opts.model,
      // Inherit the run's capture/metering/scope so a transferred Workflows
      // turn stages its edits into the same changeset, accumulates into the
      // same per-run usage, and stays inside `targetScope`. Undefined for
      // interactive chat, so its second turn is unchanged.
      captureChanges: opts.captureChanges,
      onUsage: opts.onUsage,
      targetScope: opts.targetScope,
      allowInterrupts: opts.allowInterrupts,
      // Pin is a one-shot at session creation; the first turn already
      // wrote it (or we're resuming, in which case it was written ages
      // ago). Passing it again would be a no-op at best and a doc
      // duplicate-key check at worst — leave it undefined.
      pinnedNode: undefined,
      requireExistingSession: true,
      archivedSessionMessage: opts.archivedSessionMessage,
      disableTransfer: true,
    })

    // Fresh ref-dedupe baseline. The truncated thread no longer
    // includes the original agent's tool refs — but `collectPriorTurnToolRefs`
    // is still the right primitive here: it reads from the session
    // doc's persisted state (which mirrors the post-truncation thread),
    // so the sweep correctly skips any prior-conversation tool refs
    // while emitting any new tool calls the second agent makes.
    const priorRefs = collectPriorTurnToolRefs(
      transferPrep.existingSession?.data
    )

    // Delivery `{ kind: "continue" }` re-enters the truncated thread with NO
    // prompt — Genkit generates on the tail user message alone, which is the
    // whole point of the transfer second turn. `runChatTurn` owns the abort
    // controller + `maxTurns` + deadline race.
    return await runChatTurn(
      transferPrep.chat,
      { kind: "continue" },
      {
        sendChunk: opts.sendChunk,
        preSentToolCalls: priorRefs.calls,
        preSentToolResults: priorRefs.results,
        preExistingToolCallCount: priorRefs.callCount,
        preExistingToolResultCount: priorRefs.resultCount,
      }
    )
  }

  // A failed attempt may have captured partial changes into a `require_review`
  // run's changeset; rewind to this baseline before a retry or terminal
  // failure so they can't double-stage. Length-truncation is enough — the sink
  // is append-only within a turn.
  const sinkBaseline = opts.captureChanges?.sink.length ?? 0
  const resetSink = () => {
    if (opts.captureChanges) opts.captureChanges.sink.length = sinkBaseline
  }

  // Retry the handoff once — but ONLY for a headless run whose edits are merely
  // staged (`captureOnly` ⇒ require_review). In `automatic` mode the second
  // turn's tools already wrote to Firestore live, so re-running would
  // double-apply (e.g. append the footer twice); there we take the single
  // attempt and fail through. Interactive chat never retries — it streams the
  // soft fallback and the human simply resends.
  const canRetry =
    opts.headless === true && opts.captureChanges?.captureOnly === true
  const maxAttempts = canRetry ? 2 : 1

  // Drive the attempt(s) under a fallback shell so a failure is handled here
  // rather than escaping as `INTERNAL` through `onCallGenkit`.
  // `streamChatToClient` already converts its own recoverable cases
  // (`TurnTimeoutError`, tool-iteration exhaustion) into fallback chunks; this
  // is the net for everything else — provider rate limits, network blips, the
  // 120s function budget squeezed by a long first turn, the target model going
  // unavailable mid-request, etc.
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await attemptSecondTurn()
    } catch (err) {
      // Actionable HttpsErrors (except `not-found`) carry a precise message
      // (permission-denied, archived, …) the client's toast surfaces
      // faithfully — propagate them untouched: no retry, no fallback.
      //
      // A `not-found` here is `prepareChatTurn` failing to load the session for
      // the second turn ("Session not found."). It is NEVER actionable: it can
      // only arise when the first turn never persisted the session (Genkit's
      // `createSession` is lazy and `chat.send` saves only once `generate`
      // resolves, so an aborted/stubbed first turn on a FRESH headless session
      // leaves no `botSessions` doc; the stub guard at the top of this function
      // already short-circuits the derivable case). It would fail identically
      // on a retry, so it's recoverable-but-not-retriable — fall through to the
      // terminal handling below.
      if (err instanceof HttpsError && err.code !== "not-found") throw err
      lastErr = err
      resetSink()
      const retriable = !(err instanceof HttpsError)
      if (attempt < maxAttempts && retriable) {
        logger.warn(
          `[runTransferTurnIfRequested] second-turn attempt ${attempt} failed, retrying team=${opts.teamId} session=${opts.sessionId} target=${targetAgentId ?? "(default)"}`,
          { err: String(err) }
        )
        continue
      }
      break
    }
  }

  // Every attempt failed. Restore the first turn's full thread so the persisted
  // state matches what streamed by — without this the truncation leaves disk at
  // `[…prior, user]`, and re-opening renders just the user's bubble with no
  // agent reply even though they watched the "transferring you to X" text
  // stream in. Best-effort: a restore failure is logged and swallowed. Skip a
  // stub (`messages: []` from the inner turn's own timeout/iteration fallback)
  // — re-saving empty would clobber the truncated thread with nothing.
  logger.warn(
    `[runTransferTurnIfRequested] second-turn failed team=${opts.teamId} session=${opts.sessionId} target=${targetAgentId ?? "(default)"}`,
    { err: String(lastErr) }
  )
  if (
    Array.isArray(opts.firstFinal.messages) &&
    opts.firstFinal.messages.length > 0
  ) {
    try {
      await opts.firstSession.updateMessages(
        MAIN_THREAD,
        opts.firstFinal.messages as Parameters<
          typeof opts.firstSession.updateMessages
        >[1]
      )
    } catch (restoreErr) {
      logger.warn(
        `[runTransferTurnIfRequested] thread restore failed team=${opts.teamId} session=${opts.sessionId}`,
        { err: String(restoreErr) }
      )
    }
  }

  // Headless (Workflows) run: there is no human to "send again" and each run
  // uses a throwaway session, so the interactive soft fallback would land the
  // run as `success` carrying a chat-oriented message while the specialist's
  // work never happened. Throw instead so the worker records a real, visible
  // `error` (an admin can re-trigger the workflow). The agent-id commit in the
  // caller's `finally` is harmless on the throwaway session.
  if (opts.headless === true) {
    const cause = lastErr instanceof Error ? lastErr.message : String(lastErr)
    throw new Error(
      `Handoff to ${targetAgentId ?? "the requested agent"} failed: ` +
        `the agent could not reply (${cause}).`
    )
  }

  // Interactive chat: keep the soft fallback. The first turn's "transferring
  // you to X" bubble stays, the agent badge stays flipped (commit in the
  // caller's `finally`), and the user's next message routes to the new agent —
  // rethrowing instead would collapse the optimistic UI
  // ([useBotChat.sendMessage] splices the in-flight bubble pair out on any
  // caught error).
  const fallback =
    "Handed off to the new agent, but they couldn't reply just now. " +
    "Try sending your message again — your next message will route to them."
  opts.sendChunk({ chunk: fallback })
  return {
    text: fallback,
    messages: opts.firstFinal.messages ?? [],
  } as unknown as Awaited<ChatStreamResult["response"]>
}

// ===========================================================================
// Per-session turn lock — serializes concurrent turns on one session
// ===========================================================================

/**
 * Lease duration for a per-session turn lock. Must cover the worst-case
 * turn so the lock can't expire mid-turn and let a second writer in: a turn
 * is bounded by `TURN_DEADLINE_MS` (90s) and the Cloud Function by
 * `GENKIT_OPTS.timeoutSeconds` (120s). We lease for the function timeout —
 * if the instance is hard-killed mid-turn (so the caller's `finally` never
 * runs), the lock self-expires after this window and the chat is usable
 * again instead of being wedged forever.
 */
const SESSION_LOCK_LEASE_MS = 120_000

/** Releases a previously-acquired session turn lock. Idempotent + safe to
 *  call unconditionally — the no-op variant is returned for new sessions. */
type ReleaseLock = () => Promise<void>
const NOOP_RELEASE: ReleaseLock = async () => {}

/**
 * Acquire an exclusive per-session turn lock so two concurrent turns on the
 * same session can't both read the thread, append, and save — Genkit's
 * `SessionStore` is last-write-wins with no version guard, so without this a
 * simultaneous send (common in shared chats where several admins post into
 * one session) silently drops one side's message + reply.
 *
 * Stored as a dedicated lease doc (NOT a field on the session doc) so it
 * neither churns the client's real-time session listeners nor has to ride
 * through the client read schema. Clients can't touch it — writes are
 * Cloud-Functions-only and the collection falls under Firestore's
 * default-deny rule.
 *
 * Transactional + lease-based: acquisition fails fast with an `aborted`
 * HttpsError when an unexpired lock is held (the second sender is told to
 * wait rather than losing their turn), and the lease bounds how long a
 * crashed instance can wedge the chat. The returned release only clears the
 * lock when our token still owns it, so a turn that overran its lease can't
 * delete a later turn's freshly-acquired lock.
 *
 * MUST be acquired before the thread is read (`ai.loadSession` inside
 * `prepareChatTurn`): acquiring after the read would leave a window where
 * another turn completes between our read and our acquire, handing us a
 * stale base we'd then clobber on save.
 */
async function acquireSessionTurnLock(
  teamId: string,
  workspaceId: string,
  sessionId: string
): Promise<ReleaseLock> {
  const ref = db.doc(
    `teams/${teamId}/workspaces/${workspaceId}/botSessionLocks/${sessionId}`
  )
  const token = generateId()
  const now = Date.now()
  const expiresAt = Timestamp.fromMillis(now + SESSION_LOCK_LEASE_MS)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const existingExpiry = snap.exists
      ? (snap.get("expiresAt") as Timestamp | undefined)
      : undefined
    if (existingExpiry && existingExpiry.toMillis() > now) {
      throw new HttpsError(
        "aborted",
        "This chat is already processing a message. Wait for the current " +
          "reply to finish, then try again."
      )
    }
    tx.set(ref, {
      token,
      expiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    })
  })

  return async () => {
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        // Only the owner clears the lock — if our lease already expired and
        // a later turn re-acquired, its token differs and we leave it be.
        if (snap.exists && snap.get("token") === token) {
          tx.delete(ref)
        }
      })
    } catch (err) {
      // Release failure is non-fatal: the lease guarantees the lock clears
      // on its own. Log so a persistent failure is visible.
      logger.warn(
        `[botSessionLock] release failed team=${teamId} workspace=${workspaceId} session=${sessionId}`,
        { err: String(err) }
      )
    }
  }
}

// ===========================================================================
// Auth helpers
// ===========================================================================

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
  const role = snap.data()?.role as IMembershipRole
  return role
}

/**
 * Like `getMembershipRole` but returns null instead of throwing when the
 * principal (user OR agent) isn't a team member. Used to resolve an agent's
 * membership role for the node-tool authorization gate, where "not a
 * member" is a normal (no write tools) outcome rather than an error.
 */
export async function getMembershipRoleOrNull(
  teamId: string,
  principalId: string
): Promise<IMembershipRole | null> {
  // The Default agent (`_default`) is an implicit, always-present team
  // member with full content capabilities — it has no membership doc and
  // needs none. Resolving it to `member` here powers BOTH the acting-role
  // gate (`resolveActingRole`) and the node-permission gate (which reads
  // the active agent's role), so a headless workflow running as the Default
  // agent can read + edit content without an enrollment write.
  if (principalId === DEFAULT_AGENT_ID) return "member"
  const snap = await db.doc(`teams/${teamId}/memberships/${principalId}`).get()
  if (!snap.exists) return null
  const role = (snap.data()?.role as IMembershipRole | undefined) ?? null
  return role
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
   * Chat-session attachment ids the user selected to include as media on THIS
   * turn (per-turn selectable in the composer). Resolved server-side to base64
   * media parts via `loadSessionAttachmentMediaParts`. Empty/absent on a
   * brand-new session (nothing uploaded yet).
   */
  attachmentIds: z.array(z.string().min(1)).max(6).default([]),
  /**
   * Files the client uploaded to Storage for THIS turn whose metadata docs
   * don't exist yet — the brand-new-chat single-send path. The client mints
   * the `sessionId` above, uploads each blob to `botSessions/{sessionId}/…`
   * (Storage permits this without the session doc), and passes the refs here.
   * The server validates each `storagePath`, re-reads the authoritative
   * content-type/size, writes the attachment doc, and folds the resulting ids
   * into the media-loading step — so the very first message can carry uploads
   * without a pre-existing session. Requires MANAGE_WORKSPACE_CONTENT (mirrors
   * `createBotSessionAttachment`). Existing-session uploads use the
   * `createBotSessionAttachment` callable + `attachmentIds` instead.
   */
  pendingAttachments: z
    .array(
      z.object({
        attachmentId: z.string().min(1),
        storagePath: z.string().min(1),
        displayName: z.string().min(1),
        originalName: z.string().min(1),
      })
    )
    .max(6)
    .default([]),
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
 * The counts are returned too so live-stream fallback keys can continue
 * from the pre-turn sequence instead of colliding with a historical
 * ref-less tool event that happened to share the same name.
 */
function collectPriorTurnToolRefs(data: SessionData | undefined): {
  calls: string[]
  results: string[]
  callCount: number
  resultCount: number
} {
  const calls: string[] = []
  const results: string[] = []
  if (!data?.threads) return { calls, results, callCount: 0, resultCount: 0 }
  const thread = data.threads[MAIN_THREAD]
  if (!Array.isArray(thread)) {
    return { calls, results, callCount: 0, resultCount: 0 }
  }
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
  return { calls, results, callCount: callSeq, resultCount: resultSeq }
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
 *   - `preExistingTool*Count` seeds the no-ref fallback sequence for
 *     live chunks. Without the offset, a ref-less current-turn call like
 *     `rollDice#0` could collide with an older ref-less `rollDice#0`
 *     that was intentionally pre-marked as already sent.
 *
 * Returns the resolved final response so the caller can use
 * `final.text` for the unary reply.
 */

/**
 * Per-turn hard deadline. The provider call (Gemini / Claude / OpenAI)
 * can hang indefinitely on a bad day — flaky network, provider
 * incident, model that gets stuck mid-thought. Without a deadline the
 * Cloud Function consumes its whole `timeoutSeconds` (`GENKIT_OPTS` =
 * 120s) before returning anything to the client, who sees a generic
 * INTERNAL error long after the user moved on.
 *
 * 90s is generous for normal turns (most complete inside ~10s) and
 * tight enough to fail fast on hung providers. Teams paying for
 * top-tier models occasionally hit ~60s legitimately during heavy
 * tool chains, so we leave headroom. MUST stay below
 * `GENKIT_OPTS.timeoutSeconds` so this deadline (and its graceful
 * fallback) wins the race against the Cloud Functions hard-kill.
 *
 * On expiry we abort the provider call via the turn's `AbortController`
 * (Genkit forwards the signal into the model SDK's fetch — verified for
 * the Anthropic/Google runners), so the model actually STOPS computing
 * rather than finishing in the background and wasting tokens/quota. The
 * user gets a graceful fallback chunk instead of a 120s hang.
 */
const TURN_DEADLINE_MS = 90_000

/**
 * Tool-call iteration budget for a single chat turn (Genkit's `maxTurns`).
 * Genkit defaults to 5; we raise it because this bot's agents legitimately
 * chain tools — e.g. `searchWorkspaceNodes` to locate a node, then
 * `summarizeNode` on the match, plus the occasional `browseInternet` /
 * `askQuestion` / `transferToAgent` — and 5 is easy to exhaust, tripping
 * the "maximum tool call iterations" abort (handled gracefully below, but
 * a premature give-up the user feels as "it stopped halfway"). 8 covers
 * realistic chains while still bounding runaway tool loops (and the
 * per-turn token budget + wall-clock deadline remain the hard backstops).
 */
const TOOL_MAX_TURNS = 8

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
    preExistingToolCallCount?: number
    preExistingToolResultCount?: number
    /**
     * The turn's AbortController, whose `signal` was passed into
     * `chat.sendStream(...)`. On deadline expiry we `.abort()` it so the
     * underlying provider request is actually cancelled (Genkit forwards
     * the signal to the model SDK's fetch) instead of finishing in the
     * background. Optional so non-deadline-sensitive callers can omit it.
     */
    abortController?: AbortController
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
  // answer and the function can return cleanly. Late chunks from the
  // still-draining stream are ignored by the guarded sender below. The
  // wasted compute is the price of not hanging the whole Cloud Function.
  let timer: NodeJS.Timeout | undefined
  let timedOut = false
  const guardedSendChunk = (chunk: SendBotMessageStreamPayload) => {
    if (!timedOut) sendChunk(chunk)
  }
  try {
    return await Promise.race([
      streamChatToClientInner(result, guardedSendChunk, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          // Cancel the in-flight provider call so it stops burning tokens
          // the instant we give up on it. Genkit relays this signal down to
          // the model SDK's fetch; the now-rejecting inner stream is a
          // settled loser of the race, so its rejection is already handled
          // and won't surface as an unhandledRejection.
          options.abortController?.abort()
          reject(new TurnTimeoutError())
        }, TURN_DEADLINE_MS)
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
    preExistingToolCallCount?: number
    preExistingToolResultCount?: number
  } = {}
): Promise<Awaited<ChatStreamResult["response"]>> {
  const sentToolCalls = new Set<string>(options.preSentToolCalls ?? [])
  const sentToolResults = new Set<string>(options.preSentToolResults ?? [])
  const refKey = (
    part: ToolRequestLike | ToolResponseLike,
    kind: "call" | "result",
    seq: number
  ): string => `${kind}:${part.ref ?? `${part.name}#${seq}`}`

  let liveCallSeq = options.preExistingToolCallCount ?? 0
  let liveResultSeq = options.preExistingToolResultCount ?? 0
  const thinking = createThinkingFolder((text) => sendChunk({ chunk: text }))

  // A turn that ends abnormally rejects with a `GenkitError` on BOTH the
  // streamed chunk channel AND `result.response` — Genkit's `generateStream`
  // mirrors the generate rejection onto the channel (`channel.error(err)`),
  // and the channel throws the instant that's set, so the `for await` below
  // surfaces the error FIRST, before `await result.response` is reached. The
  // recovery therefore has to wrap the whole stream loop: guarding only
  // `result.response` was dead code for streamed turns, letting the reject
  // escape to `onCallGenkit` (wrapped as the opaque `INTERNAL` the chat sees)
  // and crash a headless Workflows run with a cryptic `ABORTED: …`. Three
  // cases are recoverable — `ABORTED` (model exhausted its `maxTurns` tool-call
  // budget without a final text), `NOT_FOUND` (model called a tool not
  // registered this turn, e.g. an agent switch dropped it), and
  // `INVALID_ARGUMENT` (model called a tool with args that fail its input
  // schema — Genkit rejects pre-handler). All convert into a user-visible
  // reply on the same stream so the turn ends gracefully instead of vanishing.
  let final: Awaited<ChatStreamResult["response"]>
  try {
    for await (const chunk of result.stream) {
      // Iterate parts directly — `chunk.text` collapses text parts and
      // hides tool requests/responses. Only the parts walk gives us
      // structured access to the tool round-trip.
      const parts = chunk.content ?? []
      for (const part of parts) {
        // Gemini reasoning deltas (thinkingConfig.includeThoughts) stream
        // before the answer — fold a contiguous run into one <thinking>
        // block the chat surface renders as a collapsible disclosure.
        if (typeof part.reasoning === "string" && part.reasoning) {
          thinking.reasoning(part.reasoning)
          continue
        }
        // Any non-reasoning part ends the reasoning run.
        thinking.close()
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

    // Close a reasoning run the model didn't follow with any answer text.
    thinking.close()
    final = await result.response
  } catch (err) {
    // Close any reasoning fold the abort interrupted mid-run, so the
    // fallback below isn't swallowed into a never-closed <thinking> block.
    thinking.close()
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
    const missingTool = getMissingToolName(err)
    if (missingTool) {
      // Most common trigger: an earlier turn ran under an agent with
      // more tools (e.g. node CRUD) and recorded successful calls in
      // the thread; the current turn runs under a different agent
      // (commonly the default persona after the composer's selection
      // was cleared while an interrupt was pending), so the model's
      // continuation tries to call a tool that's no longer registered.
      // The fallback nudges the user toward the two fixes that actually
      // work — retry under the original agent, or rephrase so the model
      // doesn't reach for the missing capability.
      logger.warn(
        `[streamChatToClient] missing tool '${missingTool}' on resume — likely an agent-switch dropped it from the catalog`,
        { err: String(err) }
      )
      const fallback = `I tried to use the \`${missingTool}\` tool, but it isn't available in this chat right now — the active agent may not have access to it, or it was disabled since earlier in this conversation. Try switching back to the agent that ran the earlier steps, or ask me to take a different approach.`
      sendChunk({ chunk: fallback })
      return { text: fallback, messages: [] } as unknown as Awaited<
        ChatStreamResult["response"]
      >
    }
    if (isToolInputValidationError(err)) {
      // The model produced a tool argument the tool's schema rejects. Genkit
      // validates args before the handler, so this aborts the whole turn and
      // can't be resumed — end gracefully with a logged note instead of
      // surfacing the raw INVALID_ARGUMENT, which on a headless Workflows run
      // would otherwise become the run's terminal error.
      logger.warn(
        "[streamChatToClient] tool input failed schema validation — the model emitted an argument the tool rejects",
        { err: String(err) }
      )
      const fallback =
        "I tried to use one of my tools with an argument it wouldn't accept, so I couldn't finish that step. Could you rephrase your request, or break it into a smaller one?"
      sendChunk({ chunk: fallback })
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
 * EXECUTE seam for a streaming agent turn — the one place that owns the
 * per-turn `AbortController`, the `chat.sendStream(..., { maxTurns })`
 * invocation, and the `streamChatToClient` hand-off (which in turn owns the
 * `TURN_DEADLINE_MS` race + the recoverable-error recovery).
 *
 * `prepareChatTurn` is the SETUP seam (resolve-or-create session, model +
 * config, tools, system prompt); this is the EXECUTE seam. The three
 * streaming callsites — interactive `runAgentTurn`, the transfer re-entry in
 * `runTransferTurnIfRequested`, and the interrupt resume in
 * `respondToBotInterruptFlow` — differ ONLY in their {@link TurnDelivery}
 * shape (`{ prompt }` / `{ kind: "continue" }` / `{ resume }`) and their
 * pre-marked tool-ref sets, so each collapses to a single `runChatTurn(...)`
 * call instead of re-hand-rolling the abort controller + `maxTurns` + cast +
 * hand-off. Single-sourcing this is what makes `TURN_DEADLINE_MS` /
 * `TOOL_MAX_TURNS` / abort policy impossible to drift between callsites.
 *
 * The `AbortController` is created HERE (not by the caller) so its signal
 * rides into `sendStream` AND reaches `streamChatToClient`, which aborts it
 * on deadline expiry — a hung provider call is genuinely cancelled rather
 * than left to finish in the background and waste tokens/quota.
 */
async function runChatTurn(
  chat: PreparedChatTurn["chat"],
  delivery: TurnDelivery,
  opts: {
    sendChunk: (chunk: SendBotMessageStreamPayload) => void
    preSentToolCalls?: Iterable<string>
    preSentToolResults?: Iterable<string>
    preExistingToolCallCount?: number
    preExistingToolResultCount?: number
  }
): Promise<Awaited<ChatStreamResult["response"]>> {
  const turnAbort = new AbortController()
  return streamChatToClient(
    chat.sendStream({
      ...deliveryToSendArgs(delivery),
      abortSignal: turnAbort.signal,
      maxTurns: TOOL_MAX_TURNS,
    }) as ChatStreamResult,
    opts.sendChunk,
    {
      abortController: turnAbort,
      preSentToolCalls: opts.preSentToolCalls,
      preSentToolResults: opts.preSentToolResults,
      preExistingToolCallCount: opts.preExistingToolCallCount,
      preExistingToolResultCount: opts.preExistingToolResultCount,
    }
  )
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
  /**
   * Media parts (base64 `data:` URLs) built from supported binary attachments
   * of the attached context nodes — prepended (after the text) to the user
   * turn's `prompt`. Empty unless the turn carries a real user message.
   */
  userMediaParts: Part[]
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
 *   - Driving the transfer-induced second turn via
 *     `runTransferTurnIfRequested` and the post-stream
 *     `commitTransferIfRequested` safety-net write.
 *
 * The `archivedSessionMessage` parameter is the one user-visible
 * difference between flows — "before sending new messages" vs.
 * "before continuing" — so it stays a caller-supplied string.
 * `requireExistingSession` toggles between the two session-id
 * regimes (send allows null = create new; interrupt response
 * requires an existing session).
 */
async function prepareChatTurn(opts: {
  principal: TurnPrincipal
  teamId: string
  workspaceId: string
  sessionId: string | null
  mode: BotChatMode
  contextNodes: NodeRef[]
  /**
   * The user's latest message text — used ONLY as the query for automatic
   * workspace context retrieval (when the team enables `autoContext`). The
   * actual prompt is still sent by the caller via `chat.sendStream`. Omitted
   * by the transfer second-turn and interrupt-resume paths, which have no
   * fresh user query to retrieve against (so they get no auto-context).
   */
  message?: string
  /** Chat-session attachment ids selected for this turn (multimodal media). */
  attachmentIds?: string[]
  /**
   * Client-uploaded-but-uncommitted attachments for this turn (brand-new-chat
   * single-send path). The interactive `sendBotMessage` flow forwards these;
   * transfer/interrupt/headless callers leave them empty.
   */
  pendingAttachments?: readonly PendingSessionAttachmentInput[]
  activeAgentId: string | null | undefined
  model: BotAgentModel | undefined
  pinnedNode?: NodeRef
  requireExistingSession: boolean
  archivedSessionMessage: string
  /**
   * When true, the prepared chat won't expose `transferToAgent` to
   * the model and the system prompt's transfer directive is omitted.
   * Used by the transfer-induced second turn so a handoff chain stops
   * at one hop — recursive transfers (default → A → B → …) would be
   * confusing for the user and prone to deadline exhaustion.
   */
  disableTransfer?: boolean
  /**
   * Headless runs pass `false` to withhold the `askQuestion` interrupt tool
   * (no human can answer it). Defaults to `true` for interactive turns.
   */
  allowInterrupts?: boolean
  /**
   * Workflows-only. Per-model-call usage notification — the headless runner
   * accumulates this into the run's `usage` (per-run token + cost accounting).
   * Fires alongside the team-monthly metering, never instead of it.
   */
  onUsage?: (u: {
    model: string
    inputTokens: number
    outputTokens: number
  }) => void
  /**
   * Workflows-only. When set, WRITE tools record edits into `sink`; with
   * `captureOnly` they DON'T commit (a `require_review` run stages a changeset).
   */
  captureChanges?: { sink: CapturedNodeChange[]; captureOnly: boolean }
  /** Workflows-only. Restricts WRITE tools to this scope (the `targetScope`). */
  targetScope?: WorkspaceNodeScope | null
}): Promise<PreparedChatTurn> {
  const {
    principal,
    teamId,
    workspaceId,
    sessionId,
    mode,
    contextNodes,
    message,
    attachmentIds,
    pendingAttachments,
    activeAgentId,
    pinnedNode,
    requireExistingSession,
    archivedSessionMessage,
    disableTransfer,
    allowInterrupts = true,
    onUsage,
    captureChanges,
    targetScope,
  } = opts

  // The acting id (uid for a user, agentId for an agent) — used for the
  // membership lookup, the session edit gate, ownerUid/senderUid stamping,
  // and the action-context identity below.
  const actingId = principalId(principal)

  // Per-turn setup opens with three independent Firestore reads — the
  // principal's membership role, the existing session doc (when resuming),
  // and the team agent config. None depends on the others, so we issue
  // them concurrently and collapse three sequential round-trips into one.
  // The permission gate below runs on the resolved values, preserving the
  // original error precedence (membership → existence → archived →
  // edit-rights): if `resolveActingRole` rejects, `Promise.all` rejects
  // with that same error first.
  const [role, loadedSession, agentConfig, actingParticipation] =
    await Promise.all([
      resolveActingRole(principal, teamId),
      sessionId
        ? readSessionDoc(teamId, workspaceId, sessionId)
        : Promise.resolve(null),
      // Agent config drives model, prompt, tools, generation knobs, and the
      // SessionStore's title/preview lengths. Not cached — admin settings
      // changes should apply on the next send, not after a deploy.
      loadTeamAgentConfig(teamId),
      // Per-workspace participation for the acting principal (elevate-only):
      // lets a member/agent granted rights in THIS workspace edit content here
      // even when their team role alone wouldn't. Folded into the parallel
      // batch so it adds no round-trip.
      resolveParticipation(teamId, workspaceId, actingId),
    ])
  // An excluded principal is a non-member of this workspace. The old throwing
  // resolver surfaced this from inside the Promise.all; resolving participation
  // as data moves the rejection here — keeping the same error and giving
  // `resolveActingRole`'s failure strict precedence.
  if (actingParticipation.excluded) {
    throw new HttpsError(
      "permission-denied",
      "You are not a member of this workspace."
    )
  }
  const actingWorkspaceRole = actingParticipation.role

  // Edit-permission gate. The owner always has edit; for shared sessions,
  // any full member (owner/admin/member) also has edit — guests, who lack
  // MANAGE_WORKSPACE_CONTENT, stay read-only. Mirrors the client's
  // `canEditActive`. Archived sessions reject regardless of role —
  // archiving is a soft "read-only" flag.
  const existingSession: BotSessionDocSummary | null = loadedSession
  // A client-minted sessionId carrying pending uploads is the brand-new-chat
  // single-send path: the doc legitimately doesn't exist yet (the client chose
  // the id so it could upload blobs to the right Storage path before sending),
  // and `createSession({ sessionId })` below mints it. Skip the "not found"
  // rejection for exactly that case; every other provided id is a resume.
  const creatingNewSessionWithClientId =
    !!sessionId &&
    !existingSession &&
    !requireExistingSession &&
    (pendingAttachments?.length ?? 0) > 0
  if (sessionId && !creatingNewSessionWithClientId) {
    if (!existingSession) {
      throw new HttpsError("not-found", "Session not found.")
    }
    if (existingSession.archived) {
      throw new HttpsError("failed-precondition", archivedSessionMessage)
    }
    const isOwner = existingSession.ownerUid === actingId
    const canEdit =
      isOwner ||
      (existingSession.visibility === "shared" &&
        can(actingId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          scope: "workspace",
          teamRole: role,
          workspaceRole: actingWorkspaceRole,
        }))
    if (!canEdit) {
      throw new HttpsError(
        "permission-denied",
        "You don't have permission to send messages in this chat."
      )
    }
  } else if (!sessionId && requireExistingSession) {
    // Interrupt-response flow can't operate without a session — the
    // pending interrupt lives inside the SessionData blob.
    throw new HttpsError("invalid-argument", "sessionId is required.")
  }

  // Pending uploads (brand-new-chat single-send path). The client uploaded
  // these blobs to `botSessions/{sessionId}/…` Storage (allowed without the
  // session doc) and is sending their refs inline. Write the attachment docs
  // now — BEFORE the media load below reads them — and fold the ids into this
  // turn's selection. Gated on MANAGE_WORKSPACE_CONTENT, matching
  // `createBotSessionAttachment`. For a brand-new chat the session doc is
  // materialized by `createSession({ sessionId })` at end-of-turn save (so
  // `isNew` stays true and the title derives correctly).
  const materializedAttachmentIds: string[] = []
  if (pendingAttachments && pendingAttachments.length > 0) {
    if (!sessionId) {
      throw new HttpsError(
        "invalid-argument",
        "pendingAttachments require a sessionId."
      )
    }
    if (
      !can(actingId, Capabilities.MANAGE_WORKSPACE_CONTENT, {
        scope: "workspace",
        teamRole: role,
        workspaceRole: actingWorkspaceRole,
      })
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to upload chat attachments."
      )
    }
    materializedAttachmentIds.push(
      ...(await materializeSessionAttachments({
        teamId,
        workspaceId,
        sessionId,
        actorId: actingId,
        pendingAttachments,
      }))
    )
  }

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
  // Headless agent runs always load custom agents so the workflow's bound
  // persona (prompt + audit identity) resolves even when the team has the
  // customAgents feature toggle off — the run is explicitly that agent.
  const agentsEnabled =
    agentConfig.tools.customAgents || principal.kind === "agent"
  // Unified: built-in + custom agents are one collection now. Pass ALL agent
  // states (not just installed+enabled) to `resolveActiveAgent` so an
  // archived/deprecated agent a session still references keeps dispatching
  // (deprecate-but-run); `resolveActiveAgent` applies the enabled/archived
  // gates and `buildTransferRoster` filters to selectable targets. The ungated
  // Default persona is prepended first (it lives outside the catalog).
  const availableAgents: TeamAgentDoc[] = []
  if (agentsEnabled) {
    availableAgents.push(hydrateBuiltInAgent(teamId, DEFAULT_AGENT_DEFINITION))
    for (const integration of await listIntegrations(teamId)) {
      if (integration.type === "agent") {
        availableAgents.push(agentIntegrationToDoc(teamId, integration))
      }
    }
  }
  const activeAgent = resolveActiveAgent({
    requestedId: activeAgentId,
    sessionPersistedId: existingSession?.activeAgentId ?? null,
    availableAgents,
  })
  // Preserve the original session owner on shared-chat admin writes.
  // `actingId` is the actor for this turn; it is only the owner for new
  // sessions. Rewriting `ownerUid` on every save would silently transfer
  // shared chats to whichever admin replied most recently. (Headless agent
  // runs create their own sessions, so the agent id becomes the owner.)
  const sessionOwnerUid = existingSession?.ownerUid ?? actingId

  // Node-CRUD authorization for this turn. Two regimes:
  //
  //   - **User principal (interactive):** when a custom/built-in agent is
  //     active, BOTH the human and the agent must hold content-management
  //     rights — the agent acts on the user's behalf, so the gate is the
  //     intersection. The Default persona (`activeAgent === null`) borrows
  //     the user's authority (agent half defaults to `true`). Audit logs
  //     attribute the edit as `{ userId: <driver>, agentId, agentName }`.
  //
  //   - **Agent principal (headless Workflows run):** there is no human half
  //     to intersect. The agent IS the principal, so its own Member-role
  //     membership (`role`, resolved above for this same agent id) is the
  //     sole authority. Audit logs carry no `userId` (agent-only actor).
  //
  // Either way `canManage/ReadNodes` stay the pure security checks, re-
  // verified inside the tool handlers (`resolveNodeContext` fails closed),
  // so a misconfigured run can only under-permit, never escalate.
  const [activeAgentRole, activeAgentParticipation] = activeAgent
    ? await Promise.all([
        getMembershipRoleOrNull(teamId, activeAgent.id),
        resolveParticipation(teamId, workspaceId, activeAgent.id),
      ])
    : [null, null]
  // Preserve the throwing resolver's behavior: an active agent excluded from
  // this workspace fails the turn rather than silently losing its node tools.
  if (activeAgentParticipation?.excluded) {
    throw new HttpsError(
      "permission-denied",
      "You are not a member of this workspace."
    )
  }
  const activeAgentWorkspaceRole = activeAgentParticipation
    ? activeAgentParticipation.role
    : null
  const agentCanManageNodes = activeAgent
    ? can(activeAgent.id, Capabilities.MANAGE_WORKSPACE_CONTENT, {
        scope: "workspace",
        teamRole: activeAgentRole,
        workspaceRole: activeAgentWorkspaceRole,
      })
    : true
  const agentCanReadNodes = activeAgent
    ? can(activeAgent.id, Capabilities.READ_WORKSPACE, {
        scope: "workspace",
        teamRole: activeAgentRole,
      })
    : true

  let canManageNodes: boolean
  let canReadNodes: boolean
  if (principal.kind === "user") {
    const userCanManageNodes = can(
      principal.uid,
      Capabilities.MANAGE_WORKSPACE_CONTENT,
      { scope: "workspace", teamRole: role, workspaceRole: actingWorkspaceRole }
    )
    const userCanReadNodes = can(principal.uid, Capabilities.READ_WORKSPACE, {
      scope: "workspace",
      teamRole: role,
    })
    canManageNodes = userCanManageNodes && agentCanManageNodes
    canReadNodes = userCanReadNodes && agentCanReadNodes
  } else {
    // Agent principal: the agent's own role is the sole authority. We use
    // `principal.agentId` + `role` directly (not the `activeAgent`-derived
    // booleans above) so authority is correct even if the persona didn't
    // resolve to a record — the membership role is what gates content edits.
    canManageNodes = can(
      principal.agentId,
      Capabilities.MANAGE_WORKSPACE_CONTENT,
      { scope: "workspace", teamRole: role, workspaceRole: actingWorkspaceRole }
    )
    canReadNodes = can(principal.agentId, Capabilities.READ_WORKSPACE, {
      scope: "workspace",
      teamRole: role,
    })
  }

  // Feature-toggle layer ON TOP of the membership gates. `canManageNodes` /
  // `canReadNodes` stay the pure security checks (re-verified inside the tool
  // handlers); the `*Enabled` flags additionally require the active agent's
  // own per-agent toggle. NEITHER read nor write has a team-wide switch —
  // agents are real team members, so their MANAGE_WORKSPACE_CONTENT /
  // READ_WORKSPACE role IS the team-level authorization (a parallel team
  // toggle would just duplicate, and could silently conflict with,
  // membership). The per-agent toggle stays as a persona-design choice (a
  // read-only agent vs. an editing one) and can only narrow within what
  // membership already grants. These drive tool registration AND the node
  // system-prompt directive, so a toggled-off agent is never told it can use
  // tools it has none of. `!== false` keeps a missing key (older agent docs)
  // meaning "enabled."
  const nodeWriteEnabled =
    canManageNodes && activeAgent?.tools.manageContent !== false
  const nodeReadEnabled =
    canReadNodes && activeAgent?.tools.readContent !== false

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
    (!sessionId || creatingNewSessionWithClientId) && pinnedNode
      ? pinnedNodeKey(sessionOwnerUid, pinnedNode.scope, pinnedNode.nodeId)
      : undefined

  const store = new FirestoreBotSessionStore({
    teamId,
    workspaceId,
    ownerUid: sessionOwnerUid,
    titleMaxLength: agentConfig.titleMaxLength,
    previewMaxLength: agentConfig.previewMaxLength,
    pinnedNodeKey: newSessionPinnedNodeKey,
    contextNodes,
    turnMode: mode,
    turnModel: effectiveModel,
    senderUid: actingId,
    turnActiveAgentId: persistedActiveAgentId,
  })

  // Three independent reads remain — the session blob (Genkit's store
  // round-trip), the attached-node context block, and the team's custom
  // tools. None depends on the others, so fan them out together rather
  // than awaiting in series.
  //   - `loadAndBuildContextBlock` resolves attached workspace nodes into
  //     a prompt block, itself parallelizing the per-node Firestore +
  //     Storage fetches; missing / archived nodes are silently skipped so
  //     a stale chip doesn't fail the turn (capped upstream at
  //     `CONTEXT_NODE_MAX`).
  //   - Custom tools are admin-authored Genkit tools gated by the
  //     team-wide `customTools` flag; the factory rebuilds each one per
  //     turn so admin schema changes propagate without a deploy. Empty
  //     when the feature is off OR the team has none.
  const [
    session,
    nodeContext,
    dispatchableToolIntegrations,
    autoContextBlock,
    sessionMediaParts,
  ] = await Promise.all([
    sessionId
      ? creatingNewSessionWithClientId
        ? Promise.resolve(ai.createSession({ store, sessionId }))
        : ai.loadSession(sessionId, { store })
      : Promise.resolve(ai.createSession({ store })),
    loadAndBuildContextBlock(teamId, workspaceId, contextNodes, !!message),
    // Installed + enabled tool integrations (built-in via catalog overlay +
    // custom). Built-in keys gate the static tools in `pickChatTools`;
    // custom integrations are rebuilt per-turn via `buildCustomToolForChat`.
    listDispatchable(teamId, "tool"),
    // Automatic RAG: when the team enables `autoContext`, embed the user's
    // message and fold a compact snippet block of the nearest workspace nodes
    // into the system prompt. Best-effort ("" when disabled / on any
    // failure). Deduped against the explicitly-attached `contextNodes`.
    buildAutoContextBlock({
      enabled: agentConfig.autoContext,
      teamId,
      workspaceId,
      query: message ?? "",
      excludeKeys: new Set(contextNodes.map((n) => `${n.scope}:${n.nodeId}`)),
    }),
    // Chat-session uploads the user selected for THIS turn → base64 media
    // parts. Same `includeMedia` gate as the node-attachment media above.
    loadSessionAttachmentMediaParts({
      teamId,
      workspaceId,
      sessionId,
      attachmentIds: [...(attachmentIds ?? []), ...materializedAttachmentIds],
      includeMedia: !!message,
    }),
  ])
  // Built-in tool wire-names installed + enabled this turn.
  const enabledBuiltInTools = new Set(
    dispatchableToolIntegrations
      .filter((t) => t.source !== "custom")
      .map((t) => t.sourceKey ?? "")
  )
  // Custom tools additionally require the team-wide customTools feature gate.
  const dispatchableCustomToolIntegrations = agentConfig.tools.customTools
    ? dispatchableToolIntegrations.filter((t) => t.source === "custom")
    : []

  // Transfer roster — other agents the active one can hand off to.
  // When a custom agent is active we include the team default
  // (`id: ""`) so the model has a way back to the generic assistant.
  // When no agent is active, only custom agents are eligible targets.
  //
  // `disableTransfer` zeroes the roster — used by the transfer-induced
  // second turn (`runTransferTurnIfRequested`) so a handoff chain can't
  // recurse past one hop. An empty roster naturally cascades to:
  //   - `pickChatTools` skipping `transferToAgentTool`
  //   - `availableTransferAgentIds` being undefined on the action context
  //   - `buildAgentSystemPrompt` emitting the "no targets" directive,
  //     which doubles as a guard against the model hallucinating a
  //     transfer in prose
  const transferRoster = disableTransfer
    ? []
    : buildTransferRoster(activeAgent, availableAgents)

  // Action context fed into `chat({ context })`. `availableTransferAgentIds`
  // is the runtime allowlist enforced by `transferToAgent`'s handler;
  // `transferRequest` is a pre-allocated container the handler writes
  // `.agentId` into on a successful transfer call. The container MUST
  // be allocated here (not relied on the handler to create) because
  // Genkit shallow-clones `context` for the handler — a missing
  // container leaves the handler with nothing to mutate and the
  // transfer signal never reaches the dispatcher. See
  // `BotActionContext.transferRequest` for the full rationale.
  // `effectiveModel` lets promptTemplate custom tools fall back to the
  // chat's current model when no admin override is set.
  const actionContext: BotActionContext = {
    // For a user principal this is the human's uid (audit `userId`). For an
    // agent principal there is no human, so the uid is empty — the node-tool
    // audit actor then carries only `agentId`/`agentName` (see the optional
    // `Actor.userId`). `activeAgentId` below still identifies the persona.
    auth: { uid: principal.kind === "user" ? principal.uid : "" },
    mode,
    teamId,
    workspaceId,
    availableTransferAgentIds:
      transferRoster.length > 0 ? transferRoster.map((r) => r.id) : undefined,
    transferRequest: {},
    effectiveModel,
    canManageNodes,
    canReadNodes,
    // Always set an identity so node-tool handlers
    // (`resolveNodeContext` checks `ctx.activeAgentId`) and audit logs
    // get a non-empty `agentId`/`agentName` pair regardless of which
    // persona is driving. The Default persona uses `DEFAULT_AGENT_ID`
    // (`"_default"`) — a sentinel the dispatch layer reserves and that
    // `isBuiltInAgentId` already recognizes (underscore prefix), so
    // downstream code that filters built-ins continues to treat it
    // correctly. Audit log readers see `agentId: "_default"`,
    // `agentName: "Default"` for actions the team's default voice took
    // on the user's behalf.
    activeAgentId: activeAgent?.id ?? DEFAULT_AGENT_ID,
    activeAgentName: activeAgent?.name ?? "Default",
    // Workflows: WRITE tools record (and, in require_review, stage instead of
    // commit) their edits here; `allowedScope` pins them to the target tree.
    captureSink: captureChanges?.sink,
    captureOnly: captureChanges?.captureOnly,
    allowedScope: targetScope ?? undefined,
  }

  // Tool catalog — mode steers prompt style only; per-team toggles strip
  // individual tools; the active agent layers ON TOP (a tool fires only
  // when both team AND agent allow it). `transferToAgent`
  // joins the catalog only when at least one other agent is reachable.
  // Custom tools are appended after the built-ins; each one rebuilds
  // its Genkit registration per-turn (admin schema changes apply
  // without a deploy).
  const chatTools = pickChatTools(
    enabledBuiltInTools,
    activeAgent,
    transferRoster.length,
    allowInterrupts
  )
  for (const ti of dispatchableCustomToolIntegrations) {
    // Per-agent intersection — mirrors the built-in `agentAllows()`
    // pattern. Missing keys normalize to `true` (the `!== false`
    // check), so a custom tool the admin hasn't explicitly opted-
    // out of stays available to every agent automatically. Default
    // persona (`activeAgent === null`) always gets every tool.
    if (activeAgent && activeAgent.customTools[ti.id] === false) {
      continue
    }
    chatTools.push(
      buildCustomToolForChat(customToolIntegrationToDoc(teamId, ti))
    )
  }

  // Node tools — registered in two independently-gated groups. WRITE
  // tools (create/edit/rename/move/archive) need `nodeWriteEnabled`
  // (MANAGE_WORKSPACE_CONTENT × `manageContent` toggle); the READ tool
  // (`readNode`) needs `nodeReadEnabled` (the lighter READ_WORKSPACE ×
  // `readContent` toggle). The Default persona qualifies whenever the
  // driving user does — there's no second identity to gate on — and the
  // resulting actions are attributed in audit logs under the synthetic
  // `_default` agent id (see `actionContext` above).
  if (nodeReadEnabled) {
    chatTools.push(...NODE_READ_TOOLS)
  }
  if (nodeWriteEnabled) {
    chatTools.push(...NODE_WRITE_TOOLS)
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
    // Pass the EFFECTIVE flags so the node-editing directive (and its
    // readNode mention) only appears when those tools are actually
    // registered this turn — see `nodeWriteEnabled` / `nodeReadEnabled`.
    canManageNodes: nodeWriteEnabled,
    canReadNodes: nodeReadEnabled,
    // Same EFFECTIVE-flag discipline: headless runs withhold `askQuestion`
    // (allowInterrupts=false), so the prompt must stop steering toward it.
    allowInterrupts,
  })
  // Safety directive lands LAST — after the attached-context block — so
  // the "untrusted content is data, not instructions" rule is the final
  // thing the model reads, right after the untrusted text itself. Always
  // present (web/search results are untrusted even on read-only turns);
  // contextBlock is dropped from the join when empty.
  const systemPrompt = [
    baseSystem,
    nodeContext.block,
    autoContextBlock,
    WORKSPACE_SAFETY_DIRECTIVE,
  ]
    .filter(Boolean)
    .join("\n\n")

  // Per-provider "thinking" enablement. The stream + reconstruction fold
  // any resulting `reasoning` parts into <thinking> blocks uniformly
  // (createThinkingFolder), so this only controls how each provider is
  // asked to emit reasoning in the first place:
  //   - Gemini (2.5+/3): `thinkingConfig.includeThoughts`.
  //   - Claude (3.7/4+): the beta API surface + a `thinking` budget.
  //     Anthropic rejects temperature/top_p/top_k alongside thinking and
  //     requires max_tokens > budget, so we drop the sampling knobs and add
  //     the budget on top of the agent's answer allotment.
  //   - OpenAI gpt-4*: not reasoning models, nothing to enable;
  //     `reasoning_content` from a compatible endpoint is still folded.
  const provider = getModelProvider(effectiveModel)
  const turnConfig = buildTurnConfig({
    provider,
    model: effectiveModel,
    sampling: {
      temperature: agentConfig.temperature,
      topP: agentConfig.topP,
      topK: agentConfig.topK,
      maxOutputTokens: agentConfig.maxOutputTokens,
    },
    thinkingEnabled: agentConfig.thinking,
  })

  // Anthropic prompt caching: mark the (large, turn-stable) system prompt as
  // an ephemeral cache breakpoint so Claude reuses the tokenized system+tools
  // prefix across turns in a session — a substantial input-token saving on
  // multi-turn chats. Gemini/OpenAI cache automatically server-side and would
  // ignore the hint, so we only annotate the request for Anthropic models.
  const system =
    provider === "anthropic"
      ? [{ text: systemPrompt, metadata: { ...cacheControl() } }]
      : systemPrompt

  const chat = session.chat({
    model: resolveModel(effectiveModel),
    system,
    tools: chatTools,
    context: actionContext,
    config: turnConfig,
    // Middleware stack applied to every turn: logging emits a structured
    // debug line; the budget gate trips before a runaway context window
    // reaches the provider; the redactor scrubs PII out of user parts only;
    // the metering layer records this turn's token usage (including each
    // tool-iteration round trip) into the team's monthly counter. Metering
    // is fire-and-forget — it never blocks or fails the turn.
    use: aiMiddlewares({
      onUsage: ({ inputTokens, outputTokens }) => {
        // Team-monthly hard-cap counter (interactive + headless alike)…
        void incrementTeamTokenUsage(teamId, inputTokens, outputTokens)
        // …and, for a Workflows run, the per-run accumulator the worker
        // persists as `usage` + estimated cost.
        onUsage?.({ model: effectiveModel, inputTokens, outputTokens })
      },
    }),
  })

  return {
    chat,
    session,
    actionContext,
    existingSession,
    effectiveModel,
    userMediaParts: [...nodeContext.media, ...sessionMediaParts],
  }
}

/** Options for {@link runAgentTurn}. */
interface RunAgentTurnOptions {
  principal: TurnPrincipal
  teamId: string
  workspaceId: string
  /** Null creates a fresh session (the default for each headless run). */
  sessionId: string | null
  /** Already-trimmed, non-empty prompt the principal sends this turn. */
  message: string
  mode: BotChatMode
  model: BotAgentModel | undefined
  contextNodes: NodeRef[]
  /** Chat-session attachment ids selected for this turn (multimodal media). */
  attachmentIds?: string[]
  /**
   * Client-uploaded-but-uncommitted attachments for this turn (brand-new-chat
   * single-send path). Only the interactive `sendBotMessage` flow sets this;
   * headless/interrupt callers leave it empty.
   */
  pendingAttachments?: readonly PendingSessionAttachmentInput[]
  activeAgentId: string | null | undefined
  pinnedNode?: NodeRef
  /** Stream sink. Omitted → a no-op, for headless runs with no client. */
  sendChunk?: (chunk: SendBotMessageStreamPayload) => void
  archivedSessionMessage?: string
  /** Withhold the `askQuestion` interrupt tool (headless runs pass `false`). */
  allowInterrupts?: boolean
  /** Workflows-only — forwarded to {@link prepareChatTurn}. */
  onUsage?: (u: {
    model: string
    inputTokens: number
    outputTokens: number
  }) => void
  captureChanges?: { sink: CapturedNodeChange[]; captureOnly: boolean }
  targetScope?: WorkspaceNodeScope | null
  /** Forwarded to prepareChatTurn — headless runs disable agent handoff. */
  disableTransfer?: boolean
  /**
   * Marks a headless (Workflows) run with no human in the loop. Forwarded to
   * `runTransferTurnIfRequested` so a failed handoff fails the run loudly
   * (retry-once-then-throw) instead of returning the interactive soft
   * fallback. `sendBotMessageFlow` leaves it unset (interactive).
   */
  headless?: boolean
}

/**
 * Drive ONE agent turn end-to-end: acquire the per-session lock, prepare the
 * chat (`prepareChatTurn`), stream the model reply, run the transfer-induced
 * second turn if requested, and persist. Returns the canonical
 * `{ sessionId, reply }`.
 *
 * Shared by `sendBotMessageFlow` (interactive, user principal, real
 * `sendChunk`) and the Workflows worker (headless, agent principal, no-op
 * `sendChunk`). The streaming is a pure side-channel — the canonical result
 * is the SessionStore save plus this return value — so dropping the stream
 * for a headless run loses nothing. The interrupt-resume flow is NOT routed
 * through here: it has a distinct `{ resume: { respond } }` invocation and a
 * pre-stream toolResult emission, so it stays its own handler.
 */
async function runAgentTurn(
  opts: RunAgentTurnOptions
): Promise<{ sessionId: string; reply: string }> {
  const sendChunk = opts.sendChunk ?? (() => {})
  const archivedSessionMessage =
    opts.archivedSessionMessage ??
    "This chat is archived. Restore it before sending new messages."

  // Hard-cap budget gate. Both interactive sends and headless Workflows runs
  // flow through here, so the team's monthly token ceiling applies to both.
  // Checked before acquiring the lock or touching the model so an over-budget
  // turn fails fast. The transfer-induced second turn calls prepareChatTurn
  // directly (not this fn), so it isn't re-gated — a handoff mid-turn
  // shouldn't be blocked once the first turn was admitted.
  await assertWithinBudget(opts.teamId)

  // Serialize turns per existing session so two concurrent sends (common in
  // shared chats where several admins post into one session, or a scheduled
  // run racing a human) can't both load the same thread and clobber each
  // other on save — Genkit's SessionStore is last-write-wins with no version
  // guard. Acquired BEFORE prepareChatTurn (whose loadSession reads the
  // thread) so the base we build on is current; new sessions (no sessionId)
  // have a fresh id nothing else knows yet, so they skip the lock. Released
  // in the finally below — including on a throw from prepareChatTurn — so a
  // rejected turn never wedges the chat.
  const releaseLock = opts.sessionId
    ? await acquireSessionTurnLock(
        opts.teamId,
        opts.workspaceId,
        opts.sessionId
      )
    : NOOP_RELEASE
  try {
    const { chat, session, actionContext, existingSession, userMediaParts } =
      await prepareChatTurn({
        principal: opts.principal,
        teamId: opts.teamId,
        workspaceId: opts.workspaceId,
        sessionId: opts.sessionId,
        mode: opts.mode,
        contextNodes: opts.contextNodes,
        message: opts.message,
        attachmentIds: opts.attachmentIds,
        pendingAttachments: opts.pendingAttachments,
        activeAgentId: opts.activeAgentId,
        model: opts.model,
        pinnedNode: opts.pinnedNode,
        requireExistingSession: false,
        archivedSessionMessage,
        allowInterrupts: opts.allowInterrupts,
        onUsage: opts.onUsage,
        captureChanges: opts.captureChanges,
        targetScope: opts.targetScope,
        disableTransfer: opts.disableTransfer,
      })

    // Capture the thread length BEFORE the first turn appends anything.
    // `runTransferTurnIfRequested` needs this to slice the thread back to
    // "prior conversation + the just-sent message" if a transfer fires.
    const preTurnThreadLength =
      existingSession?.data?.threads?.[MAIN_THREAD]?.length ?? 0

    // Emit the session id before we touch the model. For brand-new sessions
    // this lets the client update the URL immediately; for resumed sessions
    // it's a redundant confirmation but harmless (a no-op for headless runs).
    sendChunk({ sessionId: session.id })

    // Pre-mark every historical tool-call/result ref so the post-stream sweep
    // doesn't re-emit them into the new turn's agent bubble — empty arrays for
    // a brand-new session, so this is a no-op on first turns.
    const priorRefs = collectPriorTurnToolRefs(existingSession?.data)

    // Multimodal turn: when the attached nodes contributed media parts
    // (images/PDFs), send the user turn as a `[text, ...media]` array;
    // otherwise keep the plain-string prompt (cheaper, unchanged behavior).
    // `runChatTurn` owns the per-turn AbortController + `maxTurns` + the
    // deadline race; here we only pick the delivery shape and the ref dedup.
    const turnPrompt: string | Part[] =
      userMediaParts.length > 0
        ? [{ text: opts.message }, ...userMediaParts]
        : opts.message
    const firstFinal = await runChatTurn(
      chat,
      { prompt: turnPrompt },
      {
        sendChunk,
        preSentToolCalls: priorRefs.calls,
        preSentToolResults: priorRefs.results,
        preExistingToolCallCount: priorRefs.callCount,
        preExistingToolResultCount: priorRefs.resultCount,
      }
    )

    // If the model called `transferToAgent`, drive a second turn under the
    // target agent inside this same request so the message gets answered
    // immediately. Returns the first turn's response unchanged when no
    // transfer fired. Non-`HttpsError` failures are converted to a streamed
    // fallback + stub response inside the helper; `commitTransferIfRequested`
    // below still lands the agent change either way.
    let final: Awaited<ChatStreamResult["response"]>
    try {
      final = await runTransferTurnIfRequested({
        firstFinal,
        firstSession: session,
        preTurnThreadLength,
        firstActionContext: actionContext,
        principal: opts.principal,
        teamId: opts.teamId,
        workspaceId: opts.workspaceId,
        sessionId: session.id,
        mode: opts.mode,
        contextNodes: opts.contextNodes,
        model: opts.model,
        // Forward the run's capture/metering/scope so a handed-off Workflows
        // turn is staged + metered like the first (undefined for chat).
        captureChanges: opts.captureChanges,
        onUsage: opts.onUsage,
        targetScope: opts.targetScope,
        allowInterrupts: opts.allowInterrupts,
        headless: opts.headless,
        archivedSessionMessage,
        sendChunk,
      })
    } finally {
      // Safety-net agent-id commit. Idempotent with the second turn's in-built
      // save when that turn ran cleanly; the load-bearing case is when the
      // second turn threw before its save, so the next message still routes to
      // the requested target.
      await commitTransferIfRequested(
        opts.teamId,
        opts.workspaceId,
        session.id,
        actionContext
      )
    }

    return {
      sessionId: session.id,
      reply: final.text,
    }
  } finally {
    await releaseLock()
  }
}

/** Per-run token + estimated-cost inputs the worker persists as `usage`. */
export interface HeadlessRunUsage {
  model: string | null
  inputTokens: number
  outputTokens: number
}

/**
 * Headless entry point for the Workflows worker: run ONE agent turn AS a team
 * agent, with no client and no human. Creates a fresh session each call (so a
 * run's history never grows unbounded), defaults to the proactive "agent"
 * mode, withholds interrupts, disables agent handoff (so the whole run is one
 * captured/metered turn), and discards the stream. Persists the turn to the
 * agent-owned botSession where any returning teammate sees it live.
 *
 * Returns `{ sessionId, reply, usage, changes }`:
 *   - `usage` accumulates every model round-trip's tokens for per-run cost.
 *   - `changes` is the WRITE tools' capture sink. In `require_review` mode
 *     (`captureOnly`) the edits are staged here and NOT committed; in
 *     `automatic` mode they're committed AND recorded for the run's changeset.
 *
 * Throws `failed-precondition` if the agent isn't a team member, or
 * `resource-exhausted` if the team is over its monthly token budget — the
 * worker maps these to `error` / `blocked` run statuses.
 */
export async function runHeadlessAgentTurn(opts: {
  agentId: string
  teamId: string
  workspaceId: string
  message: string
  mode?: BotChatMode
  model?: BotAgentModel
  contextNodes?: NodeRef[]
  /** Defaults to `require_review` (stage edits) — `automatic` commits them. */
  updateMode?: "automatic" | "require_review"
  /** Tree the run may edit; restricts WRITE tools when set. */
  targetScope?: WorkspaceNodeScope | null
  /**
   * Expose `transferToAgent` for this run so the agent can hand off to a
   * specialist. Off by default (one self-contained turn); the workflow
   * worker turns it on only for the Default agent, whose prompt steers it
   * to transfer when a task needs expertise it lacks. The handed-off
   * second turn still runs with transfer disabled (one hop, no chains).
   */
  allowTransfer?: boolean
}): Promise<{
  sessionId: string
  reply: string
  usage: HeadlessRunUsage
  changes: CapturedNodeChange[]
}> {
  const usage: HeadlessRunUsage = {
    model: null,
    inputTokens: 0,
    outputTokens: 0,
  }
  const changes: CapturedNodeChange[] = []
  const captureOnly = (opts.updateMode ?? "require_review") === "require_review"

  const { sessionId, reply } = await runAgentTurn({
    principal: { kind: "agent", agentId: opts.agentId },
    teamId: opts.teamId,
    workspaceId: opts.workspaceId,
    // Fresh session per run — bounds context growth and keeps run history
    // cleanly separable in the agent-owned botSessions list.
    sessionId: null,
    message: opts.message,
    mode: opts.mode ?? "agent",
    model: opts.model,
    contextNodes: opts.contextNodes ?? [],
    // The workflow's agent is both the authorizing principal AND the persona.
    activeAgentId: opts.agentId,
    allowInterrupts: false,
    // Headless run: a failed handoff should fail the run loudly (so the worker
    // records a real `error`), not return the interactive "send your message
    // again" fallback — there's no human, no next message, and the session is
    // a throwaway. See `runTransferTurnIfRequested`.
    headless: true,
    // Transfer is opt-in (the worker turns it on only for the Default agent).
    // When on, the handed-off second turn INHERITS this run's capture +
    // metering hooks — `runAgentTurn` forwards `captureChanges`/`onUsage`/
    // `targetScope`/`allowInterrupts` into `runTransferTurnIfRequested` — so a
    // staged changeset and per-run usage still cover both agents' work.
    disableTransfer: opts.allowTransfer !== true,
    targetScope: opts.targetScope,
    captureChanges: { sink: changes, captureOnly },
    onUsage: (u) => {
      usage.model = u.model
      usage.inputTokens += u.inputTokens
      usage.outputTokens += u.outputTokens
    },
  })

  return { sessionId, reply, usage, changes }
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

    return runAgentTurn({
      principal: { kind: "user", uid: auth.uid },
      teamId: input.teamId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId ?? null,
      message,
      mode: input.mode,
      model: input.model,
      contextNodes: input.contextNodes,
      activeAgentId: input.activeAgentId,
      pinnedNode: input.pinnedNode,
      attachmentIds: input.attachmentIds,
      pendingAttachments: input.pendingAttachments,
      sendChunk,
      archivedSessionMessage:
        "This chat is archived. Restore it before sending new messages.",
    })
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
 * (or a name in our interrupt-tool catalog) for which no later
 * `toolResponse` resolves it. Prefer `ref` when present; for older/ref-less
 * sessions, pair by tool name in thread order so answered legacy
 * interrupts don't stay pending forever. We scan the entire thread (not
 * just the last message) for safety; in practice pending interrupts only
 * ever live on the latest model message.
 */
function findPendingInterruptParts(
  data: SessionData | undefined
): ToolRequestPartLike[] {
  if (!data?.threads) return []
  const thread = data.threads[MAIN_THREAD]
  if (!Array.isArray(thread)) return []

  const pending: ToolRequestPartLike[] = []
  const removePending = (
    predicate: (part: ToolRequestPartLike) => boolean
  ): void => {
    const index = pending.findIndex(predicate)
    if (index >= 0) pending.splice(index, 1)
  }

  for (const raw of thread as MessageLike[]) {
    const content = raw.content
    if (!Array.isArray(content)) continue
    for (const part of content as PartLike[]) {
      if (part.toolResponse?.name) {
        const responseRef = part.toolResponse.ref
        const responseName = part.toolResponse.name
        if (responseRef) {
          removePending((p) => p.toolRequest.ref === responseRef)
        } else {
          removePending(
            (p) => !p.toolRequest.ref && p.toolRequest.name === responseName
          )
        }
        continue
      }

      if (raw?.role !== "model") continue
      if (!part.toolRequest?.name) continue
      const isInterrupt =
        !!part.metadata?.interrupt ||
        INTERRUPT_TOOL_NAMES.has(part.toolRequest.name)
      if (!isInterrupt) continue
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

    // Same monthly token hard-cap as the send path. Resuming an interrupt
    // still runs the model, so it counts against (and is gated by) the team's
    // budget.
    await assertWithinBudget(input.teamId)

    // Serialize against concurrent turns on this session (another interrupt
    // response, or a plain send) so the resumed thread can't be clobbered —
    // same rationale as `sendBotMessageFlow`. Interrupts always run on an
    // existing session, so the lock is unconditional. Acquired before
    // prepareChatTurn's loadSession; released in the finally below.
    const releaseLock = await acquireSessionTurnLock(
      input.teamId,
      input.workspaceId,
      input.sessionId
    )
    try {
      const { chat, session, actionContext, existingSession } =
        await prepareChatTurn({
          principal: { kind: "user", uid: auth.uid },
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

      // For the resume flow, "pre-turn" means the thread as it was
      // when the interrupt fired — already persisted, ending with
      // the `model` message that carries the pending tool request.
      // The resume folds the user's answer in as a tool response
      // (NOT a new user-role message — the answer rides on
      // `respondPart`), so post-resume the thread is
      // `[...pre-resume, <answer>, <model continuation>, …]`. Using
      // the same `length + 1` truncation as the send flow keeps the
      // answer at the tail and strips the continuation, which is
      // what `runTransferTurnIfRequested` needs to feed a clean
      // "ready for assistant reply" thread to the new agent.
      const preTurnThreadLength =
        existing.data?.threads?.[MAIN_THREAD]?.length ?? 0

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

      const interruptName = interruptPart.toolRequest.name ?? name
      if (interruptName !== "askQuestion") {
        // Future-proofing: if we add more interrupt tools, the dispatch
        // table belongs here. For now there's only one.
        throw new HttpsError(
          "failed-precondition",
          `Unsupported interrupt tool: ${interruptName}`
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
          name: interruptName,
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
      const answeredResultKey = interruptPart.toolRequest.ref
        ? `result:${interruptPart.toolRequest.ref}`
        : `result:${interruptName}#${priorRefs.resultCount}`
      const preSentResults = [...priorRefs.results, answeredResultKey]

      // Delivery `{ resume }` folds the user's answer back in as the tool
      // response (NOT a new user-role message). `runChatTurn` owns the abort
      // controller + `maxTurns` + deadline race; the resumed turn can chain
      // tools and hang on the provider just like a fresh send.
      const firstFinal = await runChatTurn(
        chat,
        { resume: { respond: [respondPart] } },
        {
          sendChunk,
          preSentToolCalls: priorRefs.calls,
          preSentToolResults: preSentResults,
          preExistingToolCallCount: priorRefs.callCount,
          preExistingToolResultCount: priorRefs.resultCount,
        }
      )

      // Same transfer-induced second turn as `sendBotMessageFlow`. A
      // resumed turn can call `transferToAgent` too — the model that
      // continues past an interrupt is still the original agent, with
      // the same tool catalog — so the handoff path must apply here.
      let final: Awaited<ChatStreamResult["response"]>
      try {
        final = await runTransferTurnIfRequested({
          firstFinal,
          firstSession: session,
          preTurnThreadLength,
          firstActionContext: actionContext,
          principal: { kind: "user", uid: auth.uid },
          teamId: input.teamId,
          workspaceId: input.workspaceId,
          sessionId: session.id,
          mode: input.mode,
          contextNodes: input.contextNodes,
          model: input.model,
          archivedSessionMessage:
            "This chat is archived. Restore it before continuing.",
          sendChunk,
        })
      } finally {
        // Safety-net agent-id commit; see `sendBotMessageFlow` for the
        // rationale (covers the case where the second turn threw
        // before its in-built save).
        await commitTransferIfRequested(
          input.teamId,
          input.workspaceId,
          session.id,
          actionContext
        )
      }

      return {
        sessionId: session.id,
        reply: final.text,
      }
    } finally {
      await releaseLock()
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

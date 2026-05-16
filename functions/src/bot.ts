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
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https"
import { z, type SessionData, type SessionStore } from "genkit/beta"
import { searchWorkspaceNodesTool } from "./botRag.js"
import { summarizeNodeTool } from "./botSummarize.js"
import { admin, db } from "./firebase.js"
import {
  ai,
  assertAiModelProviderConfigured,
  isAiModelProviderConfigured,
  resolveModel,
} from "./genkitClient.js"
import { CALLABLE_OPTS, GENKIT_OPTS } from "./runtimeConfig.js"
import { anthropicApiKey, geminiApiKey, openaiApiKey } from "./secrets.js"
import type { IMembershipRole } from "./types.js"

// `AuthData` isn't re-exported from `firebase-functions/v2/https`, so derive
// it from `CallableRequest["auth"]` to avoid reaching into internal paths.
type AuthData = NonNullable<CallableRequest["auth"]>

type SessionVisibility = "private" | "shared" | "public"
const ADMIN_ROLES: ReadonlyArray<IMembershipRole> = ["owner", "admin"]

const MAIN_THREAD = "main"
const TITLE_MAX_LENGTH = 80
const PREVIEW_MAX_LENGTH = 200

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

interface ChatMessage {
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
function extractMessagesFromSessionData(
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
 * Firestore-backed `SessionStore` scoped to one (teamId, workspaceId) pair.
 * Genkit calls `get(sessionId)` and `save(sessionId, data)` — we round-trip
 * the entire session blob as JSON, and on each save we additionally derive
 * sidebar metadata (title, preview, messageCount).
 */
class FirestoreBotSessionStore implements SessionStore {
  constructor(
    private readonly teamId: string,
    private readonly workspaceId: string,
    private readonly ownerUid: string,
    /**
     * Per-workspace truncation knobs. The store doesn't read the agent
     * config doc itself — the calling flow loads it once per turn and
     * passes the relevant lengths in. Keeps the Genkit save callback
     * (which fires on every turn, sometimes mid-flight) free of extra
     * Firestore reads.
     */
    private readonly titleMaxLength: number = TITLE_MAX_LENGTH,
    private readonly previewMaxLength: number = PREVIEW_MAX_LENGTH,
    /**
     * Composite `${ownerUid}:${scope}:${nodeId}` index key for the
     * caller's node-pinned chat lookup. Written once on session
     * creation; never rewritten on subsequent saves. The pin's
     * scope/nodeId live as a normal entry inside `contextNodes` — this
     * field exists only to power `findBotSessionByPinnedNode`'s
     * single-equality Firestore query.
     */
    private readonly pinnedNodeKey?: string,
    /**
     * The full chip set the user has attached on the current turn.
     * Re-written on every save so detaches and reorders propagate
     * immediately. Includes the pinned node, if any — there is no
     * separate `pinnedNode` field on the doc. Empty array is a
     * meaningful state ("no chips") distinct from `undefined` on
     * docs that haven't been re-saved since this field was introduced.
     */
    private readonly contextNodes: NodeRef[] = [],
    /**
     * Mode for the turn that triggered this save. Persisted as a
     * denormalized `lastMode` field so the history sidebar can filter
     * sessions by mode without parsing the SessionData blob. The most
     * recent turn wins — earlier turns' modes are not retained.
     */
    private readonly turnMode?: BotChatMode,
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
    private readonly senderUid?: string
  ) {}

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
    const sanitizedData = JSON.parse(JSON.stringify(data))

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
      // right now" for every snapshot listener.
      messages,
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
// Action context — the per-turn shape passed to `chat({ context })` so the
// model and tool handlers see the caller's mode and capabilities.
// ===========================================================================
//
// Modes mirror the dropdown in `AiChatComposer.vue`. Each mode flips three
// knobs:
//   1. SYSTEM PROMPT — different paragraph appended to a shared base, so
//      the model's behavior shifts (proactive vs cautious vs read-only).
//   2. TOOL EXPOSURE — `manual` registers no tools, guaranteeing the model
//      cannot invoke them no matter what the user asks.
//   3. CONTEXT.MODE — handed to tools via Genkit's action-context channel
//      so any tool can branch on mode for deterministic security.
//
// The mode→config mapping is the single source of truth; the i18n labels
// and side-panel descriptions on the client mirror these names.

const BOT_CHAT_MODES = ["auto", "agent", "manual"] as const
type BotChatMode = (typeof BOT_CHAT_MODES)[number]

interface BotChatModeConfig {
  /** Appended to SYSTEM_PROMPT_BASE — steers the model's behavior. */
  promptSuffix: string
  /**
   * Whether action tools (`getWeather`, `rollDice`) are exposed. Interrupt
   * tools (`askQuestion`) are always available — clarifying questions
   * have no side effects, so they're allowed in every mode (including
   * `manual`, where they keep the conversation collaborative).
   */
  actionToolsEnabled: boolean
}

const MODE_CONFIG: Record<BotChatMode, BotChatModeConfig> = {
  auto: {
    promptSuffix:
      "Default mode: answer concisely. Call a tool when it directly " +
      "advances the user's request, otherwise just reply with text. If " +
      "the request is ambiguous, prefer asking the user a clarifying " +
      "question via `askQuestion` over guessing.",
    actionToolsEnabled: true,
  },
  agent: {
    promptSuffix:
      "Agent mode: be proactive. Prefer calling tools to gather concrete " +
      "data over guessing, and chain multiple tool calls when a question " +
      "needs them. Briefly narrate what you're doing and why. When you " +
      "need a decision from the user before continuing, ask via " +
      "`askQuestion` — don't pick on their behalf.",
    actionToolsEnabled: true,
  },
  manual: {
    promptSuffix:
      "Manual mode: action tools are disabled. You are a read-only " +
      "conversational partner — explain, suggest, and discuss, but never " +
      "claim to take actions on the user's behalf. You may still ask " +
      "clarifying questions via `askQuestion` when it would help the " +
      "discussion.",
    actionToolsEnabled: false,
  },
}

/**
 * Action context shape — what flows into Genkit's `chat({ context })` and
 * shows up as the second argument of every tool handler. Includes:
 *
 *   - `auth`     — verified Firebase identity (already gated at the
 *                  callable boundary; tools use it for uid-scoped reads).
 *   - `mode`     — current chat mode, for capability gating inside tools.
 *   - `teamId` / `workspaceId` — the workspace the chat is bound to. Used
 *                  by workspace-aware tools like `searchWorkspaceNodes`
 *                  to scope retrieval (the model can't override these).
 *   - `googleProviderEnabled` — whether Google-backed tools such as
 *                  workspace semantic search are allowed for this team.
 *
 * Add fields here when introducing context-aware features.
 */
interface BotActionContext {
  auth?: { uid: string }
  mode: BotChatMode
  teamId: string
  workspaceId: string
  googleProviderEnabled: boolean
}

// ===========================================================================
// Tools — exposed to the model via Genkit's tool-calling protocol.
// ===========================================================================
//
// Each tool's input/output is Zod-validated, which doubles as the schema
// the model sees: tighter constraints (enums, min/max) get baked into the
// model's tool catalog and steer it toward valid calls. Handlers run
// server-side inside the Genkit chat loop — the model receives only the
// `outputSchema` shape, never the implementation.
//
// These two are deliberately demo-grade (mirroring the public Genkit
// example at https://examples.genkit.dev/tool-calling). They prove out the
// streaming + UI plumbing end-to-end and serve as the template for real
// workspace-aware tools (e.g. "search this team's nodes", "open node X").

const WEATHER_CONDITIONS = ["sunny", "cloudy", "rainy", "snowy"] as const

const getWeatherTool = ai.defineTool(
  {
    name: "getWeather",
    description:
      "Get the current weather for a location. Returns a temperature in " +
      "Fahrenheit, a high-level condition, and (in agent mode) an extra " +
      "advisory string.",
    inputSchema: z.object({
      location: z
        .string()
        .min(1)
        .describe("City or place name, e.g. 'Tokyo' or 'San Francisco'."),
    }),
    outputSchema: z.object({
      temperature: z.number(),
      condition: z.enum(WEATHER_CONDITIONS),
      advisory: z.string().optional(),
    }),
  },
  // The second handler arg carries the action context passed via
  // `chat({ context })`. Reading `context.mode` lets the tool tailor its
  // output deterministically — the model can't talk it out of this
  // (whatever the user types, the tool runs the same code path).
  async (_input, { context }) => {
    const mode = (context as BotActionContext | undefined)?.mode ?? "auto"
    const condition =
      WEATHER_CONDITIONS[Math.floor(Math.random() * WEATHER_CONDITIONS.length)]
    const temperature = 50 + Math.floor(Math.random() * 30)
    return {
      temperature,
      condition,
      // Agent mode wants thorough output; auto/manual stay terse.
      advisory:
        mode === "agent"
          ? `Feels ${condition}. Pack a layer if heading out.`
          : undefined,
    }
  }
)

const rollDiceTool = ai.defineTool(
  {
    name: "rollDice",
    description: "Roll a six-sided die. Returns an integer from 1 to 6.",
    inputSchema: z.object({}),
    outputSchema: z.number().int().min(1).max(6),
  },
  async () => Math.floor(Math.random() * 6) + 1
)

// ===========================================================================
// Interrupts — Human-in-the-Loop
// ===========================================================================
//
// `defineInterrupt` is Genkit's HITL primitive: instead of running a
// handler, calling the tool *pauses* the chat and surfaces the request
// back to the application. The user supplies the response via
// `chat.sendStream({ resume: { respond: [askQuestion.respond(part, ans)] } })`,
// at which point the model's generation continues with the answer
// folded into context.
//
// The interrupt tool's `outputSchema` describes what the *user* sends
// back (what the model will see as the tool's "result"), not what a
// handler returns — there is no handler.

const askQuestionInputSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe("The clarifying question to put to the user."),
  choices: z
    .array(z.string().min(1))
    .min(1)
    .describe("Concrete options the user can pick. Two to five short answers."),
  allowOther: z
    .boolean()
    .optional()
    .describe(
      "When true, the user may type a free-form answer instead of " +
        "picking one of `choices`."
    ),
})

const askQuestionOutputSchema = z.object({
  answer: z
    .string()
    .min(1)
    .describe(
      "The user's answer — either one of `choices` or, if `allowOther` " +
        "was true, a free-form string."
    ),
})

const askQuestionTool = ai.defineInterrupt({
  name: "askQuestion",
  description:
    "Ask the user a clarifying question with a small set of choices. " +
    "Use this when you need a decision from the user to proceed and " +
    "guessing would be worse than asking. The chat pauses until the " +
    "user picks; you'll see their answer as the tool's output and can " +
    "continue from there.",
  inputSchema: askQuestionInputSchema,
  outputSchema: askQuestionOutputSchema,
})

/**
 * Names of interrupt tools — used by the streaming + persistence layer
 * to flag tool segments that the client should render as interactive
 * forms instead of "Running…" spinners. Hardcoded (rather than derived
 * from the tool actions) because the model wire-name is the canonical
 * identifier and we don't want to reach into Genkit's internal action
 * shape. Add new interrupt tool names here as they're defined.
 */
const INTERRUPT_TOOL_NAMES = new Set<string>(["askQuestion"])

// ===========================================================================
// Team agent configuration
// ===========================================================================
//
// Each team has one agent config doc at
//   teams/{teamId}/settings/agent
//
// All workspaces in the team share that config — the bot is a team-level
// concern, not a per-workspace one. The doc is read on every chat turn
// (one extra Firestore read per send — negligible against model latency)
// and used to drive:
//   - provider availability (Google / Anthropic / OpenAI)
//   - the model passed to `session.chat({ model })`
//   - the system prompt (base + per-mode suffix)
//   - generation knobs (temperature, topP, topK, maxOutputTokens)
//   - tool exposure (each side-effecting tool can be flipped off)
//   - title/preview truncation lengths used by the SessionStore on save
//
// Missing or partially-set docs fall back to `DEFAULT_BOT_AGENT_CONFIG`
// field-by-field, so teams without a config doc keep working without a
// migration. Only owners + admins can write the doc; every team member
// can read it.

const BOT_MODEL_PROVIDERS = ["google", "anthropic", "openai"] as const

type BotModelProvider = (typeof BOT_MODEL_PROVIDERS)[number]

/**
 * Allowlist of model wire-names spanning all three providers (Google,
 * Anthropic, OpenAI). Picked manually so a typo in the settings UI can't
 * route a chat to a non-existent or private model; the Zod enum on the
 * update path enforces the same set.
 *
 * Prefix conventions are also load-bearing — `resolveModel(name)` in
 * `genkitClient.ts` dispatches by prefix (`gemini-*`, `claude-*`,
 * `gpt-*`/`o1-*`/`o3-*`). Adding a model here that doesn't match one of
 * those prefixes will throw at chat time. To add a new family, extend
 * `resolveModel` first, then this list.
 */
const BOT_AGENT_MODELS = [
  // Google Gemini
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  // Anthropic Claude
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  // OpenAI
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
] as const

type BotAgentModel = (typeof BOT_AGENT_MODELS)[number]
const DEFAULT_BOT_AGENT_MODEL: BotAgentModel = BOT_AGENT_MODELS[0]

const BOT_MODEL_PROVIDER_BY_MODEL: Record<BotAgentModel, BotModelProvider> = {
  "gemini-3-flash-preview": "google",
  "gemini-2.5-pro": "google",
  "gemini-2.5-flash": "google",
  "gemini-2.5-flash-lite": "google",
  "gemini-2.0-flash": "google",
  "gemini-2.0-flash-lite": "google",
  "claude-opus-4-5": "anthropic",
  "claude-sonnet-4-5": "anthropic",
  "claude-haiku-4-5": "anthropic",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "gpt-4-turbo": "openai",
}

const DEFAULT_BOT_AGENT_PROVIDERS: Record<BotModelProvider, boolean> = {
  google: true,
  anthropic: true,
  openai: true,
}

interface BotAgentToolToggles {
  getWeather: boolean
  rollDice: boolean
  /**
   * Interrupt tool. Defaults to true; turning it off forces the model to
   * commit to a guess instead of asking — useful when the workspace
   * wants strictly non-interactive replies (e.g. background jobs).
   */
  askQuestion: boolean
  /**
   * Semantic search over workspace nodes (RAG). Read-only so it's
   * exposed in every mode, including `manual`. Disable to keep chats
   * grounded only in the user's explicitly-attached context.
   */
  searchWorkspaceNodes: boolean
  /**
   * Structured-output summarization of a workspace node. Read-only so
   * it's exposed in every mode. Mirrors the inspector's "Generate
   * summary" button — disable to remove the chat-driven route only.
   */
  summarizeNode: boolean
}

interface BotAgentConfig {
  /** Provider availability policy for this team. */
  providers: Record<BotModelProvider, boolean>
  model: BotAgentModel
  /** [0, 2]; lower = more deterministic. */
  temperature: number
  /** [0, 1]; nucleus sampling cutoff. */
  topP: number
  /** [1, 100]; top-K sampling cutoff. */
  topK: number
  /** Hard cap on the model's reply length, in tokens. */
  maxOutputTokens: number
  /** Pre-selected mode for new chats; the composer can override per-turn. */
  defaultMode: BotChatMode
  /** Workspace-level system prompt; mode-specific suffix appended at runtime. */
  systemPromptBase: string
  /** One suffix per chat mode — appended after `systemPromptBase`. */
  promptSuffixes: Record<BotChatMode, string>
  /** Per-tool feature flags. Disabled tools are simply not registered. */
  tools: BotAgentToolToggles
  /** Truncation length for the auto-derived chat title (set on creation). */
  titleMaxLength: number
  /** Truncation length for the sidebar preview (re-derived every save). */
  previewMaxLength: number
}

const DEFAULT_BOT_AGENT_CONFIG: BotAgentConfig = {
  providers: { ...DEFAULT_BOT_AGENT_PROVIDERS },
  model: DEFAULT_BOT_AGENT_MODEL,
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 2048,
  defaultMode: "auto",
  systemPromptBase:
    "You are a helpful assistant for the user's team workspace.",
  promptSuffixes: {
    auto: MODE_CONFIG.auto.promptSuffix,
    agent: MODE_CONFIG.agent.promptSuffix,
    manual: MODE_CONFIG.manual.promptSuffix,
  },
  tools: {
    getWeather: true,
    rollDice: true,
    askQuestion: true,
    searchWorkspaceNodes: true,
    summarizeNode: true,
  },
  titleMaxLength: TITLE_MAX_LENGTH,
  previewMaxLength: PREVIEW_MAX_LENGTH,
}

const cloneDefaultBotAgentConfig = (): BotAgentConfig => ({
  ...DEFAULT_BOT_AGENT_CONFIG,
  providers: { ...DEFAULT_BOT_AGENT_CONFIG.providers },
  promptSuffixes: { ...DEFAULT_BOT_AGENT_CONFIG.promptSuffixes },
  tools: { ...DEFAULT_BOT_AGENT_CONFIG.tools },
})

/**
 * Bounds enforced both client-side (slider min/max) and server-side
 * (zod refines). Centralizing here keeps the two sides honest — change
 * a bound and both error messages move together.
 */
const BOT_AGENT_BOUNDS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  topK: { min: 1, max: 100 },
  maxOutputTokens: { min: 256, max: 65536 },
  systemPromptBase: { max: 4000 },
  promptSuffix: { max: 2000 },
  titleMaxLength: { min: 20, max: 200 },
  previewMaxLength: { min: 50, max: 500 },
} as const

const botAgentConfigUpdateSchema = z.object({
  providers: z
    .object({
      google: z.boolean(),
      anthropic: z.boolean(),
      openai: z.boolean(),
    })
    .partial()
    .optional(),
  model: z.enum(BOT_AGENT_MODELS).optional(),
  temperature: z
    .number()
    .min(BOT_AGENT_BOUNDS.temperature.min)
    .max(BOT_AGENT_BOUNDS.temperature.max)
    .optional(),
  topP: z
    .number()
    .min(BOT_AGENT_BOUNDS.topP.min)
    .max(BOT_AGENT_BOUNDS.topP.max)
    .optional(),
  topK: z
    .number()
    .int()
    .min(BOT_AGENT_BOUNDS.topK.min)
    .max(BOT_AGENT_BOUNDS.topK.max)
    .optional(),
  maxOutputTokens: z
    .number()
    .int()
    .min(BOT_AGENT_BOUNDS.maxOutputTokens.min)
    .max(BOT_AGENT_BOUNDS.maxOutputTokens.max)
    .optional(),
  defaultMode: z.enum(BOT_CHAT_MODES).optional(),
  systemPromptBase: z
    .string()
    .max(BOT_AGENT_BOUNDS.systemPromptBase.max)
    .optional(),
  promptSuffixes: z
    .object({
      auto: z.string().max(BOT_AGENT_BOUNDS.promptSuffix.max),
      agent: z.string().max(BOT_AGENT_BOUNDS.promptSuffix.max),
      manual: z.string().max(BOT_AGENT_BOUNDS.promptSuffix.max),
    })
    .partial()
    .optional(),
  tools: z
    .object({
      getWeather: z.boolean(),
      rollDice: z.boolean(),
      askQuestion: z.boolean(),
      searchWorkspaceNodes: z.boolean(),
      summarizeNode: z.boolean(),
    })
    .partial()
    .optional(),
  titleMaxLength: z
    .number()
    .int()
    .min(BOT_AGENT_BOUNDS.titleMaxLength.min)
    .max(BOT_AGENT_BOUNDS.titleMaxLength.max)
    .optional(),
  previewMaxLength: z
    .number()
    .int()
    .min(BOT_AGENT_BOUNDS.previewMaxLength.min)
    .max(BOT_AGENT_BOUNDS.previewMaxLength.max)
    .optional(),
})

type BotAgentConfigUpdate = z.infer<typeof botAgentConfigUpdateSchema>

const agentConfigDocPath = (teamId: string) => `teams/${teamId}/settings/agent`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasEnabledProvider(
  providers: Record<BotModelProvider, boolean>
): boolean {
  return BOT_MODEL_PROVIDERS.some((provider) => providers[provider])
}

function normalizeProviderToggles(
  raw: unknown
): Record<BotModelProvider, boolean> {
  const rawProviders = isRecord(raw) ? raw : {}
  const providers: Record<BotModelProvider, boolean> = {
    ...DEFAULT_BOT_AGENT_PROVIDERS,
  }

  for (const provider of BOT_MODEL_PROVIDERS) {
    if (typeof rawProviders[provider] === "boolean") {
      providers[provider] = rawProviders[provider]
    }
  }

  return hasEnabledProvider(providers)
    ? providers
    : { ...DEFAULT_BOT_AGENT_PROVIDERS }
}

function firstModelForEnabledProviders(
  providers: Record<BotModelProvider, boolean>
): BotAgentModel {
  return (
    BOT_AGENT_MODELS.find(
      (model) => providers[BOT_MODEL_PROVIDER_BY_MODEL[model]]
    ) ?? DEFAULT_BOT_AGENT_CONFIG.model
  )
}

function assertEnabledProvidersConfigured(
  providers: Record<BotModelProvider, boolean>
): void {
  for (const provider of BOT_MODEL_PROVIDERS) {
    if (providers[provider]) {
      assertAiModelProviderConfigured(provider)
    }
  }
}

/**
 * Merge a partial doc payload onto `DEFAULT_BOT_AGENT_CONFIG` so the
 * caller always sees a fully-populated config — even for workspaces
 * that have only ever set one field (e.g. just `model`). Unknown keys
 * on the doc are dropped here rather than re-validated; the update
 * callable is the gate that enforces shape.
 */
function applyAgentConfigOverrides(
  raw: Record<string, unknown> | undefined
): BotAgentConfig {
  if (!raw) return cloneDefaultBotAgentConfig()

  const providers = normalizeProviderToggles(raw.providers)
  const configuredModel =
    typeof raw.model === "string" &&
    (BOT_AGENT_MODELS as readonly string[]).includes(raw.model)
      ? (raw.model as BotAgentModel)
      : DEFAULT_BOT_AGENT_CONFIG.model
  const model = providers[BOT_MODEL_PROVIDER_BY_MODEL[configuredModel]]
    ? configuredModel
    : firstModelForEnabledProviders(providers)

  const numberOrDefault = (
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback
    return Math.min(Math.max(value, min), max)
  }

  const intOrDefault = (
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback
    return Math.min(Math.max(Math.round(value), min), max)
  }

  const stringOrDefault = (
    value: unknown,
    fallback: string,
    max: number
  ): string => {
    if (typeof value !== "string") return fallback
    return value.slice(0, max)
  }

  const rawSuffixes = (raw.promptSuffixes ?? {}) as Record<string, unknown>
  const promptSuffixes: Record<BotChatMode, string> = {
    auto: stringOrDefault(
      rawSuffixes.auto,
      DEFAULT_BOT_AGENT_CONFIG.promptSuffixes.auto,
      BOT_AGENT_BOUNDS.promptSuffix.max
    ),
    agent: stringOrDefault(
      rawSuffixes.agent,
      DEFAULT_BOT_AGENT_CONFIG.promptSuffixes.agent,
      BOT_AGENT_BOUNDS.promptSuffix.max
    ),
    manual: stringOrDefault(
      rawSuffixes.manual,
      DEFAULT_BOT_AGENT_CONFIG.promptSuffixes.manual,
      BOT_AGENT_BOUNDS.promptSuffix.max
    ),
  }

  const rawTools = (raw.tools ?? {}) as Record<string, unknown>
  const tools: BotAgentToolToggles = {
    getWeather:
      typeof rawTools.getWeather === "boolean"
        ? rawTools.getWeather
        : DEFAULT_BOT_AGENT_CONFIG.tools.getWeather,
    rollDice:
      typeof rawTools.rollDice === "boolean"
        ? rawTools.rollDice
        : DEFAULT_BOT_AGENT_CONFIG.tools.rollDice,
    askQuestion:
      typeof rawTools.askQuestion === "boolean"
        ? rawTools.askQuestion
        : DEFAULT_BOT_AGENT_CONFIG.tools.askQuestion,
    searchWorkspaceNodes:
      typeof rawTools.searchWorkspaceNodes === "boolean"
        ? rawTools.searchWorkspaceNodes
        : DEFAULT_BOT_AGENT_CONFIG.tools.searchWorkspaceNodes,
    summarizeNode:
      typeof rawTools.summarizeNode === "boolean"
        ? rawTools.summarizeNode
        : DEFAULT_BOT_AGENT_CONFIG.tools.summarizeNode,
  }

  const defaultMode =
    typeof raw.defaultMode === "string" &&
    (BOT_CHAT_MODES as readonly string[]).includes(raw.defaultMode)
      ? (raw.defaultMode as BotChatMode)
      : DEFAULT_BOT_AGENT_CONFIG.defaultMode

  return {
    providers,
    model,
    temperature: numberOrDefault(
      raw.temperature,
      DEFAULT_BOT_AGENT_CONFIG.temperature,
      BOT_AGENT_BOUNDS.temperature.min,
      BOT_AGENT_BOUNDS.temperature.max
    ),
    topP: numberOrDefault(
      raw.topP,
      DEFAULT_BOT_AGENT_CONFIG.topP,
      BOT_AGENT_BOUNDS.topP.min,
      BOT_AGENT_BOUNDS.topP.max
    ),
    topK: intOrDefault(
      raw.topK,
      DEFAULT_BOT_AGENT_CONFIG.topK,
      BOT_AGENT_BOUNDS.topK.min,
      BOT_AGENT_BOUNDS.topK.max
    ),
    maxOutputTokens: intOrDefault(
      raw.maxOutputTokens,
      DEFAULT_BOT_AGENT_CONFIG.maxOutputTokens,
      BOT_AGENT_BOUNDS.maxOutputTokens.min,
      BOT_AGENT_BOUNDS.maxOutputTokens.max
    ),
    defaultMode,
    systemPromptBase: stringOrDefault(
      raw.systemPromptBase,
      DEFAULT_BOT_AGENT_CONFIG.systemPromptBase,
      BOT_AGENT_BOUNDS.systemPromptBase.max
    ),
    promptSuffixes,
    tools,
    titleMaxLength: intOrDefault(
      raw.titleMaxLength,
      DEFAULT_BOT_AGENT_CONFIG.titleMaxLength,
      BOT_AGENT_BOUNDS.titleMaxLength.min,
      BOT_AGENT_BOUNDS.titleMaxLength.max
    ),
    previewMaxLength: intOrDefault(
      raw.previewMaxLength,
      DEFAULT_BOT_AGENT_CONFIG.previewMaxLength,
      BOT_AGENT_BOUNDS.previewMaxLength.min,
      BOT_AGENT_BOUNDS.previewMaxLength.max
    ),
  }
}

/**
 * Load the effective agent config for a team. Exported so sibling
 * sub-flows (e.g. `botSummarize.ts`) can use the team's chosen model +
 * generation knobs without duplicating the Firestore read + merge
 * logic.
 */
export async function loadTeamAgentConfig(
  teamId: string
): Promise<BotAgentConfig> {
  const snap = await db.doc(agentConfigDocPath(teamId)).get()
  if (!snap.exists) return cloneDefaultBotAgentConfig()
  return applyAgentConfigOverrides(snap.data())
}

/** Build the system prompt from the loaded config + the active mode. */
function buildSystemPromptFromConfig(
  config: BotAgentConfig,
  mode: BotChatMode
): string {
  return `${config.systemPromptBase}\n\n${config.promptSuffixes[mode]}`
}

// ===========================================================================
// Node-context loading — fetch attached workspace nodes and their
// attachments, then format them as a markdown block to append to the
// per-turn system prompt.
// ===========================================================================

interface NodeContextAttachment {
  name: string
  mimeType: string | null
  size: number | null
  content?: string
  contentTruncated?: boolean
}

interface NodeContextEntry {
  scope: "code" | "write"
  nodeId: string
  name: string
  type: "folder" | "file"
  content?: string
  contentTruncated?: boolean
  attachments: NodeContextAttachment[]
}

function isTextLikeMime(mime: string | null | undefined): boolean {
  if (!mime) return false
  return TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
}

/**
 * Resolve one `{scope, nodeId}` ref into a self-contained context entry:
 * the node's metadata + content + attachment list (with text-like
 * attachment bodies inlined under `MAX_ATTACHMENT_INLINE_BYTES`).
 *
 * Returns `null` when the node doesn't exist or is archived — callers
 * filter nulls instead of failing the whole turn, so a stale attachment
 * chip in the UI doesn't block the user's send.
 */
async function fetchNodeContext(
  teamId: string,
  workspaceId: string,
  ref: NodeRef
): Promise<NodeContextEntry | null> {
  const nodeSnap = await db
    .doc(`teams/${teamId}/workspaces/${workspaceId}/${ref.scope}/${ref.nodeId}`)
    .get()
  if (!nodeSnap.exists) return null
  const data = nodeSnap.data() ?? {}
  if (data.isArchived === true) return null

  const type =
    data.type === "folder" || data.type === "file"
      ? (data.type as "folder" | "file")
      : "file"
  const name = typeof data.name === "string" ? data.name : ref.nodeId

  const rawContent = typeof data.content === "string" ? data.content : ""
  let content: string | undefined
  let contentTruncated = false
  if (rawContent.length > 0) {
    if (rawContent.length > MAX_NODE_CONTENT_BYTES) {
      content = rawContent.slice(0, MAX_NODE_CONTENT_BYTES)
      contentTruncated = true
    } else {
      content = rawContent
    }
  }

  // Attachments live in a subcollection alongside the node doc. We pull
  // metadata for every attachment and inline content for the small
  // text-like ones — binaries (images, PDFs, archives) get name + mime +
  // size only, which is enough for the model to acknowledge them.
  const attachmentsSnap = await db
    .collection(
      `teams/${teamId}/workspaces/${workspaceId}/${ref.scope}/${ref.nodeId}/attachments`
    )
    .get()

  const attachments: NodeContextAttachment[] = []
  for (const attSnap of attachmentsSnap.docs) {
    const att = attSnap.data() ?? {}
    const mimeType = typeof att.mimeType === "string" ? att.mimeType : null
    const size = typeof att.size === "number" ? att.size : null
    const storagePath =
      typeof att.storagePath === "string" ? att.storagePath : null
    const displayName =
      typeof att.displayName === "string" && att.displayName
        ? att.displayName
        : "attachment"

    let attContent: string | undefined
    let attTruncated = false
    if (
      storagePath &&
      isTextLikeMime(mimeType) &&
      (size === null || size <= MAX_ATTACHMENT_INLINE_BYTES)
    ) {
      try {
        const [buffer] = await admin
          .storage()
          .bucket()
          .file(storagePath)
          .download()
        const text = buffer.toString("utf8")
        if (text.length > MAX_ATTACHMENT_INLINE_BYTES) {
          attContent = text.slice(0, MAX_ATTACHMENT_INLINE_BYTES)
          attTruncated = true
        } else {
          attContent = text
        }
      } catch {
        // Storage read failed — fall through with metadata only so the
        // model still knows the attachment exists.
      }
    }

    attachments.push({
      name: displayName,
      mimeType,
      size,
      ...(attContent !== undefined ? { content: attContent } : {}),
      ...(attTruncated ? { contentTruncated: true } : {}),
    })
  }

  return {
    scope: ref.scope,
    nodeId: ref.nodeId,
    name,
    type,
    ...(content !== undefined ? { content } : {}),
    ...(contentTruncated ? { contentTruncated: true } : {}),
    attachments,
  }
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown size"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Pick a code-fence length that the content can't escape. CommonMark
 * requires the closing fence to have at least as many backticks as the
 * opening, so by scanning for the longest backtick run inside `content`
 * and using one more, we guarantee no malicious file can prematurely
 * close the fence and inject text at the system-prompt level.
 *
 * Without this, a node whose body contained ``` would terminate the
 * fence and the model would see whatever followed as bare system-prompt
 * text — a high-trust position the user shouldn't be able to reach
 * through file content.
 */
function pickCodeFence(content: string): string {
  let longestRun = 0
  let currentRun = 0
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 0x60 /* ` */) {
      currentRun += 1
      if (currentRun > longestRun) longestRun = currentRun
    } else {
      currentRun = 0
    }
  }
  return "`".repeat(Math.max(3, longestRun + 1))
}

/**
 * Render a set of node-context entries as a markdown block appended to
 * the per-turn system prompt. Returns "" when no entries — the caller
 * uses the empty string to skip the join and keep the system prompt
 * byte-identical to the no-context path.
 */
function buildContextPromptBlock(entries: NodeContextEntry[]): string {
  if (entries.length === 0) return ""

  const lines: string[] = [
    "# Attached workspace context",
    "",
    "The user attached the following workspace items as context for this " +
      "turn. Treat them as ground truth when relevant. Quote sparingly; " +
      "summarize when paraphrasing is clearer.",
    "",
  ]

  for (const entry of entries) {
    const scopeLabel = entry.scope === "code" ? "Code" : "Write"
    lines.push(`## ${scopeLabel} ${entry.type}: ${entry.name}`)
    // Surface scope + nodeId so tools that take a node ref
    // (e.g. `summarizeNode`) can be invoked against an attached node.
    // The model uses these IDs to call the tool; the user just sees the
    // friendly heading above. Kept on a single subtle line so it doesn't
    // crowd the rendered prompt for the model.
    lines.push(`_node ref: scope=\`${entry.scope}\`, id=\`${entry.nodeId}\`_`)
    if (entry.type === "folder") {
      lines.push("_(folder — no inline content)_")
    } else if (entry.content) {
      const fence = pickCodeFence(entry.content)
      lines.push(fence, entry.content, fence)
      if (entry.contentTruncated) lines.push("_(content truncated)_")
    } else {
      lines.push("_(empty file)_")
    }

    if (entry.attachments.length > 0) {
      lines.push("", "### Attachments")
      for (const att of entry.attachments) {
        lines.push(
          `- **${att.name}** — ${att.mimeType ?? "unknown type"}, ${formatBytes(att.size)}`
        )
        if (att.content) {
          // Fence is sized against the raw content so even an attachment
          // body packed with backticks can't close the block prematurely.
          // Indentation here is purely cosmetic (nests under the bullet)
          // and doesn't factor into the fence-escape safety.
          const fence = pickCodeFence(att.content)
          const indented = att.content.replace(/\n/g, "\n  ")
          lines.push(`  ${fence}`, `  ${indented}`, `  ${fence}`)
          if (att.contentTruncated) lines.push("  _(content truncated)_")
        }
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Fetch context entries for every requested ref. Sequential to keep
 * memory + concurrent Storage requests bounded — with `CONTEXT_NODE_MAX = 10`
 * the wall-clock cost is still dwarfed by model latency.
 */
async function loadContextEntries(
  teamId: string,
  workspaceId: string,
  refs: readonly NodeRef[]
): Promise<NodeContextEntry[]> {
  const entries: NodeContextEntry[] = []
  for (const ref of refs) {
    const entry = await fetchNodeContext(teamId, workspaceId, ref)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * Deterministic Firestore-queryable key for a (user, node) pin. Written
 * once on session creation to power `findBotSessionByPinnedNode`'s
 * indexed lookup. The pin's `scope`/`nodeId` are not stored as their
 * own field — they live as a normal entry inside `contextNodes`.
 */
function pinnedNodeKey(
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
function pickChatTools(config: BotAgentConfig, mode: BotChatMode) {
  const modeAllowsActionTools = MODE_CONFIG[mode].actionToolsEnabled
  const googleBackedSearchAvailable =
    config.providers.google && isAiModelProviderConfigured("google")
  const tools = []
  if (modeAllowsActionTools && config.tools.getWeather)
    tools.push(getWeatherTool)
  if (modeAllowsActionTools && config.tools.rollDice) tools.push(rollDiceTool)
  if (config.tools.askQuestion) tools.push(askQuestionTool)
  if (config.tools.searchWorkspaceNodes && googleBackedSearchAvailable)
    tools.push(searchWorkspaceNodesTool)
  if (config.tools.summarizeNode) tools.push(summarizeNodeTool)
  return tools
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

function isAdminRole(role: IMembershipRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role)
}

interface BotSessionDocSummary {
  ownerUid: string
  visibility: SessionVisibility
  archived: boolean
  data?: SessionData
}

/** Load a session doc and normalize visibility (absent ⇒ "private"). */
async function readSessionDoc(
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
  return {
    ownerUid: data.ownerUid as string,
    visibility,
    archived: !!data.archivedAt,
    data: data.data as SessionData | undefined,
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
// `CONTEXT_NODE_MAX` caps prompt size; without it a misbehaving client
// could attach hundreds of files per turn and blow past the model's
// context window (and our token budget).

const CONTEXT_NODE_MAX = 10
const MAX_NODE_CONTENT_BYTES = 100_000
const MAX_ATTACHMENT_INLINE_BYTES = 50_000
const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
]

const NodeRefSchema = z.object({
  scope: z.enum(["code", "write"]),
  nodeId: z.string().min(1),
})
type NodeRef = z.infer<typeof NodeRefSchema>

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
 * `preSentToolResults` lets a caller pre-mark refs as "already emitted"
 * — used by `respondToBotInterruptFlow` to avoid double-emitting the
 * just-resolved interrupt's toolResult after the resume kicks off.
 *
 * Returns the resolved final response so the caller can use
 * `final.text` for the unary reply.
 */
async function streamChatToClient(
  result: ChatStreamResult,
  sendChunk: (chunk: SendBotMessageStreamPayload) => void,
  options: { preSentToolResults?: Iterable<string> } = {}
): Promise<Awaited<ChatStreamResult["response"]>> {
  const sentToolCalls = new Set<string>()
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

  const final = await result.response

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

    const { teamId, workspaceId, sessionId, mode } = input
    const role = await getMembershipRole(teamId, auth.uid)

    // For existing sessions, enforce edit permission. The owner always has
    // edit; for shared sessions, team admins also have edit. Archived
    // sessions reject sends regardless of role — archiving is a soft
    // "read-only" flag the user (or an admin) sets. New sessions (no
    // sessionId yet) default to private and the caller is the owner-to-be.
    if (sessionId) {
      const existing = await readSessionDoc(teamId, workspaceId, sessionId)
      if (!existing) {
        throw new HttpsError("not-found", "Session not found.")
      }
      if (existing.archived) {
        throw new HttpsError(
          "failed-precondition",
          "This chat is archived. Restore it before sending new messages."
        )
      }
      const isOwner = existing.ownerUid === auth.uid
      const canEdit =
        isOwner || (existing.visibility === "shared" && isAdminRole(role))
      if (!canEdit) {
        throw new HttpsError(
          "permission-denied",
          "You don't have permission to send messages in this chat."
        )
      }
    }

    // Load the team's agent config — drives model, prompt, tools,
    // generation knobs, and the SessionStore's title/preview lengths.
    // One Firestore read per turn (negligible against model latency); we
    // intentionally don't cache because admins changing settings should
    // see their changes apply on the next send, not after a deploy.
    const agentConfig = await loadTeamAgentConfig(teamId)

    // Resolve the effective session id. Resumed chats reuse their
    // existing id; fresh sends create a new session. A `pinnedNode`
    // on a fresh send creates ANOTHER pinned chat for the same
    // (user, node) pair — multiple pins per node are intentional so
    // a "new chat" button in the node inspector can spin up a fresh
    // conversation while preserving the prior one in history.
    const effectiveSessionId: string | null = sessionId ?? null

    // The pinned-node key flows into the store only when we're about
    // to create a brand-new session. The store writes it when `isNew`
    // and never again — dropping it on resumed sessions keeps the
    // invariant "pinnedNodeKey → exactly one new session" crisp.
    const newSessionPinnedNodeKey =
      !effectiveSessionId && input.pinnedNode
        ? pinnedNodeKey(
            auth.uid,
            input.pinnedNode.scope,
            input.pinnedNode.nodeId
          )
        : undefined

    const store = new FirestoreBotSessionStore(
      teamId,
      workspaceId,
      auth.uid,
      agentConfig.titleMaxLength,
      agentConfig.previewMaxLength,
      newSessionPinnedNodeKey,
      input.contextNodes,
      mode,
      auth.uid
    )

    const session = effectiveSessionId
      ? await ai.loadSession(effectiveSessionId, { store })
      : ai.createSession({ store })

    // Resolve attached workspace nodes into a context block for the
    // system prompt. Missing/archived nodes are silently skipped so a
    // stale chip in the client UI doesn't surface as a hard error mid-
    // conversation. With `CONTEXT_NODE_MAX = 10` this is bounded.
    const contextEntries = await loadContextEntries(
      teamId,
      workspaceId,
      input.contextNodes
    )
    const contextBlock = buildContextPromptBlock(contextEntries)

    // Build the action context for this turn. `auth` mirrors the existing
    // verified Firebase identity; `mode` is the per-turn capability gate
    // chosen in the composer dropdown; `teamId`/`workspaceId` scope any
    // workspace-aware tool (e.g. `searchWorkspaceNodes`) to the calling
    // user's workspace — the model controls only the query, not the
    // collection. Tools get the full object via their second handler arg.
    const actionContext: BotActionContext = {
      auth: { uid: auth.uid },
      mode,
      teamId,
      workspaceId,
      googleProviderEnabled:
        agentConfig.providers.google && isAiModelProviderConfigured("google"),
    }

    // `manual` strips action tools so even a jailbroken prompt can't get
    // the model to invoke side-effectful tools — the model literally has
    // no actions registered for the call. Interrupt tools (just clarifying
    // questions) stay available because they're conversational, not
    // actions. Per-workspace tool toggles further strip individual tools.
    const chatTools = pickChatTools(agentConfig, mode)

    // System prompt is mode-aware AND context-augmented. We set it on
    // every turn (including resumed sessions) so a user who flips modes
    // or removes attached nodes mid-conversation immediately gets the
    // new behavior. Genkit replaces the system segment when one is
    // provided to chat() — earlier turns aren't rewritten on disk, but
    // the active turn picks it up. Model + gen config are also
    // workspace-scoped overrides; admins can swap models without
    // touching the source.
    const baseSystem = buildSystemPromptFromConfig(agentConfig, mode)
    const systemPrompt = contextBlock
      ? `${baseSystem}\n\n${contextBlock}`
      : baseSystem

    const chat = session.chat({
      model: resolveModel(agentConfig.model),
      system: systemPrompt,
      tools: chatTools,
      context: actionContext,
      config: {
        temperature: agentConfig.temperature,
        topP: agentConfig.topP,
        topK: agentConfig.topK,
        maxOutputTokens: agentConfig.maxOutputTokens,
      },
    })

    // Emit the session id before we touch the model. For brand-new sessions
    // this lets the client update the URL immediately; for resumed sessions
    // it's a redundant confirmation but harmless.
    sendChunk({ sessionId: session.id })

    const final = await streamChatToClient(
      chat.sendStream(message) as ChatStreamResult,
      sendChunk
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
   * Same shape as `SendBotMessageInput.contextNodes` — passed through so
   * a chat that resumes from an interrupt keeps the attached files in
   * scope. Without this, the model would lose grounding the moment it
   * returned from a clarifying question.
   */
  contextNodes: z.array(NodeRefSchema).max(CONTEXT_NODE_MAX).default([]),
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

    const { teamId, workspaceId, sessionId, ref, name, response, mode } = input
    const role = await getMembershipRole(teamId, auth.uid)

    // Edit-permission gate — same shape as `sendBotMessage`. A non-owner
    // shouldn't be able to push the chat forward, only the owner / shared
    // admins. Archived sessions reject the resume entirely.
    const existing = await readSessionDoc(teamId, workspaceId, sessionId)
    if (!existing) {
      throw new HttpsError("not-found", "Session not found.")
    }
    if (existing.archived) {
      throw new HttpsError(
        "failed-precondition",
        "This chat is archived. Restore it before continuing."
      )
    }
    const isOwner = existing.ownerUid === auth.uid
    const canEdit =
      isOwner || (existing.visibility === "shared" && isAdminRole(role))
    if (!canEdit) {
      throw new HttpsError(
        "permission-denied",
        "You don't have permission to send messages in this chat."
      )
    }

    const agentConfig = await loadTeamAgentConfig(teamId)
    const store = new FirestoreBotSessionStore(
      teamId,
      workspaceId,
      auth.uid,
      agentConfig.titleMaxLength,
      agentConfig.previewMaxLength,
      // No pinnedNodeKey — interrupts always run on an existing
      // session, and the pin's index is set on creation only.
      // contextNodes flow through so the persisted chip list reflects
      // what the user sees in the composer right now.
      undefined,
      input.contextNodes,
      mode,
      // Interrupt response doesn't append a new user-role message
      // (it resolves a pending tool inside the same agent turn), so
      // the tagging loop in save() will no-op. Pass `auth.uid` anyway
      // for symmetry — costs nothing and keeps the call sites uniform.
      auth.uid
    )
    const session = await ai.loadSession(sessionId, { store })

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

    const actionContext: BotActionContext = {
      auth: { uid: auth.uid },
      mode,
      teamId,
      workspaceId,
      googleProviderEnabled:
        agentConfig.providers.google && isAiModelProviderConfigured("google"),
    }
    const chatTools = pickChatTools(agentConfig, mode)

    // Carry node context through the resume so the model still sees
    // attached files when it picks up after the interrupt.
    const contextEntries = await loadContextEntries(
      teamId,
      workspaceId,
      input.contextNodes
    )
    const contextBlock = buildContextPromptBlock(contextEntries)
    const baseSystem = buildSystemPromptFromConfig(agentConfig, mode)
    const systemPrompt = contextBlock
      ? `${baseSystem}\n\n${contextBlock}`
      : baseSystem

    // Resume: no new prompt, just the resolved interrupt fed back in.
    // Genkit appends the toolResponse to the message history and lets
    // the model continue.
    const chat = session.chat({
      model: resolveModel(agentConfig.model),
      system: systemPrompt,
      tools: chatTools,
      context: actionContext,
      config: {
        temperature: agentConfig.temperature,
        topP: agentConfig.topP,
        topK: agentConfig.topK,
        maxOutputTokens: agentConfig.maxOutputTokens,
      },
    })

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

    // Pre-mark the just-answered interrupt's ref so `streamChatToClient`'s
    // post-stream sweep doesn't double-emit a toolResult for it (the
    // `sendChunk` above already sent it). Keyed identically to the
    // helper's internal `refKey(..., "result", ...)` output.
    const preSent = interruptPart.toolRequest.ref
      ? [`result:${interruptPart.toolRequest.ref}`]
      : []

    const final = await streamChatToClient(
      chat.sendStream({
        resume: { respond: [respondPart] },
      }) as ChatStreamResult,
      sendChunk,
      { preSentToolResults: preSent }
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
// Read & metadata callables (loadBotSession, visibility, rename, archive,
// delete) — plain `onCall`, gated by `requireVerifiedAuth` + role checks.
// ===========================================================================

interface LoadBotSessionRequest {
  teamId: string
  workspaceId: string
  sessionId: string
}

interface LoadBotSessionResponse {
  sessionId: string
  /** Includes `segments` for agent messages with tool calls. */
  messages: ChatMessage[]
}

/**
 * Resume an existing session: fetches the persisted `SessionData` blob and
 * returns its main-thread messages so the client can render the prior
 * conversation. Allowed when the caller is the owner OR the session's
 * visibility is "shared" and the caller is a team member.
 */
export const loadBotSession = onCall<LoadBotSessionRequest>(
  {
    ...CALLABLE_OPTS,
    enforceAppCheck: true,
  },
  async (request): Promise<LoadBotSessionResponse> => {
    const auth = requireVerifiedAuth(request.auth)

    const { teamId, workspaceId, sessionId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.")
    }

    await getMembershipRole(teamId, auth.uid)

    const existing = await readSessionDoc(teamId, workspaceId, sessionId)
    if (!existing) {
      throw new HttpsError("not-found", "Session not found.")
    }

    const isOwner = existing.ownerUid === auth.uid
    const isShared = existing.visibility === "shared"
    if (!isOwner && !isShared) {
      throw new HttpsError(
        "permission-denied",
        "You don't have access to this chat."
      )
    }

    const messages = extractMessagesFromSessionData(existing.data)
    return { sessionId, messages }
  }
)

// ===========================================================================
// findBotSessionByPinnedNode — resolve the caller's chat that's pinned to
// a specific workspace node, if any.
// ===========================================================================
//
// The NodeInspectorSidebar's Bot tab calls this on open so each node has a
// stable, resumable chat per user. We key on `pinnedNodeKey` (a single
// composite string of `${ownerUid}:${scope}:${nodeId}`) so the query is a
// single equality clause — no composite index needed. Returns null when no
// session exists yet; the next `sendBotMessage` will create one with the
// matching `pinnedNode`.

interface FindBotSessionByPinnedNodeRequest {
  teamId: string
  workspaceId: string
  scope: "code" | "write"
  nodeId: string
}

interface FindBotSessionByPinnedNodeResponse {
  sessionId: string | null
}

export const findBotSessionByPinnedNode =
  onCall<FindBotSessionByPinnedNodeRequest>(
    {
      ...CALLABLE_OPTS,
      enforceAppCheck: true,
    },
    async (request): Promise<FindBotSessionByPinnedNodeResponse> => {
      const auth = requireVerifiedAuth(request.auth)
      const { teamId, workspaceId, scope, nodeId } = request.data ?? {}

      if (typeof teamId !== "string" || !teamId) {
        throw new HttpsError("invalid-argument", "teamId is required.")
      }
      if (typeof workspaceId !== "string" || !workspaceId) {
        throw new HttpsError("invalid-argument", "workspaceId is required.")
      }
      if (scope !== "code" && scope !== "write") {
        throw new HttpsError(
          "invalid-argument",
          'scope must be "code" or "write".'
        )
      }
      if (typeof nodeId !== "string" || !nodeId) {
        throw new HttpsError("invalid-argument", "nodeId is required.")
      }

      // Membership gate — non-members shouldn't even know whether the
      // session exists. We don't widen access for shared sessions here:
      // the Bot tab is a per-user "ask about this node" view; collab
      // chats live on the bot page's history sidebar.
      await getMembershipRole(teamId, auth.uid)

      // Multiple pinned chats can exist for the same (user, node) pair
      // — each "new chat" click in the inspector creates another. We
      // resume the most recently active one by default; the history
      // list in the inspector shows the rest.
      const snap = await db
        .collection(`teams/${teamId}/workspaces/${workspaceId}/botSessions`)
        .where("pinnedNodeKey", "==", pinnedNodeKey(auth.uid, scope, nodeId))
        .orderBy("updatedAt", "desc")
        .limit(1)
        .get()

      if (snap.empty) return { sessionId: null }
      return { sessionId: snap.docs[0].id }
    }
  )

interface UpdateBotSessionVisibilityRequest {
  teamId: string
  workspaceId: string
  sessionId: string
  visibility: SessionVisibility
}

interface UpdateBotSessionVisibilityResponse {
  sessionId: string
  visibility: SessionVisibility
}

/**
 * Change a session's visibility. Only the session owner or a team admin
 * can change it. The "public" mode is rejected here — its read path is
 * not yet implemented and we don't want orphaned-public sessions accruing.
 */
export const updateBotSessionVisibility =
  onCall<UpdateBotSessionVisibilityRequest>(
    {
      ...CALLABLE_OPTS,
      enforceAppCheck: true,
    },
    async (request): Promise<UpdateBotSessionVisibilityResponse> => {
      const auth = requireVerifiedAuth(request.auth)

      const { teamId, workspaceId, sessionId, visibility } = request.data ?? {}

      if (typeof teamId !== "string" || !teamId) {
        throw new HttpsError("invalid-argument", "teamId is required.")
      }
      if (typeof workspaceId !== "string" || !workspaceId) {
        throw new HttpsError("invalid-argument", "workspaceId is required.")
      }
      if (typeof sessionId !== "string" || !sessionId) {
        throw new HttpsError("invalid-argument", "sessionId is required.")
      }
      if (visibility !== "private" && visibility !== "shared") {
        throw new HttpsError(
          "invalid-argument",
          'visibility must be "private" or "shared".'
        )
      }

      const role = await getMembershipRole(teamId, auth.uid)
      const existing = await readSessionDoc(teamId, workspaceId, sessionId)
      if (!existing) {
        throw new HttpsError("not-found", "Session not found.")
      }

      const isOwner = existing.ownerUid === auth.uid
      const canChange = isOwner || isAdminRole(role)
      if (!canChange) {
        throw new HttpsError(
          "permission-denied",
          "Only the owner or a team admin can change visibility."
        )
      }

      await db
        .doc(
          `teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`
        )
        .set(
          {
            visibility,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        )

      return { sessionId, visibility }
    }
  )

// ===========================================================================
// CRUD: rename, archive, delete
// ===========================================================================

const TITLE_LIMIT = 120

interface SessionMutationBase {
  teamId: string
  workspaceId: string
  sessionId: string
}

/** Owner OR team admin can mutate (rename / archive / delete). */
async function assertCanMutate(
  teamId: string,
  workspaceId: string,
  sessionId: string,
  uid: string
): Promise<void> {
  const role = await getMembershipRole(teamId, uid)
  const existing = await readSessionDoc(teamId, workspaceId, sessionId)
  if (!existing) {
    throw new HttpsError("not-found", "Session not found.")
  }
  const isOwner = existing.ownerUid === uid
  if (!isOwner && !isAdminRole(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only the owner or a team admin can modify this chat."
    )
  }
}

interface RenameBotSessionRequest extends SessionMutationBase {
  title: string
}
interface RenameBotSessionResponse {
  sessionId: string
  title: string
}

export const renameBotSession = onCall<RenameBotSessionRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<RenameBotSessionResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, workspaceId, sessionId, title } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.")
    }
    if (typeof title !== "string" || !title.trim()) {
      throw new HttpsError("invalid-argument", "title is required.")
    }
    const trimmed = title.trim().slice(0, TITLE_LIMIT)

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .set(
        {
          title: trimmed,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return { sessionId, title: trimmed }
  }
)

interface ArchiveBotSessionRequest extends SessionMutationBase {
  archived: boolean
}
interface ArchiveBotSessionResponse {
  sessionId: string
  archived: boolean
}

export const archiveBotSession = onCall<ArchiveBotSessionRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<ArchiveBotSessionResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, workspaceId, sessionId, archived } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.")
    }
    if (typeof archived !== "boolean") {
      throw new HttpsError("invalid-argument", "archived must be a boolean.")
    }

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .set(
        {
          archivedAt: archived
            ? admin.firestore.FieldValue.serverTimestamp()
            : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return { sessionId, archived }
  }
)

type DeleteBotSessionRequest = SessionMutationBase
interface DeleteBotSessionResponse {
  sessionId: string
  deleted: true
}

export const deleteBotSession = onCall<DeleteBotSessionRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<DeleteBotSessionResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, workspaceId, sessionId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new HttpsError("invalid-argument", "workspaceId is required.")
    }
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.")
    }

    await assertCanMutate(teamId, workspaceId, sessionId, auth.uid)

    // Single document; no subcollections to traverse.
    await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .delete()

    return { sessionId, deleted: true }
  }
)

// ===========================================================================
// Team agent config — read & update callables.
// ===========================================================================
//
// Read is open to any team member (the config drives chat behavior they
// experience). Write is restricted to owners + admins, so a regular
// member can't change the model or strip safety-relevant prompt text.
//
// Both callables return the FULL effective config — partially-set docs
// get filled with defaults server-side via `applyAgentConfigOverrides`,
// so the client never has to worry about which fields are present.

interface GetTeamAgentConfigRequest {
  teamId: string
}

interface GetTeamAgentConfigResponse {
  config: BotAgentConfig
  /** True when the team has an explicit doc (vs relying on defaults). */
  hasOverrides: boolean
}

export const getTeamAgentConfig = onCall<GetTeamAgentConfigRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<GetTeamAgentConfigResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }

    // Membership gate — non-members shouldn't even know whether the
    // doc exists. `getMembershipRole` throws if not a member.
    await getMembershipRole(teamId, auth.uid)

    const snap = await db.doc(agentConfigDocPath(teamId)).get()
    const config = applyAgentConfigOverrides(snap.data())

    return { config, hasOverrides: snap.exists }
  }
)

interface UpdateTeamAgentConfigRequest {
  teamId: string
  /** Partial — only sent fields are updated, the rest fall through to defaults. */
  updates: BotAgentConfigUpdate
}

interface UpdateTeamAgentConfigResponse {
  config: BotAgentConfig
}

export const updateTeamAgentConfig = onCall<UpdateTeamAgentConfigRequest>(
  {
    ...CALLABLE_OPTS,
    secrets: [geminiApiKey, anthropicApiKey, openaiApiKey],
    enforceAppCheck: true,
  },
  async (request): Promise<UpdateTeamAgentConfigResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, updates } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }

    // Owner/admin gate — mirrors the existing `teams/{teamId}/settings`
    // read rule (admin-only) and the broader convention that team-level
    // settings are managed by team admins.
    const role = await getMembershipRole(teamId, auth.uid)
    if (!isAdminRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only team owners and admins can change agent settings."
      )
    }

    // Validate the partial payload. Zod errors flow back to the
    // client as `invalid-argument` so the form can highlight which
    // field broke.
    const parsed = botAgentConfigUpdateSchema.safeParse(updates ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid agent config: ${parsed.error.message}`
      )
    }

    const ref = db.doc(agentConfigDocPath(teamId))
    const existingSnap = await ref.get()
    const currentConfig = applyAgentConfigOverrides(existingSnap.data())
    const nextProviders = {
      ...currentConfig.providers,
      ...(parsed.data.providers ?? {}),
    }

    if (!hasEnabledProvider(nextProviders)) {
      throw new HttpsError(
        "invalid-argument",
        "At least one AI provider must stay enabled."
      )
    }
    assertEnabledProvidersConfigured(nextProviders)

    let nextModel = parsed.data.model ?? currentConfig.model
    if (!nextProviders[BOT_MODEL_PROVIDER_BY_MODEL[nextModel]]) {
      if (parsed.data.model) {
        throw new HttpsError(
          "invalid-argument",
          "Selected model belongs to a disabled AI provider."
        )
      }
      nextModel = firstModelForEnabledProviders(nextProviders)
    }

    const updatesToWrite: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.providers) {
      updatesToWrite.providers = nextProviders
      updatesToWrite.model = nextModel
    } else if (parsed.data.model) {
      updatesToWrite.model = nextModel
    }

    await ref.set(
      {
        ...updatesToWrite,
        teamId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      },
      { merge: true }
    )

    // Re-read so the response reflects the fully-merged effective
    // config (caller's optimistic state can be replaced wholesale).
    const snap = await ref.get()
    return { config: applyAgentConfigOverrides(snap.data()) }
  }
)

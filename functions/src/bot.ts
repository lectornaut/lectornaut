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

import { googleAI } from "@genkit-ai/google-genai"
import { onCallGenkit } from "firebase-functions/https"
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https"
import { z, type SessionData, type SessionStore } from "genkit/beta"
import { admin, db } from "./firebase.js"
import { ai } from "./genkitClient.js"
import { CALLABLE_OPTS, GENKIT_OPTS } from "./runtimeConfig.js"
import { geminiApiKey } from "./secrets.js"
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
    private readonly previewMaxLength: number = PREVIEW_MAX_LENGTH
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
    }

    // Title is set once on creation and frozen afterward — the rename
    // callable is the sole writer past that point. createdAt and the
    // null archivedAt sentinel are also one-shot writes.
    if (isNew) {
      update.title = deriveTitle(messages, this.titleMaxLength)
      update.createdAt = admin.firestore.FieldValue.serverTimestamp()
      update.archivedAt = null
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
 * shows up as the second argument of every tool handler. Includes the
 * existing Firebase auth (already validated at the callable boundary) so
 * tools can do uid-based filtering, plus the chat mode for capability
 * gating. Add fields here when introducing context-aware features.
 */
interface BotActionContext {
  auth?: { uid: string }
  mode: BotChatMode
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

/**
 * Allowlist of model wire-names. Picked manually so a typo in the
 * settings UI can't route a chat to a non-existent or private model;
 * the Zod enum on the update path enforces the same set.
 */
const BOT_AGENT_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const

type BotAgentModel = (typeof BOT_AGENT_MODELS)[number]

interface BotAgentToolToggles {
  getWeather: boolean
  rollDice: boolean
  /**
   * Interrupt tool. Defaults to true; turning it off forces the model to
   * commit to a guess instead of asking — useful when the workspace
   * wants strictly non-interactive replies (e.g. background jobs).
   */
  askQuestion: boolean
}

interface BotAgentConfig {
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
  model: "gemini-3-flash-preview",
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
  },
  titleMaxLength: TITLE_MAX_LENGTH,
  previewMaxLength: PREVIEW_MAX_LENGTH,
}

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

const agentConfigDocPath = (teamId: string) =>
  `teams/${teamId}/settings/agent`

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
  if (!raw) return { ...DEFAULT_BOT_AGENT_CONFIG }

  const model =
    typeof raw.model === "string" &&
    (BOT_AGENT_MODELS as readonly string[]).includes(raw.model)
      ? (raw.model as BotAgentModel)
      : DEFAULT_BOT_AGENT_CONFIG.model

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
  }

  const defaultMode =
    typeof raw.defaultMode === "string" &&
    (BOT_CHAT_MODES as readonly string[]).includes(raw.defaultMode)
      ? (raw.defaultMode as BotChatMode)
      : DEFAULT_BOT_AGENT_CONFIG.defaultMode

  return {
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

async function loadTeamAgentConfig(teamId: string): Promise<BotAgentConfig> {
  const snap = await db.doc(agentConfigDocPath(teamId)).get()
  if (!snap.exists) return { ...DEFAULT_BOT_AGENT_CONFIG }
  return applyAgentConfigOverrides(snap.data())
}

/** Build the system prompt from the loaded config + the active mode. */
function buildSystemPromptFromConfig(
  config: BotAgentConfig,
  mode: BotChatMode
): string {
  return `${config.systemPromptBase}\n\n${config.promptSuffixes[mode]}`
}

/**
 * Pick which tools to register with the chat for a given (config, mode).
 *   - Mode strips action tools in `manual` (existing behavior).
 *   - Workspace-level toggles strip individual tools regardless of mode.
 *   - Interrupt tools (askQuestion) are gateable too — opt-in disable.
 */
function pickChatTools(config: BotAgentConfig, mode: BotChatMode) {
  const modeAllowsActionTools = MODE_CONFIG[mode].actionToolsEnabled
  const tools = []
  if (modeAllowsActionTools && config.tools.getWeather) tools.push(getWeatherTool)
  if (modeAllowsActionTools && config.tools.rollDice) tools.push(rollDiceTool)
  if (config.tools.askQuestion) tools.push(askQuestionTool)
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
function requireVerifiedAuth(auth: AuthData | undefined): AuthData {
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
async function getMembershipRole(
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

    const store = new FirestoreBotSessionStore(
      teamId,
      workspaceId,
      auth.uid,
      agentConfig.titleMaxLength,
      agentConfig.previewMaxLength
    )

    const session = sessionId
      ? await ai.loadSession(sessionId, { store })
      : ai.createSession({ store })

    // Build the action context for this turn. `auth` mirrors the existing
    // verified Firebase identity; `mode` is the per-turn capability gate
    // chosen in the composer dropdown. Tools get the full object via
    // their second handler arg.
    const actionContext: BotActionContext = {
      auth: { uid: auth.uid },
      mode,
    }

    // `manual` strips action tools so even a jailbroken prompt can't get
    // the model to invoke side-effectful tools — the model literally has
    // no actions registered for the call. Interrupt tools (just clarifying
    // questions) stay available because they're conversational, not
    // actions. Per-workspace tool toggles further strip individual tools.
    const chatTools = pickChatTools(agentConfig, mode)

    // System prompt is mode-aware. We set it on every turn (including
    // resumed sessions) so a user who flips modes mid-conversation
    // immediately gets the new behavior. Genkit replaces the system
    // segment when one is provided to chat() — earlier turns aren't
    // rewritten on disk, but the active turn picks it up. Model + gen
    // config are also workspace-scoped overrides; admins can swap models
    // without touching the source.
    const chat = session.chat({
      model: googleAI.model(agentConfig.model),
      system: buildSystemPromptFromConfig(agentConfig, mode),
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
    secrets: [geminiApiKey],
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
      agentConfig.previewMaxLength
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
    }
    const chatTools = pickChatTools(agentConfig, mode)

    // Resume: no new prompt, just the resolved interrupt fed back in.
    // Genkit appends the toolResponse to the message history and lets
    // the model continue.
    const chat = session.chat({
      model: googleAI.model(agentConfig.model),
      system: buildSystemPromptFromConfig(agentConfig, mode),
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
    secrets: [geminiApiKey],
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
  { ...CALLABLE_OPTS, enforceAppCheck: true },
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
    await ref.set(
      {
        ...parsed.data,
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

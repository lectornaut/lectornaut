<script lang="ts" setup>
/**
 * BotChatToolCall — renders one tool invocation segment from an agent
 * message. The collapsible header carries a single leading icon. While the
 * call is still in flight, that icon is the lifecycle-status badge (pending /
 * running — see `status` + `statusBadge`). Once the call reaches a quiet,
 * collapsed resting state, the badge gives way to a chevron that mirrors the
 * open/closed state and cues the user to reopen it (see `showChevron` for
 * which states qualify).
 * The body switches between per-tool presentations based on `tool.name`, with
 * a JSON fallback for tools we don't have a dedicated view for.
 *
 * State branches:
 *
 *   1. Interrupt (`isInterrupt`) — an `askQuestion`, with two sub-states by
 *      position. LIVE (`isLiveInterrupt`, the conversation tail) pauses the
 *      chat and renders the question + choice buttons; clicking one calls
 *      `respondToInterrupt` to resume. ABANDONED (`isAbandonedInterrupt`, no
 *      longer the tail because the user sent another message) renders the
 *      question read-only as a collapsed historical card — resuming a
 *      superseded interrupt would fail.
 *
 *   2. Resolved interrupt (askQuestion with `output` set):
 *      The user answered an `askQuestion`. Detected by tool NAME +
 *      presence of output — NOT the `isInterrupt` flag, which the
 *      server drops the instant an answer lands. Renders the question
 *      with the chosen answer highlighted, instead of dumping it
 *      through the generic fallback view.
 *
 *   3. Running (`output === undefined`, no interrupt):
 *      A normal tool is executing on the server. Shows a spinner +
 *      brief waiting message in the body. In practice this state is
 *      brief — execution is fast.
 *
 *   4. Done with a dedicated renderer (`output` set, `tool.name`
 *      matches one of our known tools): renders a tool-specific
 *      `Card` (dice, search results, summary, …). Every
 *      done-state branch shares ONE anatomy — an optional
 *      `CardHeader` echoing the call's input/query (shown only when
 *      the tool took one; the trigger already names the tool), a
 *      `CardContent` body, and an optional `CardFooter` for
 *      metadata — so the cards read uniformly regardless of tool.
 *
 *   5. Done with no dedicated renderer (`output` set, unknown
 *      `tool.name`): falls back to a `Card` wrapping a generic
 *      preview (a recognized text field as markdown, else a JSON
 *      dump) so brand-new tools added to the server still render
 *      something reasonable before the UI catches up.
 *
 * The card body is collapsible so a chat with several tool calls
 * doesn't dominate the message column. Default state: open while
 * running / awaiting input; collapsed once complete.
 *
 * Each tool's typed accessor (`diceOutput`, `searchOutput`, …) is a
 * defensive narrower — it returns `null` if the model's payload
 * doesn't match the expected shape, in which case the template falls
 * through to the generic JSON view rather than crashing.
 */
import {
  BotChatContextKey,
  type BotChatToolCall,
} from "@/composables/useBotChat"
import { botToolLabel } from "@/data/botTools"
import {
  IconBotMessageSquare,
  IconCheck,
  IconChevronRight,
  IconCircleHelp,
  IconDices,
  IconFileText,
  IconFolder,
  IconSearch,
  IconTriangleAlert,
} from "@/data/icons"
import { useTeamCustomToolsStore } from "@/stores/teamCustomToolsStore"
import {
  GITHUB_WRITE_TOOL_NAMES,
  GOOGLE_CALENDAR_WRITE_TOOL_NAMES,
  GOOGLE_DRIVE_WRITE_TOOL_NAMES,
} from "@lectornaut/shared/domain"
import { storeToRefs } from "pinia"
import { computed, inject, ref, watch, type Component } from "vue"

const props = defineProps<{
  tool: BotChatToolCall
  /**
   * Identity of the agent message that owns this tool segment. Needed
   * by `respondToInterrupt` to locate the segment in `messages.value`
   * before mutating it. Not used for non-interrupt tools.
   */
  messageId: string
}>()

const botChat = inject(BotChatContextKey)
const { t } = useI18n()

// Resolve the wire name (`tool.name`) to the human-friendly display name
// admins see in Settings → Custom Tools, applied uniformly to built-in
// and custom tools:
//   1. Built-in tool → its catalog label (the slash-menu display name).
//   2. Custom tool   → the admin-authored `displayName`, falling back to
//      the wire name when blank (mirrors the editor's `displayName || name`).
//   3. Unrecognized (e.g. `transferToAgent`, or a custom tool since
//      hard-deleted) → the raw wire name.
// Reads the FULL `tools` list (not `selectableTools`) so a card rendered
// from history still resolves a label after its tool was disabled/archived.
const customToolsStore = useTeamCustomToolsStore()
const { tools: customTools } = storeToRefs(customToolsStore)

const displayName = computed<string>(() => {
  const builtIn = botToolLabel(props.tool.name)
  if (builtIn) return builtIn
  const custom = customTools.value.find(
    (entry) => entry.name === props.tool.name
  )
  if (custom) return custom.displayName || custom.name
  return props.tool.name
})

const isInterrupt = computed(
  () => props.tool.isInterrupt === true && props.tool.output === undefined
)
const isRunning = computed(
  () => !isInterrupt.value && props.tool.output === undefined
)
const isDone = computed(
  () => !isInterrupt.value && props.tool.output !== undefined
)

// A pending interrupt (`isInterrupt`) means an unanswered askQuestion — but
// that splits in two by POSITION in the conversation:
//   • Live — it's the last segment of the last message, so the chat is
//     genuinely paused on it and the interactive choice form is the point.
//   • Abandoned — the user didn't answer and sent another message instead,
//     so content now follows it. Resuming a superseded interrupt would fail,
//     so we render it read-only as a collapsed historical card.
// An interrupt PAUSES the turn, so a live one can never have anything after
// it; being the conversation tail is exactly what separates the two. We
// compare the reactive tool by reference — `AiChat` passes the segment's
// `tool` through untouched (no clone), so identity holds.
const isConversationTail = computed(() => {
  const msgs = botChat?.messages.value
  if (!msgs || msgs.length === 0) return false
  const segments = msgs[msgs.length - 1].segments
  if (!segments || segments.length === 0) return false
  const lastSegment = segments[segments.length - 1]
  return lastSegment.kind === "tool" && lastSegment.tool === props.tool
})
const isLiveInterrupt = computed(
  () => isInterrupt.value && isConversationTail.value
)
const isAbandonedInterrupt = computed(
  () => isInterrupt.value && !isConversationTail.value
)

// Open while the card is actively doing something the user must watch: a
// LIVE interrupt's choice form or a running spinner. Everything else opens
// collapsed — a finished result, an error, or an ABANDONED interrupt (the
// user moved on) is a quiet historical card. Derived, NOT hardcoded `true`:
// cards restored from history must start collapsed (the watcher only fires on
// a live *transition*, since Vue's `watch` isn't immediate). The watcher then
// collapses the card the moment it leaves the active state — a result lands,
// or the interrupt is superseded by a new message. The user can override
// either way by clicking the trigger.
const open = ref(isRunning.value || isLiveInterrupt.value)
watch(
  () => isRunning.value || isLiveInterrupt.value,
  (active) => {
    // Symmetric: collapse when the card goes quiet (result landed /
    // interrupt superseded), AND re-expand when it becomes active again.
    // The re-expand matters for the rollback path — when a failed
    // respondToInterrupt restores `isInterrupt = true` (false→true), the
    // Approve/Cancel form must reappear rather than stay hidden behind the
    // collapsed row the optimistic flip closed. History cards still mount
    // collapsed: the watcher is non-immediate, so it only fires on a live
    // transition, never on initial mount.
    open.value = active
  }
)

// ── askQuestion-specific input shape ───────────────────────────────────────
//
// `tool.input` is `unknown` at the type level (the server sends raw
// model output through). For our `askQuestion` interrupt the runtime
// shape is `{ question, choices, allowOther? }`. We narrow defensively
// so a malformed payload (model hallucination on the input schema)
// degrades gracefully instead of crashing the renderer.
interface AskQuestionInput {
  question: string
  choices: string[]
  allowOther?: boolean
}

const askQuestionInput = computed<AskQuestionInput | null>(() => {
  if (props.tool.name !== "askQuestion") return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const question = typeof obj.question === "string" ? obj.question : ""
  const choices = Array.isArray(obj.choices)
    ? (obj.choices as unknown[]).filter(
        (c): c is string => typeof c === "string"
      )
    : []
  if (!question || choices.length === 0) return null
  return {
    question,
    choices,
    allowOther: obj.allowOther === true,
  }
})

// A resolved askQuestion — the user answered and the tool produced output.
// Detected by tool NAME + presence of `output`, NOT by `isInterrupt`: the
// server's history denormalizer (and our own stream reducer, when a
// `toolResult` lands) DELETE the
// flag the instant an answer lands, so a persisted/reloaded answered
// question never carries it. Keying the check on `isInterrupt === true`
// left this branch permanently dead and dropped every answered question
// into the generic fallback. `isInterrupt` stays meaningful only for the
// PENDING state, which `isInterrupt` / `isRunning` above still use.
const isResolvedInterrupt = computed(
  () => props.tool.name === "askQuestion" && props.tool.output !== undefined
)

// Just the question string from the askQuestion input. The resolved view
// (unlike the pending form) doesn't render choices, so we read `question`
// directly rather than through `askQuestionInput` — that keeps an answered
// Q&A rendering even when the choices are missing or malformed.
const questionText = computed<string>(() => {
  if (props.tool.name !== "askQuestion") return ""
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return ""
  const question = (raw as Record<string, unknown>).question
  return typeof question === "string" ? question : ""
})

// Narrow `tool.output` to the `{ answer: string }` shape produced by
// `respondToInterrupt`. Anything else returns null and we fall through
// to the generic fallback view.
const interruptAnswer = computed<string | null>(() => {
  if (!isResolvedInterrupt.value) return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  return typeof obj.answer === "string" ? obj.answer : null
})

const customAnswer = ref("")
const submittingChoice = ref<string | null>(null)
const isSubmitting = computed(() => submittingChoice.value !== null)

const submitAnswer = async (answer: string) => {
  if (!botChat) return
  if (!answer) return
  if (isSubmitting.value) return
  submittingChoice.value = answer
  try {
    await botChat.respondToInterrupt({
      messageId: props.messageId,
      ref: props.tool.ref,
      name: props.tool.name,
      answer: { answer },
    })
    customAnswer.value = ""
  } finally {
    submittingChoice.value = null
  }
}

const submitCustom = () => {
  const text = customAnswer.value.trim()
  if (!text) return
  void submitAnswer(text)
}

const onCustomKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submitCustom()
  }
}

// ── Calendar-write confirmation (connection tools, P2) ─────────────────────
//
// `createCalendarEvent` / `updateCalendarEvent` pause on a confirm interrupt.
// The card renders straight from `tool.input` — the server validates the same
// input STRICTLY and executes a deterministic payload from it, so what the
// card shows is exactly what an Approve writes (the stream whitelists tool
// fields to ref/name/input/isInterrupt, so input is the only channel anyway).
// Names come from the shared vocabulary, so the server dispatch and this
// card can't drift.
const CALENDAR_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  GOOGLE_CALENDAR_WRITE_TOOL_NAMES
)
const isCalendarWrite = computed(() =>
  CALENDAR_WRITE_TOOL_NAMES.has(props.tool.name)
)

interface CalendarWriteDraft {
  action: "create" | "update"
  eventId: string | null
  summary: string | null
  start: string | null
  end: string | null
  allDay: boolean
  location: string | null
  description: string | null
  attendees: string[]
}

const draftString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const calendarWriteDraft = computed<CalendarWriteDraft | null>(() => {
  if (!isCalendarWrite.value) return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  return {
    action: props.tool.name === "createCalendarEvent" ? "create" : "update",
    eventId: draftString(obj.eventId),
    summary: draftString(obj.summary),
    start: draftString(obj.start),
    end: draftString(obj.end),
    allDay: obj.allDay === true,
    location: draftString(obj.location),
    description: draftString(obj.description),
    attendees: Array.isArray(obj.attendees)
      ? (obj.attendees as unknown[]).filter(
          (entry): entry is string => typeof entry === "string"
        )
      : [],
  }
})

/** Human-readable draft time; all-day dates pass through as-is. */
const formatDraftTime = (iso: string | null, allDay: boolean): string => {
  if (!iso) return ""
  if (allDay) return iso
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

const draftTimeRange = computed<string>(() => {
  const draft = calendarWriteDraft.value
  if (!draft || !draft.start) return ""
  const start = formatDraftTime(draft.start, draft.allDay)
  const end = draft.end ? formatDraftTime(draft.end, draft.allDay) : ""
  return end && end !== start ? `${start} – ${end}` : start
})

const submittingDecision = ref<"approve" | "cancel" | null>(null)

const submitDecision = async (approved: boolean) => {
  if (!botChat || submittingDecision.value) return
  submittingDecision.value = approved ? "approve" : "cancel"
  try {
    await botChat.respondToInterrupt({
      messageId: props.messageId,
      ref: props.tool.ref,
      name: props.tool.name,
      answer: { approved },
    })
  } finally {
    submittingDecision.value = null
  }
}

// ── Drive-write confirmation (connection tools, D2) ─────────────────────────
//
// `createDriveFile` / `updateDriveFile` follow the calendar P2 pattern
// exactly: the card renders the strict-validated draft from `tool.input`,
// approval restarts the tool server-side, and the outcome card keys off the
// `written | declined | failed` discriminator. Names come from the shared
// vocabulary, so the server dispatch and this card can't drift.
const DRIVE_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  GOOGLE_DRIVE_WRITE_TOOL_NAMES
)
const isDriveWrite = computed(() => DRIVE_WRITE_TOOL_NAMES.has(props.tool.name))

interface DriveWriteDraft {
  action: "create" | "update"
  name: string | null
  /** Effective kind — mirrors the server-side default of "document". */
  kind: "document" | "text"
  folderId: string | null
  fileId: string | null
  contentPreview: string
  contentChars: number
}

const DRIVE_PREVIEW_CHARS = 280

const driveWriteDraft = computed<DriveWriteDraft | null>(() => {
  if (!isDriveWrite.value) return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const content = typeof obj.content === "string" ? obj.content : ""
  return {
    action: props.tool.name === "createDriveFile" ? "create" : "update",
    name: draftString(obj.name),
    kind: obj.kind === "text" ? "text" : "document",
    folderId: draftString(obj.folderId),
    fileId: draftString(obj.fileId),
    contentPreview:
      content.length > DRIVE_PREVIEW_CHARS
        ? `${content.slice(0, DRIVE_PREVIEW_CHARS)}…`
        : content,
    contentChars: content.length,
  }
})

/** Drive-write outcome — same plumbing as `calendarWriteResult` below. */
const driveWriteResult = computed<{
  kind: "written" | "declined" | "failed" | "deciding"
  link: string | null
} | null>(() => {
  if (!isDriveWrite.value || props.tool.output === undefined) return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.ok === "boolean") {
    const file =
      obj.file && typeof obj.file === "object"
        ? (obj.file as Record<string, unknown>)
        : null
    const outcome =
      obj.outcome === "written" ||
      obj.outcome === "declined" ||
      obj.outcome === "failed"
        ? obj.outcome
        : obj.ok
          ? "written"
          : "failed"
    return {
      kind: outcome,
      link: file && typeof file.link === "string" ? file.link : null,
    }
  }
  if (typeof obj.approved === "boolean") {
    return { kind: "deciding", link: null }
  }
  return null
})

/**
 * A finished calendar write renders from its REAL tool output `{ ok,
 * outcome, event }`. The server's `message` is MODEL-directed prose ("Ask
 * them to reconnect…", "Do not retry…") — never shown verbatim; the card
 * uses its own i18n copy keyed off `outcome`, and the model relays the
 * detail in its chat reply. Between the optimistic flip (output =
 * `{ approved }`) and the streamed toolResult, an interim "deciding" state
 * keeps the card honest about what's still in flight.
 *
 * `failed` vs `declined` is the load-bearing distinction: a deliberate
 * Cancel is `ok: false` but NOT an error, so it must not wear the
 * destructive treatment a real Google API failure does.
 */
const calendarWriteResult = computed<{
  kind: "written" | "declined" | "failed" | "deciding"
  link: string | null
} | null>(() => {
  if (!isCalendarWrite.value || props.tool.output === undefined) return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.ok === "boolean") {
    const event =
      obj.event && typeof obj.event === "object"
        ? (obj.event as Record<string, unknown>)
        : null
    // Trust the explicit discriminator; fall back by `ok` for any older
    // output shape that predates it.
    const outcome =
      obj.outcome === "written" ||
      obj.outcome === "declined" ||
      obj.outcome === "failed"
        ? obj.outcome
        : obj.ok
          ? "written"
          : "failed"
    return {
      kind: outcome,
      link: event && typeof event.link === "string" ? event.link : null,
    }
  }
  if (typeof obj.approved === "boolean") {
    // Optimistic interim — the resumed turn is executing (or cancelling).
    return { kind: "deciding", link: null }
  }
  return null
})

// ── GitHub-write confirmation (connection tools, P2) ────────────────────────
//
// createGitHubIssue / addGitHubComment / updateGitHubIssue follow the
// calendar/drive pattern: the card renders the strict-validated draft from
// `tool.input`, approval restarts the tool server-side, and the outcome card
// keys off the `written | declined | failed` discriminator. Names come from
// the shared vocabulary so the server dispatch and this card can't drift.
const GITHUB_WRITE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  GITHUB_WRITE_TOOL_NAMES
)
const isGitHubWrite = computed(() =>
  GITHUB_WRITE_TOOL_NAME_SET.has(props.tool.name)
)

interface GitHubWriteDraft {
  action: "create" | "comment" | "update"
  repo: string | null
  title: string | null
  issueNumber: number | null
  bodyPreview: string
  state: string | null
  labels: string[]
}

const GITHUB_PREVIEW_CHARS = 280

const gitHubWriteDraft = computed<GitHubWriteDraft | null>(() => {
  if (!isGitHubWrite.value) return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const action =
    props.tool.name === "createGitHubIssue"
      ? "create"
      : props.tool.name === "addGitHubComment"
        ? "comment"
        : "update"
  const body = typeof obj.body === "string" ? obj.body : ""
  return {
    action,
    repo: draftString(obj.repo),
    title: draftString(obj.title),
    issueNumber: typeof obj.issueNumber === "number" ? obj.issueNumber : null,
    bodyPreview:
      body.length > GITHUB_PREVIEW_CHARS
        ? `${body.slice(0, GITHUB_PREVIEW_CHARS)}…`
        : body,
    state: draftString(obj.state),
    labels: Array.isArray(obj.labels)
      ? (obj.labels as unknown[]).filter(
          (entry): entry is string => typeof entry === "string"
        )
      : [],
  }
})

const gitHubWriteTitleKey = computed<string>(() => {
  const action = gitHubWriteDraft.value?.action
  return action === "create"
    ? "ai.toolCall.gitHubWrite.createTitle"
    : action === "comment"
      ? "ai.toolCall.gitHubWrite.commentTitle"
      : "ai.toolCall.gitHubWrite.updateTitle"
})

const gitHubWriteResult = computed<{
  kind: "written" | "declined" | "failed" | "deciding"
  link: string | null
} | null>(() => {
  if (!isGitHubWrite.value || props.tool.output === undefined) return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.ok === "boolean") {
    const item =
      obj.item && typeof obj.item === "object"
        ? (obj.item as Record<string, unknown>)
        : null
    const outcome =
      obj.outcome === "written" ||
      obj.outcome === "declined" ||
      obj.outcome === "failed"
        ? obj.outcome
        : obj.ok
          ? "written"
          : "failed"
    return {
      kind: outcome,
      link: item && typeof item.url === "string" ? item.url : null,
    }
  }
  if (typeof obj.approved === "boolean") {
    return { kind: "deciding", link: null }
  }
  return null
})

// ── Per-tool typed accessors ──────────────────────────────────────────────
//
// Each accessor narrows `tool.input` / `tool.output` against the
// server-side schema for that tool. Returns `null` on shape mismatch
// so the template falls through to the JSON fallback view instead of
// rendering a half-broken card. None of these need to be perfectly
// strict — they just need to recognize a well-formed payload.

// rollDice — input: {} (empty), output: number 1..6
const diceOutput = computed<number | null>(() => {
  if (props.tool.name !== "rollDice") return null
  const raw = props.tool.output
  if (typeof raw !== "number") return null
  if (!Number.isInteger(raw) || raw < 1 || raw > 6) return null
  return raw
})

// searchWorkspaceNodes — input: { query, limit, scope }, output: { results, truncated }
interface SearchInput {
  query: string
  limit?: number
  scope?: "code" | "write" | "both"
}
interface SearchResult {
  nodeId: string
  scope: "code" | "write"
  name: string
  type: "folder" | "file"
  snippet: string
  distance?: number
}
interface SearchOutput {
  results: SearchResult[]
  truncated: boolean
}

const searchInput = computed<SearchInput | null>(() => {
  if (props.tool.name !== "searchWorkspaceNodes") return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const query = typeof obj.query === "string" ? obj.query : ""
  if (!query) return null
  const limit = typeof obj.limit === "number" ? obj.limit : undefined
  const scope =
    obj.scope === "code" || obj.scope === "write" || obj.scope === "both"
      ? obj.scope
      : undefined
  return { query, limit, scope }
})

const searchOutput = computed<SearchOutput | null>(() => {
  if (props.tool.name !== "searchWorkspaceNodes") return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.results)) return null
  const results: SearchResult[] = []
  for (const entry of obj.results as unknown[]) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const nodeId = typeof e.nodeId === "string" ? e.nodeId : ""
    const scope = e.scope === "code" || e.scope === "write" ? e.scope : null
    const name = typeof e.name === "string" ? e.name : ""
    const type = e.type === "folder" || e.type === "file" ? e.type : "file"
    const snippet = typeof e.snippet === "string" ? e.snippet : ""
    const distance = typeof e.distance === "number" ? e.distance : undefined
    if (!nodeId || !scope || !name) continue
    results.push({ nodeId, scope, name, type, snippet, distance })
  }
  const truncated = obj.truncated === true
  return { results, truncated }
})

// summarizeNode — output: { summary, keyPoints[], suggestedTags[], model, error? }
//
// We don't surface the input (scope + nodeId) in the rendered card —
// a raw nodeId isn't human-friendly, and the user typically already
// knows which node they asked about. The tool's structured output is
// self-contained.
interface SummarizeOutput {
  summary: string
  keyPoints: string[]
  suggestedTags: string[]
  model: string
  error?: string
}

const summarizeOutput = computed<SummarizeOutput | null>(() => {
  if (props.tool.name !== "summarizeNode") return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const summary = typeof obj.summary === "string" ? obj.summary : ""
  const keyPoints = Array.isArray(obj.keyPoints)
    ? (obj.keyPoints as unknown[]).filter(
        (p): p is string => typeof p === "string"
      )
    : []
  const suggestedTags = Array.isArray(obj.suggestedTags)
    ? (obj.suggestedTags as unknown[]).filter(
        (p): p is string => typeof p === "string"
      )
    : []
  const model = typeof obj.model === "string" ? obj.model : ""
  const error =
    typeof obj.error === "string" && obj.error ? obj.error : undefined
  // Recognize the error variant (returned by the tool when summarize
  // couldn't run) — otherwise require at least a non-empty summary
  // before treating the payload as a successful structured result.
  if (error) return { summary: "", keyPoints, suggestedTags, model, error }
  if (!summary) return null
  return { summary, keyPoints, suggestedTags, model }
})

// compareNodes — input: { refs[], focus? }, output: { overview, agreements[],
// disagreements[], perNode[], model, error? }
//
// Mirrors `summarizeNode`'s structured-output card shape, but for N
// documents. The `perNode` list lets users see what each input
// contributed without re-reading the bodies.
interface CompareInput {
  refs: { scope: "code" | "write"; nodeId: string }[]
  focus?: string
}
interface ComparePerNode {
  scope: "code" | "write"
  nodeId: string
  name: string
  contribution: string
}
interface CompareOutput {
  overview: string
  agreements: string[]
  disagreements: string[]
  perNode: ComparePerNode[]
  model: string
  error?: string
}

const compareInput = computed<CompareInput | null>(() => {
  if (props.tool.name !== "compareNodes") return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.refs)) return null
  const refs: CompareInput["refs"] = []
  for (const entry of obj.refs as unknown[]) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const scope = e.scope === "code" || e.scope === "write" ? e.scope : null
    const nodeId = typeof e.nodeId === "string" ? e.nodeId : ""
    if (!scope || !nodeId) continue
    refs.push({ scope, nodeId })
  }
  if (refs.length === 0) return null
  const focus =
    typeof obj.focus === "string" && obj.focus.trim() ? obj.focus : undefined
  return { refs, focus }
})

const compareOutput = computed<CompareOutput | null>(() => {
  if (props.tool.name !== "compareNodes") return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const error =
    typeof obj.error === "string" && obj.error ? obj.error : undefined
  const overview = typeof obj.overview === "string" ? obj.overview : ""
  const agreements = Array.isArray(obj.agreements)
    ? (obj.agreements as unknown[]).filter(
        (p): p is string => typeof p === "string"
      )
    : []
  const disagreements = Array.isArray(obj.disagreements)
    ? (obj.disagreements as unknown[]).filter(
        (p): p is string => typeof p === "string"
      )
    : []
  const perNode: ComparePerNode[] = []
  if (Array.isArray(obj.perNode)) {
    for (const entry of obj.perNode as unknown[]) {
      if (!entry || typeof entry !== "object") continue
      const e = entry as Record<string, unknown>
      const scope = e.scope === "code" || e.scope === "write" ? e.scope : null
      const nodeId = typeof e.nodeId === "string" ? e.nodeId : ""
      const name = typeof e.name === "string" ? e.name : ""
      const contribution =
        typeof e.contribution === "string" ? e.contribution : ""
      if (!scope || !nodeId || !name) continue
      perNode.push({ scope, nodeId, name, contribution })
    }
  }
  const model = typeof obj.model === "string" ? obj.model : ""
  if (error) {
    return {
      overview: "",
      agreements: [],
      disagreements: [],
      perNode: [],
      model,
      error,
    }
  }
  // Recognize the success shape: overview must be present OR per-node
  // entries must exist. A model that returned `error: undefined` with
  // an empty body has nothing useful — fall through to the JSON dump.
  if (!overview && perNode.length === 0) return null
  return { overview, agreements, disagreements, perNode, model }
})

// findRelatedNodes — input: { scope, nodeId, searchScope?, limit? },
// output: { results[], truncated } — same result shape as
// searchWorkspaceNodes (so the card list reuses the same row layout).
interface RelatedInput {
  scope: "code" | "write"
  nodeId: string
}
interface RelatedOutput {
  results: SearchResult[]
  truncated: boolean
}

const relatedInput = computed<RelatedInput | null>(() => {
  if (props.tool.name !== "findRelatedNodes") return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const scope = obj.scope === "code" || obj.scope === "write" ? obj.scope : null
  const nodeId = typeof obj.nodeId === "string" ? obj.nodeId : ""
  if (!scope || !nodeId) return null
  return { scope, nodeId }
})

const relatedOutput = computed<RelatedOutput | null>(() => {
  if (props.tool.name !== "findRelatedNodes") return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.results)) return null
  const results: SearchResult[] = []
  for (const entry of obj.results as unknown[]) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const nodeId = typeof e.nodeId === "string" ? e.nodeId : ""
    const scope = e.scope === "code" || e.scope === "write" ? e.scope : null
    const name = typeof e.name === "string" ? e.name : ""
    const type = e.type === "folder" || e.type === "file" ? e.type : "file"
    const snippet = typeof e.snippet === "string" ? e.snippet : ""
    const distance = typeof e.distance === "number" ? e.distance : undefined
    if (!nodeId || !scope || !name) continue
    results.push({ nodeId, scope, name, type, snippet, distance })
  }
  return { results, truncated: obj.truncated === true }
})

// browseInternet — input: { query }, output: { ok, answer, sources[], retrievedAt }
//
// Live web search. We render the query and the synthesized `answer` as
// markdown (the answer is model-written prose, often with lists/links) plus
// the grounding sources as external links. `ok` / `retrievedAt` aren't
// surfaced — when the search fails, `answer` is itself a plain-language
// explanation, so the markdown body already carries that story.
interface BrowseInternetSource {
  title: string
  url: string
}
interface BrowseInternetOutput {
  answer: string
  sources: BrowseInternetSource[]
}

const browseInternetInput = computed<string | null>(() => {
  if (props.tool.name !== "browseInternet") return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  return typeof obj.query === "string" && obj.query ? obj.query : null
})

const browseInternetOutput = computed<BrowseInternetOutput | null>(() => {
  if (props.tool.name !== "browseInternet") return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const answer = typeof obj.answer === "string" ? obj.answer : ""
  if (!answer) return null
  const sources: BrowseInternetSource[] = []
  if (Array.isArray(obj.sources)) {
    for (const entry of obj.sources as unknown[]) {
      if (!entry || typeof entry !== "object") continue
      const e = entry as Record<string, unknown>
      const url = typeof e.url === "string" ? e.url : ""
      if (!url) continue
      const title = typeof e.title === "string" && e.title ? e.title : url
      sources.push({ title, url })
    }
  }
  return { answer, sources }
})

// ── Per-tool helpers ───────────────────────────────────────────────────────

const searchScopeLabel = (scope: "code" | "write") =>
  scope === "code"
    ? t("ai.toolCall.search.scopeCode")
    : t("ai.toolCall.search.scopeWrite")

// ── Generic JSON fallback (used for tools without a dedicated view). ───
const formatJson = (value: unknown): string => {
  if (value === undefined) return "—"
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const inputText = computed(() => {
  if (props.tool.input === undefined) return ""
  // Empty objects (zero-arg tools like rollDice) are noise — hide them.
  if (
    typeof props.tool.input === "object" &&
    props.tool.input !== null &&
    !Array.isArray(props.tool.input) &&
    Object.keys(props.tool.input as Record<string, unknown>).length === 0
  ) {
    return ""
  }
  return formatJson(props.tool.input)
})

const outputText = computed(() => formatJson(props.tool.output))

// Wrap formatted payload text in a fenced ```json block so the fallback
// renders through `AppMarkdown` (Shiki) and inherits the same
// theme-aware highlighting + copy button as every other code block in
// the chat surface — no separate highlighter needed.
//
// The fence is sized one backtick longer than the longest backtick run
// in the body: pretty-printed JSON can legitimately contain ``` (those
// aren't escaped by JSON.stringify), and a fixed 3-backtick fence would
// let such a payload terminate the block early and leak into markdown.
const toJsonFence = (text: string): string => {
  const longestBacktickRun =
    text.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1))
  return `${fence}json\n${text}\n${fence}`
}

// ── Markdown-preview promotion for the generic fallback ────────────────────
//
// Tools without a dedicated renderer still usually carry one
// human-meaningful text field — a `query` on the way in, a synthesized
// `answer` on the way out. Rendering that field as real markdown (prose,
// lists, links) reads far better than burying it in a JSON dump. We probe a
// small set of common field names in priority order; the first non-empty
// string wins and is shown as a markdown preview. When nothing matches we
// fall back to the fenced JSON block, so unfamiliar payloads still render
// something complete. (`browseInternet` has its own dedicated card above and
// never reaches here unless its payload is malformed.)
const INPUT_TEXT_KEYS = ["query", "prompt", "question"] as const
const OUTPUT_TEXT_KEYS = ["answer", "result", "response", "summary"] as const

const pickTextField = (
  raw: unknown,
  keys: readonly string[]
): string | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return null
}

const inputPrimaryText = computed(() =>
  pickTextField(props.tool.input, INPUT_TEXT_KEYS)
)
const outputPrimaryText = computed(() =>
  pickTextField(props.tool.output, OUTPUT_TEXT_KEYS)
)

const inputMarkdown = computed(() => {
  if (inputPrimaryText.value) return inputPrimaryText.value
  return inputText.value ? toJsonFence(inputText.value) : ""
})
const outputMarkdown = computed(() => {
  if (outputPrimaryText.value) return outputPrimaryText.value
  return toJsonFence(outputText.value)
})

// ── Humanized fallback section labels ──────────────────────────────────────
//
// The generic fallback labels its two sections by what they MEAN to the
// reader, not by the wire roles "Input"/"Output": an askQuestion shows a
// "Question" and an "Answer"; a search shows a "Search" and "Results".
// Tools with a dedicated renderer only reach the fallback on a malformed
// payload, but friendly labels keep even that degraded view readable.
// Custom and unrecognized tools (anything not in the map) fall back to a
// general "Request" / "Response". Keyed by `string` rather than a tool
// union because the fallback handles names that arrive straight off the
// wire (custom tools, `transferToAgent`, future server tools).
const FALLBACK_LABEL_KEYS: Record<string, { input: string; output: string }> = {
  askQuestion: {
    input: "ai.toolCall.labels.question",
    output: "ai.toolCall.labels.answer",
  },
  rollDice: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.result",
  },
  searchWorkspaceNodes: {
    input: "ai.toolCall.labels.search",
    output: "ai.toolCall.labels.results",
  },
  summarizeNode: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.summary",
  },
  browseInternet: {
    input: "ai.toolCall.labels.search",
    output: "ai.toolCall.labels.answer",
  },
  compareNodes: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.comparison",
  },
  findRelatedNodes: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.related",
  },
  saveMemory: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.result",
  },
  recallMemory: {
    input: "ai.toolCall.labels.search",
    output: "ai.toolCall.labels.results",
  },
  createCalendarEvent: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.result",
  },
  updateCalendarEvent: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.result",
  },
  createDriveFile: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.result",
  },
  updateDriveFile: {
    input: "ai.toolCall.labels.request",
    output: "ai.toolCall.labels.result",
  },
}

const inputLabel = computed(() =>
  t(FALLBACK_LABEL_KEYS[props.tool.name]?.input ?? "ai.toolCall.labels.request")
)
const outputLabel = computed(() =>
  t(
    FALLBACK_LABEL_KEYS[props.tool.name]?.output ??
      "ai.toolCall.labels.response"
  )
)

/**
 * Whether the current `tool.name` has a dedicated done-state renderer
 * AND that renderer's narrower successfully parsed the payload. When
 * false we fall back to the generic JSON view — either because the
 * tool is new (server-side schema we haven't styled yet) or because
 * the model returned a malformed payload our narrower rejected.
 */
const hasCustomDoneRenderer = computed(() => {
  if (!isDone.value) return false
  switch (props.tool.name) {
    case "rollDice":
      return diceOutput.value !== null
    case "searchWorkspaceNodes":
      return searchOutput.value !== null
    case "summarizeNode":
      return summarizeOutput.value !== null
    case "compareNodes":
      return compareOutput.value !== null
    case "findRelatedNodes":
      return relatedOutput.value !== null
    case "browseInternet":
      return browseInternetOutput.value !== null
    // Connection writes render their own outcome card — including the
    // user-declined case, which is `ok: false` but NOT an error (so this
    // also keeps `isErrorResult` from painting a deliberate Cancel as
    // "Failed").
    case "createCalendarEvent":
    case "updateCalendarEvent":
      return calendarWriteResult.value !== null
    case "createDriveFile":
    case "updateDriveFile":
      return driveWriteResult.value !== null
    case "createGitHubIssue":
    case "addGitHubComment":
    case "updateGitHubIssue":
      return gitHubWriteResult.value !== null
    default:
      return false
  }
})

// ── Header leading slot: lifecycle status badge ────────────────────────────
//
// One discriminant for the card's whole lifecycle, replacing the old
// implicit "v-else == done". The output-absent states (pending / abandoned /
// running) come first; the rest are "output present" outcomes split into
// error → answered-question → plain done. `abandoned` is an unanswered
// interrupt the conversation has moved past (see `isAbandonedInterrupt`).
// Driving the badge off this single value (rather than a tangle of booleans)
// keeps the icon, tooltip, and styling in one place and makes the partition
// exhaustive — adding a `ToolStatus` member is a compile error in
// `statusBadge` until it's mapped.
type ToolStatus =
  "pending" | "abandoned" | "running" | "resolved" | "done" | "error"

const isErrorResult = computed<boolean>(() => {
  // summarizeNode surfaces a structured error (its own destructive card).
  if (summarizeOutput.value?.error) return true
  // Connection writes own a dedicated card but still want the error badge on
  // a genuine FAILURE — and explicitly NOT on a deliberate decline (ok:false
  // but `declined`). Decided before the hasCustomDoneRenderer suppression
  // below precisely because that suppression would otherwise hide it.
  if (isCalendarWrite.value) return calendarWriteResult.value?.kind === "failed"
  if (isDriveWrite.value) return driveWriteResult.value?.kind === "failed"
  if (isGitHubWrite.value) return gitHubWriteResult.value?.kind === "failed"
  // Tools with a dedicated card render their own success/failure story, so
  // we don't second-guess them — only probe the generic fallback path.
  if (hasCustomDoneRenderer.value) return false
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return false
  const obj = raw as Record<string, unknown>
  // Best-effort: an explicit `ok: false` or a non-empty `error` string —
  // the common conventions for httpWebhook / custom-tool failures.
  // Conservative on purpose: better to miss an odd error shape than to
  // paint a successful call as "Failed".
  if (obj.ok === false) return true
  return typeof obj.error === "string" && obj.error.trim().length > 0
})

const status = computed<ToolStatus>(() => {
  if (isLiveInterrupt.value) return "pending"
  if (isAbandonedInterrupt.value) return "abandoned"
  if (isRunning.value) return "running"
  if (isErrorResult.value) return "error"
  if (isResolvedInterrupt.value) return "resolved"
  return "done"
})

// Icon + tooltip (+ optional color) per status, as an exhaustive record:
// TypeScript flags a missing key the moment a `ToolStatus` is added, and a
// single lookup keeps ESLint's return-in-computed rule satisfied (a `switch`
// without a `default` trips it even when every case returns). `running` maps
// to a null icon because the spinner is a standalone component the template
// renders via `v-if`, not a lucide glyph; `abandoned` is null for the same
// reason it shows a chevron. The template renders a chevron instead of the
// badge for the quiet resting states (`done`, `resolved`, `abandoned`, and
// `error` without a dedicated failure card — see `showChevron`); those
// entries stay mapped only to keep the record exhaustive.
const STATUS_BADGES: Record<
  ToolStatus,
  { icon: Component | null; tooltipKey: string; class?: string }
> = {
  pending: { icon: IconCircleHelp, tooltipKey: "ai.toolCall.needsInput" },
  abandoned: { icon: null, tooltipKey: "ai.toolCall.unanswered" },
  running: { icon: null, tooltipKey: "ai.toolCall.running" },
  resolved: { icon: IconBotMessageSquare, tooltipKey: "ai.toolCall.answered" },
  error: {
    icon: IconTriangleAlert,
    tooltipKey: "ai.toolCall.failed",
    class: "text-destructive",
  },
  done: { icon: IconCheck, tooltipKey: "ai.toolCall.done" },
}

const statusBadge = computed(() => STATUS_BADGES[status.value])

// Whether the leading glyph collapses to an expand/collapse chevron. True for
// the quiet, collapsed resting states where the chevron is the only useful
// signal: a `done` result, a `resolved` askQuestion (already answered), an
// `abandoned` askQuestion (the user moved on without answering), and an
// `error` with no dedicated failure card. `pending`/`running` keep their
// status glyph because the card is still open and working. NOTE: a finished
// clarifying question is `resolved` or `abandoned`, never `done` (see
// `status`), so it relies on those branches to get a chevron at all.
const showChevron = computed(
  () =>
    status.value === "done" ||
    status.value === "resolved" ||
    status.value === "abandoned" ||
    (status.value === "error" && !hasCustomDoneRenderer.value)
)
</script>

<template>
  <Collapsible v-model:open="open" class="grid gap-2">
    <CollapsibleTrigger as-child>
      <Item size="xs" class="group/toolCall p-0 text-xs select-none">
        <ItemContent>
          <ItemTitle
            class="text-muted-foreground/80 group-hover/toolCall:text-muted-foreground flex items-center gap-1 text-xs"
          >
            {{ displayName }}
            <IconChevronRight
              v-if="showChevron"
              class="text-muted-foreground/80 group-hover/toolCall:text-muted-foreground size-3! transition-transform will-change-transform"
              :class="{ 'rotate-90': open }"
            />
            <TooltipProvider v-else>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Spinner v-if="status === 'running'" />
                  <Component
                    :is="statusBadge.icon"
                    v-else
                    :class="statusBadge.class"
                  />
                </TooltipTrigger>
                <TooltipContent>{{ t(statusBadge.tooltipKey) }}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </ItemTitle>
        </ItemContent>
      </Item>
    </CollapsibleTrigger>
    <CollapsibleContent class="select-auto">
      <!-- ============================================================== -->
      <!-- Live interrupt: question + choices form (chat is paused here). -->
      <!-- ============================================================== -->
      <Card v-if="isLiveInterrupt && askQuestionInput" size="sm">
        <CardHeader>
          <CardTitle>{{ askQuestionInput.question }}</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex flex-wrap gap-2">
            <Button
              v-for="choice in askQuestionInput.choices"
              :key="choice"
              variant="outline"
              :disabled="isSubmitting"
              @click="submitAnswer(choice)"
            >
              <Spinner v-if="submittingChoice === choice" />
              {{ choice }}
            </Button>
          </div>
        </CardContent>
        <CardFooter v-if="askQuestionInput.allowOther" class="gap-2">
          <Input
            v-model="customAnswer"
            :placeholder="t('ai.toolCall.customAnswer')"
            :disabled="isSubmitting"
            @keydown="onCustomKeydown"
          />
          <Button
            :disabled="!customAnswer.trim() || isSubmitting"
            @click="submitCustom"
          >
            <Spinner v-if="submittingChoice === customAnswer.trim()" />
            {{ t("ai.toolCall.send") }}
          </Button>
        </CardFooter>
      </Card>

      <!-- ============================================================== -->
      <!-- Live calendar-write confirmation: the event draft + Approve / -->
      <!-- Cancel. Approval is stamped server-side onto the tool restart; -->
      <!-- nothing is written until the member clicks Approve.           -->
      <!-- ============================================================== -->
      <Card v-else-if="isLiveInterrupt && calendarWriteDraft" size="sm">
        <CardHeader>
          <CardTitle>
            {{
              t(
                calendarWriteDraft.action === "create"
                  ? "ai.toolCall.calendarWrite.createTitle"
                  : "ai.toolCall.calendarWrite.updateTitle"
              )
            }}
          </CardTitle>
          <CardDescription>
            {{ t("ai.toolCall.calendarWrite.confirmHint") }}
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-1 text-sm">
          <div v-if="calendarWriteDraft.summary" class="font-medium">
            {{ calendarWriteDraft.summary }}
          </div>
          <div v-if="draftTimeRange" class="text-muted-foreground">
            {{ draftTimeRange }}
          </div>
          <div v-if="calendarWriteDraft.location" class="text-muted-foreground">
            {{ calendarWriteDraft.location }}
          </div>
          <div
            v-if="calendarWriteDraft.description"
            class="text-muted-foreground"
          >
            {{ calendarWriteDraft.description }}
          </div>
          <div
            v-if="calendarWriteDraft.attendees.length > 0"
            class="text-muted-foreground"
          >
            {{
              t(
                "ai.toolCall.calendarWrite.attendees",
                calendarWriteDraft.attendees.length
              )
            }}: {{ calendarWriteDraft.attendees.join(", ") }}
          </div>
          <div
            v-if="calendarWriteDraft.eventId"
            class="text-muted-foreground/80 text-xs"
          >
            {{ t("ai.toolCall.calendarWrite.eventId") }}:
            {{ calendarWriteDraft.eventId }}
          </div>
        </CardContent>
        <CardFooter class="gap-2">
          <Button
            size="sm"
            :disabled="submittingDecision !== null"
            @click="submitDecision(true)"
          >
            <Spinner v-if="submittingDecision === 'approve'" />
            {{ t("ai.toolCall.calendarWrite.approve") }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="submittingDecision !== null"
            @click="submitDecision(false)"
          >
            <Spinner v-if="submittingDecision === 'cancel'" />
            {{ t("ai.toolCall.calendarWrite.cancel") }}
          </Button>
        </CardFooter>
      </Card>

      <!-- ============================================================== -->
      <!-- Live Drive-write confirmation: the file draft + Approve /     -->
      <!-- Cancel. Same contract as the calendar card above.             -->
      <!-- ============================================================== -->
      <Card v-else-if="isLiveInterrupt && driveWriteDraft" size="sm">
        <CardHeader>
          <CardTitle>
            {{
              t(
                driveWriteDraft.action === "create"
                  ? "ai.toolCall.driveWrite.createTitle"
                  : "ai.toolCall.driveWrite.updateTitle"
              )
            }}
          </CardTitle>
          <CardDescription>
            {{ t("ai.toolCall.driveWrite.confirmHint") }}
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-1 text-sm">
          <div v-if="driveWriteDraft.name" class="font-medium">
            {{ driveWriteDraft.name }}
          </div>
          <div class="text-muted-foreground">
            {{
              t(
                driveWriteDraft.kind === "document"
                  ? "ai.toolCall.driveWrite.kindDocument"
                  : "ai.toolCall.driveWrite.kindText"
              )
            }}
            <template v-if="driveWriteDraft.contentChars > 0">
              ·
              {{
                t(
                  "ai.toolCall.driveWrite.contentChars",
                  driveWriteDraft.contentChars
                )
              }}
            </template>
          </div>
          <div
            v-if="driveWriteDraft.contentPreview"
            class="text-muted-foreground border-border border-l-2 pl-2 text-xs whitespace-pre-wrap"
          >
            {{ driveWriteDraft.contentPreview }}
          </div>
          <div
            v-if="driveWriteDraft.folderId"
            class="text-muted-foreground/80 text-xs"
          >
            {{ t("ai.toolCall.driveWrite.folder") }}:
            {{ driveWriteDraft.folderId }}
          </div>
          <div
            v-if="driveWriteDraft.fileId"
            class="text-muted-foreground/80 text-xs"
          >
            {{ t("ai.toolCall.driveWrite.file") }}:
            {{ driveWriteDraft.fileId }}
          </div>
        </CardContent>
        <CardFooter class="gap-2">
          <Button
            size="sm"
            :disabled="submittingDecision !== null"
            @click="submitDecision(true)"
          >
            <Spinner v-if="submittingDecision === 'approve'" />
            {{ t("ai.toolCall.driveWrite.approve") }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="submittingDecision !== null"
            @click="submitDecision(false)"
          >
            <Spinner v-if="submittingDecision === 'cancel'" />
            {{ t("ai.toolCall.driveWrite.cancel") }}
          </Button>
        </CardFooter>
      </Card>

      <!-- GitHub-write confirm: same contract as the drive card. -->
      <Card v-else-if="isLiveInterrupt && gitHubWriteDraft" size="sm">
        <CardHeader>
          <CardTitle>{{ t(gitHubWriteTitleKey) }}</CardTitle>
          <CardDescription>
            {{ t("ai.toolCall.gitHubWrite.confirmHint") }}
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-1 text-sm">
          <div v-if="gitHubWriteDraft.repo" class="font-medium">
            {{ gitHubWriteDraft.repo
            }}<template v-if="gitHubWriteDraft.issueNumber"
              >#{{ gitHubWriteDraft.issueNumber }}</template
            >
          </div>
          <div v-if="gitHubWriteDraft.title" class="text-foreground">
            {{ gitHubWriteDraft.title }}
          </div>
          <div
            v-if="gitHubWriteDraft.bodyPreview"
            class="text-muted-foreground border-border border-l-2 pl-2 text-xs whitespace-pre-wrap"
          >
            {{ gitHubWriteDraft.bodyPreview }}
          </div>
          <div
            v-if="gitHubWriteDraft.state"
            class="text-muted-foreground/80 text-xs"
          >
            {{ t("ai.toolCall.gitHubWrite.state") }}:
            {{ gitHubWriteDraft.state }}
          </div>
          <div
            v-if="gitHubWriteDraft.labels.length > 0"
            class="text-muted-foreground/80 text-xs"
          >
            {{ t("ai.toolCall.gitHubWrite.labels") }}:
            {{ gitHubWriteDraft.labels.join(", ") }}
          </div>
        </CardContent>
        <CardFooter class="gap-2">
          <Button
            size="sm"
            :disabled="submittingDecision !== null"
            @click="submitDecision(true)"
          >
            <Spinner v-if="submittingDecision === 'approve'" />
            {{ t("ai.toolCall.gitHubWrite.approve") }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="submittingDecision !== null"
            @click="submitDecision(false)"
          >
            <Spinner v-if="submittingDecision === 'cancel'" />
            {{ t("ai.toolCall.gitHubWrite.cancel") }}
          </Button>
        </CardFooter>
      </Card>

      <!-- ============================================================== -->
      <!-- Live interrupt with malformed payload — polite escape hatch. -->
      <!-- ============================================================== -->
      <Item v-else-if="isLiveInterrupt" variant="muted" size="xs">
        <ItemContent>
          <ItemDescription class="text-xs">
            {{ t("ai.toolCall.malformedInterrupt") }}
          </ItemDescription>
        </ItemContent>
      </Item>

      <!-- ============================================================== -->
      <!-- Abandoned interrupt: the user sent another message instead of -->
      <!-- answering, so the chat moved on. Read-only historical card — no -->
      <!-- choice form (resuming a superseded interrupt would fail), just -->
      <!-- the question and a note that it went unanswered. -->
      <!-- ============================================================== -->
      <Card v-else-if="isAbandonedInterrupt && questionText" size="sm">
        <CardHeader>
          <CardTitle>{{ questionText }}</CardTitle>
        </CardHeader>
        <CardContent class="text-muted-foreground flex items-center gap-2">
          <IconCircleHelp />
          <span>{{ t("ai.toolCall.unanswered") }}</span>
        </CardContent>
      </Card>

      <!-- Abandoned calendar-write confirmation: the user moved on without -->
      <!-- deciding, so nothing was written. Read-only historical card. -->
      <Card v-else-if="isAbandonedInterrupt && calendarWriteDraft" size="sm">
        <CardHeader>
          <CardTitle>
            {{
              t(
                calendarWriteDraft.action === "create"
                  ? "ai.toolCall.calendarWrite.createTitle"
                  : "ai.toolCall.calendarWrite.updateTitle"
              )
            }}
          </CardTitle>
          <CardDescription v-if="calendarWriteDraft.summary">
            {{ calendarWriteDraft.summary }}
          </CardDescription>
        </CardHeader>
        <CardContent class="text-muted-foreground flex items-center gap-2">
          <IconCircleHelp />
          <span>{{ t("ai.toolCall.calendarWrite.unconfirmed") }}</span>
        </CardContent>
      </Card>

      <!-- Abandoned Drive-write confirmation: the user moved on without -->
      <!-- deciding, so nothing was written. Read-only historical card. -->
      <Card v-else-if="isAbandonedInterrupt && driveWriteDraft" size="sm">
        <CardHeader>
          <CardTitle>
            {{
              t(
                driveWriteDraft.action === "create"
                  ? "ai.toolCall.driveWrite.createTitle"
                  : "ai.toolCall.driveWrite.updateTitle"
              )
            }}
          </CardTitle>
          <CardDescription v-if="driveWriteDraft.name">
            {{ driveWriteDraft.name }}
          </CardDescription>
        </CardHeader>
        <CardContent class="text-muted-foreground flex items-center gap-2">
          <IconCircleHelp />
          <span>{{ t("ai.toolCall.driveWrite.unconfirmed") }}</span>
        </CardContent>
      </Card>

      <Card v-else-if="isAbandonedInterrupt && gitHubWriteDraft" size="sm">
        <CardHeader>
          <CardTitle>{{ t(gitHubWriteTitleKey) }}</CardTitle>
          <CardDescription v-if="gitHubWriteDraft.repo">
            {{ gitHubWriteDraft.repo
            }}<template v-if="gitHubWriteDraft.issueNumber"
              >#{{ gitHubWriteDraft.issueNumber }}</template
            >
          </CardDescription>
        </CardHeader>
        <CardContent class="text-muted-foreground flex items-center gap-2">
          <IconCircleHelp />
          <span>{{ t("ai.toolCall.gitHubWrite.unconfirmed") }}</span>
        </CardContent>
      </Card>

      <!-- ============================================================== -->
      <!-- Resolved interrupt: question (header) + the chosen answer. A -->
      <!-- completed result, so it shares the done-state Card anatomy -->
      <!-- rather than staying a transient-state Item. -->
      <!-- ============================================================== -->
      <Card
        v-else-if="isResolvedInterrupt && questionText && interruptAnswer"
        size="sm"
      >
        <CardHeader>
          <CardTitle>{{ questionText }}</CardTitle>
        </CardHeader>
        <CardContent class="flex items-center gap-2">
          <IconCheck class="text-muted-foreground" />
          <span class="text-foreground">{{ interruptAnswer }}</span>
        </CardContent>
      </Card>

      <!-- ============================================================== -->
      <!-- Calendar-write outcome: the REAL write result (or the interim -->
      <!-- "deciding" state between the optimistic flip and the streamed -->
      <!-- toolResult). Owns the declined case too — a deliberate Cancel -->
      <!-- is `ok: false` but not an error. -->
      <!-- ============================================================== -->
      <Card v-else-if="isCalendarWrite && calendarWriteResult" size="sm">
        <CardHeader v-if="calendarWriteDraft?.summary">
          <CardTitle>{{ calendarWriteDraft.summary }}</CardTitle>
        </CardHeader>
        <CardContent class="flex items-center gap-2">
          <template v-if="calendarWriteResult.kind === 'deciding'">
            <Spinner />
            <span class="text-muted-foreground">
              {{ t("ai.toolCall.calendarWrite.executing") }}
            </span>
          </template>
          <template v-else-if="calendarWriteResult.kind === 'written'">
            <IconCheck class="text-muted-foreground" />
            <span class="text-foreground">
              {{ t("ai.toolCall.calendarWrite.written") }}
              <a
                v-if="calendarWriteResult.link"
                :href="calendarWriteResult.link"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary underline-offset-2 hover:underline"
              >
                {{ t("ai.toolCall.calendarWrite.openEvent") }}
              </a>
            </span>
          </template>
          <template v-else-if="calendarWriteResult.kind === 'declined'">
            <IconCircleHelp class="text-muted-foreground" />
            <span class="text-muted-foreground">
              {{ t("ai.toolCall.calendarWrite.declined") }}
            </span>
          </template>
          <template v-else>
            <IconTriangleAlert class="text-destructive" />
            <span class="text-destructive">
              {{ t("ai.toolCall.calendarWrite.failed") }}
            </span>
          </template>
        </CardContent>
      </Card>

      <!-- Drive-write outcome: same contract as the calendar outcome card. -->
      <Card v-else-if="isDriveWrite && driveWriteResult" size="sm">
        <CardHeader v-if="driveWriteDraft?.name">
          <CardTitle>{{ driveWriteDraft.name }}</CardTitle>
        </CardHeader>
        <CardContent class="flex items-center gap-2">
          <template v-if="driveWriteResult.kind === 'deciding'">
            <Spinner />
            <span class="text-muted-foreground">
              {{ t("ai.toolCall.driveWrite.executing") }}
            </span>
          </template>
          <template v-else-if="driveWriteResult.kind === 'written'">
            <IconCheck class="text-muted-foreground" />
            <span class="text-foreground">
              {{ t("ai.toolCall.driveWrite.written") }}
              <a
                v-if="driveWriteResult.link"
                :href="driveWriteResult.link"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary underline-offset-2 hover:underline"
              >
                {{ t("ai.toolCall.driveWrite.openFile") }}
              </a>
            </span>
          </template>
          <template v-else-if="driveWriteResult.kind === 'declined'">
            <IconCircleHelp class="text-muted-foreground" />
            <span class="text-muted-foreground">
              {{ t("ai.toolCall.driveWrite.declined") }}
            </span>
          </template>
          <template v-else>
            <IconTriangleAlert class="text-destructive" />
            <span class="text-destructive">
              {{ t("ai.toolCall.driveWrite.failed") }}
            </span>
          </template>
        </CardContent>
      </Card>

      <!-- GitHub-write outcome: same contract as the calendar/drive cards. -->
      <Card v-else-if="isGitHubWrite && gitHubWriteResult" size="sm">
        <CardHeader v-if="gitHubWriteDraft?.repo">
          <CardTitle>
            {{ gitHubWriteDraft.repo
            }}<template v-if="gitHubWriteDraft.issueNumber"
              >#{{ gitHubWriteDraft.issueNumber }}</template
            >
          </CardTitle>
        </CardHeader>
        <CardContent class="flex items-center gap-2">
          <template v-if="gitHubWriteResult.kind === 'deciding'">
            <Spinner />
            <span class="text-muted-foreground">
              {{ t("ai.toolCall.gitHubWrite.executing") }}
            </span>
          </template>
          <template v-else-if="gitHubWriteResult.kind === 'written'">
            <IconCheck class="text-muted-foreground" />
            <span class="text-foreground">
              {{ t("ai.toolCall.gitHubWrite.written") }}
              <a
                v-if="gitHubWriteResult.link"
                :href="gitHubWriteResult.link"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary underline-offset-2 hover:underline"
              >
                {{ t("ai.toolCall.gitHubWrite.openItem") }}
              </a>
            </span>
          </template>
          <template v-else-if="gitHubWriteResult.kind === 'declined'">
            <IconCircleHelp class="text-muted-foreground" />
            <span class="text-muted-foreground">
              {{ t("ai.toolCall.gitHubWrite.declined") }}
            </span>
          </template>
          <template v-else>
            <IconTriangleAlert class="text-destructive" />
            <span class="text-destructive">
              {{ t("ai.toolCall.gitHubWrite.failed") }}
            </span>
          </template>
        </CardContent>
      </Card>

      <!-- ============================================================== -->
      <!-- Running: brief waiting note. Shares the done-state Card -->
      <!-- anatomy so the body's shell doesn't reflow when the result -->
      <!-- arrives — only the inner content swaps. The trigger's -->
      <!-- spinner carries the progress signal at the row level. -->
      <!-- ============================================================== -->
      <Card v-else-if="isRunning" size="sm">
        <CardContent class="flex items-center gap-2">
          <Spinner />
          <span class="text-muted-foreground">
            {{ t("ai.toolCall.waitingForReturn") }}
          </span>
        </CardContent>
      </Card>

      <!-- ============================================================== -->
      <!-- rollDice: dice icon + big number. No input, so no header. -->
      <!-- ============================================================== -->
      <Card
        v-else-if="tool.name === 'rollDice' && diceOutput !== null"
        size="sm"
      >
        <CardContent class="flex items-center gap-2">
          <IconDices class="text-muted-foreground size-8" />
          <div class="flex flex-col">
            <span class="text-foreground text-2xl leading-none font-semibold">
              {{ diceOutput }}
            </span>
            <span class="text-muted-foreground">
              {{ t("ai.toolCall.dice.rolled") }}
            </span>
          </div>
        </CardContent>
      </Card>

      <!-- ============================================================== -->
      <!-- searchWorkspaceNodes: query (header) + result count, then the -->
      <!-- per-result rows in the body (or an empty state). -->
      <!-- ============================================================== -->
      <Card
        v-else-if="tool.name === 'searchWorkspaceNodes' && searchOutput"
        size="sm"
      >
        <CardHeader v-if="searchInput">
          <CardTitle>"{{ searchInput.query }}"</CardTitle>
          <CardDescription>
            {{
              t("ai.toolCall.search.resultCount", {
                count: searchOutput.results.length,
              })
            }}
            <template v-if="searchOutput.truncated">
              {{ t("ai.toolCall.search.truncated") }}
            </template>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty v-if="searchOutput.results.length === 0" class="border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconSearch />
              </EmptyMedia>
              <EmptyTitle>{{ t("ai.toolCall.search.empty") }}</EmptyTitle>
            </EmptyHeader>
          </Empty>
          <ItemGroup v-else>
            <Item
              v-for="result in searchOutput.results"
              :key="`${result.scope}:${result.nodeId}`"
              variant="outline"
              size="xs"
            >
              <ItemMedia variant="icon">
                <Component
                  :is="result.type === 'folder' ? IconFolder : IconFileText"
                  class="text-muted-foreground"
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle class="break-all">{{ result.name }}</ItemTitle>
                <ItemDescription v-if="result.snippet" class="text-xs">
                  {{ result.snippet }}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">
                  {{ searchScopeLabel(result.scope) }}
                </Badge>
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <!-- ============================================================== -->
      <!-- summarizeNode: error variant OR structured summary card. -->
      <!-- ============================================================== -->
      <Card
        v-else-if="
          tool.name === 'summarizeNode' &&
          summarizeOutput &&
          summarizeOutput.error
        "
        size="sm"
      >
        <CardHeader>
          <CardTitle>{{ t("ai.toolCall.summarize.errorTitle") }}</CardTitle>
        </CardHeader>
        <CardContent class="text-destructive flex items-center gap-2">
          <IconTriangleAlert />
          <span>{{ summarizeOutput.error }}</span>
        </CardContent>
      </Card>

      <Card
        v-else-if="tool.name === 'summarizeNode' && summarizeOutput"
        size="sm"
      >
        <CardContent class="flex flex-col gap-2">
          <p class="text-foreground">
            {{ summarizeOutput.summary }}
          </p>
          <div
            v-if="summarizeOutput.keyPoints.length > 0"
            class="flex flex-col gap-2"
          >
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ t("ai.toolCall.summarize.keyPoints") }}
            </span>
            <ul
              class="text-foreground marker:text-muted list-inside list-disc space-y-1"
            >
              <li v-for="(point, idx) in summarizeOutput.keyPoints" :key="idx">
                {{ point }}
              </li>
            </ul>
          </div>
          <div
            v-if="summarizeOutput.suggestedTags.length > 0"
            class="flex flex-col gap-2"
          >
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ t("ai.toolCall.summarize.tags") }}
            </span>
            <div class="flex flex-wrap gap-1">
              <Badge
                v-for="tag in summarizeOutput.suggestedTags"
                :key="tag"
                variant="secondary"
              >
                {{ tag }}
              </Badge>
            </div>
          </div>
        </CardContent>
        <CardFooter
          v-if="summarizeOutput.model"
          class="text-muted-foreground text-xs"
        >
          {{
            t("ai.toolCall.summarize.modelFooter", {
              model: summarizeOutput.model,
            })
          }}
        </CardFooter>
      </Card>

      <!-- ============================================================== -->
      <!-- compareNodes: error variant OR structured comparison card. -->
      <!-- ============================================================== -->
      <Card
        v-else-if="
          tool.name === 'compareNodes' && compareOutput && compareOutput.error
        "
        size="sm"
      >
        <CardHeader>
          <CardTitle>{{ t("ai.toolCall.compare.errorTitle") }}</CardTitle>
        </CardHeader>
        <CardContent class="text-destructive flex items-center gap-2">
          <IconTriangleAlert />
          <span>{{ compareOutput.error }}</span>
        </CardContent>
      </Card>

      <Card v-else-if="tool.name === 'compareNodes' && compareOutput" size="sm">
        <CardHeader v-if="compareInput?.focus">
          <CardTitle>{{ compareInput.focus }}</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <p v-if="compareOutput.overview" class="text-foreground">
            {{ compareOutput.overview }}
          </p>
          <div class="flex flex-col gap-2">
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ t("ai.toolCall.compare.agreements") }}
            </span>
            <ul
              v-if="compareOutput.agreements.length > 0"
              class="text-foreground marker:text-muted list-inside list-disc space-y-1"
            >
              <li
                v-for="(point, idx) in compareOutput.agreements"
                :key="`a${idx}`"
              >
                {{ point }}
              </li>
            </ul>
            <span v-else class="text-muted-foreground text-xs">
              {{ t("ai.toolCall.compare.noPoints") }}
            </span>
          </div>
          <div class="flex flex-col gap-2">
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ t("ai.toolCall.compare.disagreements") }}
            </span>
            <ul
              v-if="compareOutput.disagreements.length > 0"
              class="text-foreground marker:text-muted list-inside list-disc space-y-1"
            >
              <li
                v-for="(point, idx) in compareOutput.disagreements"
                :key="`d${idx}`"
              >
                {{ point }}
              </li>
            </ul>
            <span v-else class="text-muted-foreground text-xs">
              {{ t("ai.toolCall.compare.noPoints") }}
            </span>
          </div>
          <div
            v-if="compareOutput.perNode.length > 0"
            class="flex flex-col gap-2"
          >
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ t("ai.toolCall.compare.perNode") }}
            </span>
            <ItemGroup>
              <Item
                v-for="entry in compareOutput.perNode"
                :key="`${entry.scope}:${entry.nodeId}`"
                variant="outline"
                size="xs"
              >
                <ItemMedia variant="icon">
                  <IconFileText class="text-muted-foreground" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle class="break-all">{{ entry.name }}</ItemTitle>
                  <ItemDescription v-if="entry.contribution" class="text-xs">
                    {{ entry.contribution }}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant="secondary">
                    {{ searchScopeLabel(entry.scope) }}
                  </Badge>
                </ItemActions>
              </Item>
            </ItemGroup>
          </div>
        </CardContent>
        <CardFooter
          v-if="compareOutput.model"
          class="text-muted-foreground text-xs"
        >
          {{
            t("ai.toolCall.compare.modelFooter", {
              model: compareOutput.model,
            })
          }}
        </CardFooter>
      </Card>

      <!-- ============================================================== -->
      <!-- findRelatedNodes: header with result count, then per-node rows. -->
      <!-- Same row layout as searchWorkspaceNodes for visual consistency. -->
      <!-- ============================================================== -->
      <Card
        v-else-if="tool.name === 'findRelatedNodes' && relatedOutput"
        size="sm"
      >
        <CardHeader v-if="relatedInput">
          <CardDescription>
            {{
              t("ai.toolCall.related.resultCount", {
                count: relatedOutput.results.length,
              })
            }}
            <template v-if="relatedOutput.truncated">
              {{ t("ai.toolCall.related.truncated") }}
            </template>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty v-if="relatedOutput.results.length === 0" class="border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconSearch />
              </EmptyMedia>
              <EmptyTitle>{{ t("ai.toolCall.related.empty") }}</EmptyTitle>
            </EmptyHeader>
          </Empty>
          <ItemGroup v-else>
            <Item
              v-for="result in relatedOutput.results"
              :key="`${result.scope}:${result.nodeId}`"
              variant="outline"
              size="xs"
            >
              <ItemMedia variant="icon">
                <Component
                  :is="result.type === 'folder' ? IconFolder : IconFileText"
                  class="text-muted-foreground"
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle class="break-all">{{ result.name }}</ItemTitle>
                <ItemDescription v-if="result.snippet" class="text-xs">
                  {{ result.snippet }}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">
                  {{ searchScopeLabel(result.scope) }}
                </Badge>
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <!-- ============================================================== -->
      <!-- browseInternet: query header + grounded answer (markdown) + -->
      <!-- the source links the answer was grounded on. -->
      <!-- ============================================================== -->
      <Card
        v-else-if="tool.name === 'browseInternet' && browseInternetOutput"
        size="sm"
      >
        <CardHeader v-if="browseInternetInput">
          <CardTitle>{{ browseInternetInput }}</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <AppMarkdown surface="chat" :content="browseInternetOutput.answer" />
          <div
            v-if="browseInternetOutput.sources.length > 0"
            class="flex flex-col gap-2"
          >
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ t("ai.toolCall.browse.sources") }}
            </span>
            <ul
              class="text-foreground marker:text-muted list-inside list-disc space-y-1"
            >
              <li
                v-for="source in browseInternetOutput.sources"
                :key="source.url"
              >
                <a
                  :href="source.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-destructive hover:text-destructive break-all hover:underline"
                >
                  {{ source.title }}
                </a>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <!-- ============================================================== -->
      <!-- Fallback: unknown tool name OR narrower failed. Show a markdown -->
      <!-- preview of a recognized text field (query / answer / …) when -->
      <!-- present, else a JSON dump, so the message column at least -->
      <!-- carries something meaningful. -->
      <!-- ============================================================== -->
      <Card v-else-if="!hasCustomDoneRenderer" size="sm">
        <CardContent class="flex flex-col gap-2">
          <div v-if="inputMarkdown" class="flex flex-col gap-2">
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ inputLabel }}
            </span>
            <AppMarkdown surface="chat" :content="inputMarkdown" />
          </div>
          <div class="flex flex-col gap-2">
            <span class="text-muted-foreground text-xs font-medium uppercase">
              {{ outputLabel }}
            </span>
            <AppMarkdown surface="chat" :content="outputMarkdown" />
          </div>
        </CardContent>
      </Card>
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
/* Flatten in-chat cards: the chat surface is painted with the card color
   (body bg in `@/styles/index.css`), so the default shadow/ring add no
   contrast — and the shadow is invisible in dark mode (near-black card on
   near-black page). Shadow + ring are both composed into `box-shadow`, so
   one reset clears both. */
:deep([data-slot="card"]) {
  box-shadow: none;
}
</style>

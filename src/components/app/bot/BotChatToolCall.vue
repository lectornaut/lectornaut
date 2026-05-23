<script lang="ts" setup>
/**
 * BotChatToolCall — renders one tool invocation segment from an agent
 * message. The card shell (collapsible header with state badge) is
 * uniform across every tool; the body switches between per-tool
 * presentations based on `tool.name`, with a JSON fallback for tools
 * we don't have a dedicated view for.
 *
 * Five state branches:
 *
 *   1. Pending interrupt (`isInterrupt && output === undefined`):
 *      The chat is paused waiting for the user to answer an
 *      `askQuestion` interrupt. Renders the question and choice
 *      buttons; clicking one calls `respondToInterrupt` to resume.
 *
 *   2. Resolved interrupt (`isInterrupt && output` set):
 *      The user answered an `askQuestion`. Renders the question with
 *      the chosen answer highlighted, instead of dumping the JSON
 *      input/output through the generic done view.
 *
 *   3. Running (`output === undefined`, no interrupt):
 *      A normal tool is executing on the server. Shows a spinner +
 *      brief waiting message in the body. In practice this state is
 *      brief — execution is fast.
 *
 *   4. Done with a dedicated renderer (`output` set, `tool.name`
 *      matches one of our known tools): renders a tool-specific card
 *      (weather, dice, search results, summary, …).
 *
 *   5. Done with no dedicated renderer (`output` set, unknown
 *      `tool.name`): falls back to a generic JSON dump of input /
 *      output so brand-new tools added to the server still render
 *      something reasonable before the UI catches up.
 *
 * The card body is collapsible so a chat with several tool calls
 * doesn't dominate the message column. Default state: open while
 * running / awaiting input; collapsed once complete.
 *
 * Each tool's typed accessor (`weatherInput`, `searchOutput`, …) is a
 * defensive narrower — it returns `null` if the model's payload
 * doesn't match the expected shape, in which case the template falls
 * through to the generic JSON view rather than crashing.
 */
import {
  BotChatContextKey,
  type BotChatToolCall,
} from "@/composables/useBotChat"
import {
  IconBot,
  IconBotMessageSquare,
  IconCheck,
  IconChevronRight,
  IconCircleHelp,
  IconCloudRain,
  IconDices,
  IconFileText,
  IconFolder,
  IconSearch,
  IconSun,
  IconTriangleAlert,
} from "@/data/icons"
import { computed, inject, ref, watch } from "vue"

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

const isInterrupt = computed(
  () => props.tool.isInterrupt === true && props.tool.output === undefined
)
const isRunning = computed(
  () => !isInterrupt.value && props.tool.output === undefined
)
const isDone = computed(
  () => !isInterrupt.value && props.tool.output !== undefined
)

// Initial state is derived from the tool's current phase, NOT hardcoded
// open: cards restored from history after a refresh already have `output`
// set, and the watcher below only fires on a live pending→done
// *transition* (Vue's `watch` isn't immediate), so a hardcoded `true`
// would leave every finished card expanded. Open while running OR
// awaiting input (the spinner/form is the point of the card then);
// collapsed once an answer/result exists. The watcher then collapses the
// card the moment a result arrives during a live session. The user can
// override either way by clicking the trigger.
const open = ref(props.tool.output === undefined)
watch(
  () => props.tool.output === undefined,
  (pending) => {
    if (!pending) open.value = false
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

const isResolvedInterrupt = computed(
  () => props.tool.isInterrupt === true && props.tool.output !== undefined
)

// Narrow `tool.output` to the `{ answer: string }` shape produced by
// `respondToInterrupt`. Anything else returns null and we fall through
// to the generic JSON view.
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

// ── Per-tool typed accessors ──────────────────────────────────────────────
//
// Each accessor narrows `tool.input` / `tool.output` against the
// server-side schema for that tool. Returns `null` on shape mismatch
// so the template falls through to the JSON fallback view instead of
// rendering a half-broken card. None of these need to be perfectly
// strict — they just need to recognize a well-formed payload.

// getWeather — input: { location }, output: { temperature, condition, advisory? }
interface WeatherInput {
  location: string
}
interface WeatherOutput {
  temperature: number
  condition: "sunny" | "cloudy" | "rainy" | "snowy"
  advisory?: string
}

const weatherInput = computed<WeatherInput | null>(() => {
  if (props.tool.name !== "getWeather") return null
  const raw = props.tool.input
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const location = typeof obj.location === "string" ? obj.location : ""
  return location ? { location } : null
})

const weatherOutput = computed<WeatherOutput | null>(() => {
  if (props.tool.name !== "getWeather") return null
  const raw = props.tool.output
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const temperature =
    typeof obj.temperature === "number" ? obj.temperature : null
  const condition =
    obj.condition === "sunny" ||
    obj.condition === "cloudy" ||
    obj.condition === "rainy" ||
    obj.condition === "snowy"
      ? obj.condition
      : null
  if (temperature === null || condition === null) return null
  const advisory =
    typeof obj.advisory === "string" && obj.advisory ? obj.advisory : undefined
  return { temperature, condition, advisory }
})

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

const weatherIcon = computed(() => {
  const cond = weatherOutput.value?.condition
  if (cond === "sunny") return IconSun
  // No dedicated cloud / snow icons in our set — `IconCloudRain` works
  // visually for cloudy / rainy / snowy. The condition label below the
  // icon disambiguates.
  return IconCloudRain
})

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
    case "getWeather":
      return weatherOutput.value !== null
    case "rollDice":
      return diceOutput.value !== null
    case "searchWorkspaceNodes":
      return searchOutput.value !== null
    case "summarizeNode":
      return summarizeOutput.value !== null
    case "browseInternet":
      return browseInternetOutput.value !== null
    default:
      return false
  }
})
</script>

<template>
  <Collapsible v-model:open="open" class="grid gap-2">
    <CollapsibleTrigger as-child>
      <Item variant="muted" size="xs">
        <ItemMedia variant="icon">
          <TooltipProvider>
            <Tooltip v-if="isInterrupt">
              <TooltipTrigger as-child>
                <IconCircleHelp />
              </TooltipTrigger>
              <TooltipContent>{{ t("ai.toolCall.needsInput") }}</TooltipContent>
            </Tooltip>
            <Tooltip v-else-if="isRunning">
              <TooltipTrigger as-child>
                <Spinner />
              </TooltipTrigger>
              <TooltipContent>{{ t("ai.toolCall.running") }}</TooltipContent>
            </Tooltip>
            <Tooltip v-else>
              <TooltipTrigger as-child>
                <IconCheck />
              </TooltipTrigger>
              <TooltipContent>{{ t("ai.toolCall.done") }}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            {{ tool.name }}
            <IconChevronRight
              class="text-muted-foreground transition-transform will-change-transform"
              :class="{ 'rotate-90': open }"
            />
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <Component :is="isInterrupt ? IconBotMessageSquare : IconBot" />
        </ItemActions>
      </Item>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <!-- ============================================================== -->
      <!-- Pending interrupt: question + choices form. -->
      <!-- ============================================================== -->
      <Card v-if="isInterrupt && askQuestionInput" size="sm">
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
      <!-- Pending interrupt with malformed payload — polite escape hatch. -->
      <!-- ============================================================== -->
      <Item v-else-if="isInterrupt" variant="muted" size="xs">
        <ItemContent>
          <ItemDescription class="line-clamp-none">
            {{ t("ai.toolCall.malformedInterrupt") }}
          </ItemDescription>
        </ItemContent>
      </Item>

      <!-- ============================================================== -->
      <!-- Resolved interrupt: question with the chosen answer highlighted. -->
      <!-- ============================================================== -->
      <Item
        v-else-if="isResolvedInterrupt && askQuestionInput && interruptAnswer"
        variant="outline"
        size="xs"
      >
        <ItemMedia variant="icon">
          <IconCheck />
        </ItemMedia>
        <ItemContent>
          <ItemDescription>{{ askQuestionInput.question }}</ItemDescription>
          <ItemTitle>{{ interruptAnswer }}</ItemTitle>
        </ItemContent>
      </Item>

      <!-- ============================================================== -->
      <!-- Running: brief waiting note. The header's spinner indicates -->
      <!-- progress; the body stays minimal so the layout doesn't jump -->
      <!-- when the result arrives. -->
      <!-- ============================================================== -->
      <Item v-else-if="isRunning" variant="muted" size="xs">
        <ItemMedia variant="icon">
          <Spinner />
        </ItemMedia>
        <ItemContent>
          <ItemDescription class="line-clamp-none">
            {{ t("ai.toolCall.waitingForReturn") }}
          </ItemDescription>
        </ItemContent>
      </Item>

      <!-- ============================================================== -->
      <!-- getWeather: location header + condition icon, big temperature, -->
      <!-- condition label, and an optional advisory footer. -->
      <!-- ============================================================== -->
      <Card v-else-if="tool.name === 'getWeather' && weatherOutput" size="sm">
        <CardHeader v-if="weatherInput">
          <CardTitle>{{ weatherInput.location }}</CardTitle>
        </CardHeader>
        <CardContent class="flex items-center gap-2">
          <Component :is="weatherIcon" class="text-muted-foreground size-8" />
          <div class="flex flex-col">
            <span class="text-foreground text-2xl leading-none font-semibold">
              {{ weatherOutput.temperature }}°F
            </span>
            <span class="text-muted-foreground">
              {{ weatherOutput.condition }}
            </span>
          </div>
        </CardContent>
        <CardFooter
          v-if="weatherOutput.advisory"
          class="text-muted-foreground text-xs"
        >
          {{ weatherOutput.advisory }}
        </CardFooter>
      </Card>

      <!-- ============================================================== -->
      <!-- rollDice: dice icon + big number. -->
      <!-- ============================================================== -->
      <Item
        v-else-if="tool.name === 'rollDice' && diceOutput !== null"
        variant="outline"
        size="xs"
      >
        <ItemMedia variant="icon">
          <IconDices />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            {{ diceOutput }}
          </ItemTitle>
          <ItemDescription>{{ t("ai.toolCall.dice.rolled") }}</ItemDescription>
        </ItemContent>
      </Item>

      <!-- ============================================================== -->
      <!-- searchWorkspaceNodes: query chip + per-result rows. -->
      <!-- ============================================================== -->
      <div
        v-else-if="tool.name === 'searchWorkspaceNodes' && searchOutput"
        class="flex flex-col gap-2"
      >
        <Item v-if="searchInput" variant="outline" size="xs">
          <ItemMedia variant="icon">
            <IconSearch class="text-muted-foreground" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>"{{ searchInput.query }}"</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ItemDescription>
              {{
                t("ai.toolCall.search.resultCount", {
                  count: searchOutput.results.length,
                })
              }}
              <template v-if="searchOutput.truncated">
                {{ t("ai.toolCall.search.truncated") }}
              </template>
            </ItemDescription>
          </ItemActions>
        </Item>
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
              <ItemDescription v-if="result.snippet">
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
      </div>

      <!-- ============================================================== -->
      <!-- summarizeNode: error variant OR structured summary card. -->
      <!-- ============================================================== -->
      <Alert
        v-else-if="
          tool.name === 'summarizeNode' &&
          summarizeOutput &&
          summarizeOutput.error
        "
        variant="destructive"
      >
        <IconTriangleAlert />
        <AlertTitle>{{ t("ai.toolCall.summarize.errorTitle") }}</AlertTitle>
        <AlertDescription>{{ summarizeOutput.error }}</AlertDescription>
      </Alert>

      <Card
        v-else-if="tool.name === 'summarizeNode' && summarizeOutput"
        size="sm"
      >
        <CardHeader>
          <CardTitle>
            {{ t("ai.toolCall.summarize.heading") }}
          </CardTitle>
        </CardHeader>
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
      <!-- browseInternet: query header + grounded answer (markdown) + -->
      <!-- the source links the answer was grounded on. -->
      <!-- ============================================================== -->
      <Card
        v-else-if="tool.name === 'browseInternet' && browseInternetOutput"
        size="sm"
      >
        <CardHeader>
          <CardTitle>
            {{ t("ai.toolCall.browse.heading") }}
          </CardTitle>
          <CardDescription v-if="browseInternetInput">
            {{ browseInternetInput }}
          </CardDescription>
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
                  class="text-destructive break-all hover:underline"
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
      <div v-else-if="!hasCustomDoneRenderer" class="flex flex-col gap-2">
        <div v-if="inputMarkdown" class="flex flex-col gap-2">
          <span class="text-muted-foreground text-xs font-medium uppercase">
            {{ t("ai.toolCall.input") }}
          </span>
          <AppMarkdown surface="chat" :content="inputMarkdown" />
        </div>
        <div class="flex flex-col gap-2">
          <span class="text-muted-foreground text-xs font-medium uppercase">
            {{ t("ai.toolCall.output") }}
          </span>
          <AppMarkdown surface="chat" :content="outputMarkdown" />
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

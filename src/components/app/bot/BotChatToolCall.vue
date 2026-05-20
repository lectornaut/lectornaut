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
  IconCheck,
  IconChevronDown,
  IconCloudRain,
  IconDices,
  IconFileText,
  IconFolder,
  IconLoader2,
  IconMapPin,
  IconMessageCircle,
  IconSearch,
  IconSparkles,
  IconSun,
  IconWrench,
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

// Auto-expand while running OR awaiting input (the form is the whole
// point of the card in those states), then collapse the moment we have
// an answer so finished cards stop crowding the message column. The
// user can override either way by clicking the trigger.
const open = ref(true)
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
    default:
      return false
  }
})
</script>

<template>
  <Collapsible v-model:open="open" class="grid gap-2">
    <CollapsibleTrigger
      class="flex w-full items-center gap-2 rounded-md border p-2 text-left text-xs transition-colors"
      :class="
        isInterrupt
          ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
          : 'border-border bg-background/60 hover:bg-background'
      "
    >
      <Component
        :is="isInterrupt ? IconMessageCircle : IconWrench"
        :class="isInterrupt ? 'text-primary' : 'text-muted-foreground'"
      />
      <span class="text-foreground truncate font-medium">{{ tool.name }}</span>
      <span
        class="text-muted-foreground ml-auto flex shrink-0 items-center gap-1"
      >
        <template v-if="isInterrupt">
          <span class="text-primary font-medium">
            {{ t("ai.toolCall.needsInput") }}
          </span>
        </template>
        <template v-else-if="isRunning">
          <IconLoader2 class="animate-spin" />
          <span>{{ t("ai.toolCall.running") }}</span>
        </template>
        <template v-else>
          <IconCheck />
          <span>{{ t("ai.toolCall.done") }}</span>
        </template>
      </span>
      <IconChevronDown
        class="text-muted-foreground shrink-0 transition-transform"
        :class="{ 'rotate-180': open }"
      />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <!-- ============================================================== -->
      <!-- Pending interrupt: question + choices form. -->
      <!-- ============================================================== -->
      <div
        v-if="isInterrupt && askQuestionInput"
        class="border-primary/30 bg-primary/5 space-y-2 rounded-md border p-2 text-xs"
      >
        <p class="text-foreground text-sm font-medium">
          {{ askQuestionInput.question }}
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            v-for="choice in askQuestionInput.choices"
            :key="choice"
            variant="outline"
            size="sm"
            :disabled="isSubmitting"
            class="h-auto py-1 text-xs"
            @click="submitAnswer(choice)"
          >
            <Spinner v-if="submittingChoice === choice" />
            {{ choice }}
          </Button>
        </div>
        <div
          v-if="askQuestionInput.allowOther"
          class="border-primary/20 mt-2 flex items-center gap-2 border-t pt-2"
        >
          <Input
            v-model="customAnswer"
            :placeholder="t('ai.toolCall.customAnswer')"
            :disabled="isSubmitting"
            @keydown="onCustomKeydown"
          />
          <Button
            size="sm"
            :disabled="!customAnswer.trim() || isSubmitting"
            @click="submitCustom"
          >
            <Spinner v-if="submittingChoice === customAnswer.trim()" />
            {{ t("ai.toolCall.send") }}
          </Button>
        </div>
      </div>

      <!-- ============================================================== -->
      <!-- Pending interrupt with malformed payload — polite escape hatch. -->
      <!-- ============================================================== -->
      <div
        v-else-if="isInterrupt"
        class="border-border bg-background/40 rounded-md border p-2 text-xs"
      >
        <p class="text-muted-foreground italic">
          {{ t("ai.toolCall.malformedInterrupt") }}
        </p>
      </div>

      <!-- ============================================================== -->
      <!-- Resolved interrupt: question with the chosen answer highlighted. -->
      <!-- ============================================================== -->
      <div
        v-else-if="isResolvedInterrupt && askQuestionInput && interruptAnswer"
        class="border-primary/30 bg-primary/5 space-y-1.5 rounded-md border p-3 text-xs"
      >
        <p class="text-foreground text-sm font-medium">
          {{ askQuestionInput.question }}
        </p>
        <p class="text-primary flex items-center gap-2">
          <IconCheck />
          <span class="font-medium">{{ interruptAnswer }}</span>
        </p>
      </div>

      <!-- ============================================================== -->
      <!-- Running: brief waiting note. The header's spinner indicates -->
      <!-- progress; the body stays minimal so the layout doesn't jump -->
      <!-- when the result arrives. -->
      <!-- ============================================================== -->
      <div
        v-else-if="isRunning"
        class="border-border bg-background/40 rounded-md border p-2 text-xs"
      >
        <p class="text-muted-foreground flex items-center gap-2 italic">
          <IconLoader2 class="animate-spin" />
          {{ t("ai.toolCall.waitingForReturn") }}
        </p>
      </div>

      <!-- ============================================================== -->
      <!-- getWeather: location chip + big temperature + condition icon. -->
      <!-- ============================================================== -->
      <div
        v-else-if="tool.name === 'getWeather' && weatherOutput"
        class="border-border bg-background/40 flex flex-col gap-2 rounded border p-2 text-xs"
      >
        <div
          v-if="weatherInput"
          class="text-muted-foreground flex items-center gap-2"
        >
          <IconMapPin />
          <span>{{ weatherInput.location }}</span>
        </div>
        <div class="flex items-center gap-3">
          <Component :is="weatherIcon" class="text-primary size-8 shrink-0" />
          <div class="flex flex-col">
            <span class="text-foreground text-xl leading-none font-semibold">
              {{ weatherOutput.temperature }}°F
            </span>
            <span class="text-muted-foreground text-xs capitalize">
              {{ weatherOutput.condition }}
            </span>
          </div>
        </div>
        <p
          v-if="weatherOutput.advisory"
          class="text-foreground border-t pt-2 leading-relaxed"
        >
          {{ weatherOutput.advisory }}
        </p>
      </div>

      <!-- ============================================================== -->
      <!-- rollDice: dice icon + big number. -->
      <!-- ============================================================== -->
      <div
        v-else-if="tool.name === 'rollDice' && diceOutput !== null"
        class="border-border bg-background/40 flex items-center gap-3 rounded-md border p-3 text-xs"
      >
        <IconDices class="text-primary size-8 shrink-0" />
        <div class="flex flex-col">
          <span class="text-foreground text-xl leading-none font-semibold">
            {{ diceOutput }}
          </span>
          <span class="text-muted-foreground text-xs">
            {{ t("ai.toolCall.dice.rolled") }}
          </span>
        </div>
      </div>

      <!-- ============================================================== -->
      <!-- searchWorkspaceNodes: query chip + per-result rows. -->
      <!-- ============================================================== -->
      <div
        v-else-if="tool.name === 'searchWorkspaceNodes' && searchOutput"
        class="border-border bg-background/40 flex flex-col gap-2 rounded border p-2 text-xs"
      >
        <div
          v-if="searchInput"
          class="text-muted-foreground flex flex-wrap items-center gap-2"
        >
          <IconSearch />
          <span class="text-foreground italic">"{{ searchInput.query }}"</span>
          <span class="text-muted-foreground">·</span>
          <span>
            {{
              t("ai.toolCall.search.resultCount", {
                count: searchOutput.results.length,
              })
            }}
            <template v-if="searchOutput.truncated">
              {{ t("ai.toolCall.search.truncated") }}
            </template>
          </span>
        </div>
        <Empty
          v-if="searchOutput.results.length === 0"
          class="rounded border border-dashed p-4"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconSearch />
            </EmptyMedia>
            <EmptyTitle>{{ t("ai.toolCall.search.empty") }}</EmptyTitle>
          </EmptyHeader>
        </Empty>
        <ul v-else class="flex flex-col gap-2">
          <li
            v-for="result in searchOutput.results"
            :key="`${result.scope}:${result.nodeId}`"
            class="border-border bg-card flex flex-col gap-1 rounded border p-2"
          >
            <div class="flex items-center gap-2">
              <Component
                :is="result.type === 'folder' ? IconFolder : IconFileText"
                class="text-muted-foreground shrink-0"
              />
              <span class="text-foreground font-medium break-all">
                {{ result.name }}
              </span>
              <Badge variant="secondary" class="ml-auto text-xs">
                {{ searchScopeLabel(result.scope) }}
              </Badge>
            </div>
            <p
              v-if="result.snippet"
              class="text-muted-foreground line-clamp-2 leading-snug"
            >
              {{ result.snippet }}
            </p>
          </li>
        </ul>
      </div>

      <!-- ============================================================== -->
      <!-- summarizeNode: error variant OR structured summary card. -->
      <!-- ============================================================== -->
      <div
        v-else-if="
          tool.name === 'summarizeNode' &&
          summarizeOutput &&
          summarizeOutput.error
        "
        class="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-xs"
      >
        <p class="text-destructive">{{ summarizeOutput.error }}</p>
      </div>
      <div
        v-else-if="tool.name === 'summarizeNode' && summarizeOutput"
        class="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-3 text-xs"
      >
        <header class="flex items-center gap-2">
          <IconSparkles class="text-muted-foreground" />
          <span class="text-muted-foreground text-xs font-medium uppercase">
            {{ t("ai.toolCall.summarize.heading") }}
          </span>
        </header>
        <p class="text-foreground leading-relaxed">
          {{ summarizeOutput.summary }}
        </p>
        <div
          v-if="summarizeOutput.keyPoints.length > 0"
          class="flex flex-col gap-1"
        >
          <span class="text-muted-foreground text-xs font-medium uppercase">
            {{ t("ai.toolCall.summarize.keyPoints") }}
          </span>
          <ul class="text-foreground list-inside list-disc space-y-1">
            <li
              v-for="(point, idx) in summarizeOutput.keyPoints"
              :key="idx"
              class="leading-relaxed"
            >
              {{ point }}
            </li>
          </ul>
        </div>
        <div
          v-if="summarizeOutput.suggestedTags.length > 0"
          class="flex flex-col gap-1"
        >
          <span class="text-muted-foreground text-xs font-medium uppercase">
            {{ t("ai.toolCall.summarize.tags") }}
          </span>
          <div class="flex flex-wrap gap-1">
            <Badge
              v-for="tag in summarizeOutput.suggestedTags"
              :key="tag"
              variant="secondary"
              class="text-xs"
            >
              {{ tag }}
            </Badge>
          </div>
        </div>
        <p v-if="summarizeOutput.model" class="text-muted-foreground text-xs">
          {{
            t("ai.toolCall.summarize.modelFooter", {
              model: summarizeOutput.model,
            })
          }}
        </p>
      </div>

      <!-- ============================================================== -->
      <!-- Fallback: unknown tool name OR narrower failed — show JSON so -->
      <!-- the message column at least carries something meaningful. -->
      <!-- ============================================================== -->
      <div
        v-else-if="!hasCustomDoneRenderer"
        class="border-border bg-background/40 space-y-2 rounded-md border p-2 text-xs"
      >
        <div v-if="inputText">
          <p
            class="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase"
          >
            {{ t("ai.toolCall.input") }}
          </p>
          <pre
            class="bg-muted text-foreground overflow-x-auto rounded px-2 py-1.5 font-mono text-xs leading-snug whitespace-pre-wrap"
          ><code>{{ inputText }}</code></pre>
        </div>
        <div>
          <p
            class="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase"
          >
            {{ t("ai.toolCall.output") }}
          </p>
          <pre
            class="bg-muted text-foreground overflow-x-auto rounded px-2 py-1.5 font-mono text-xs leading-snug whitespace-pre-wrap"
          ><code>{{ outputText }}</code></pre>
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

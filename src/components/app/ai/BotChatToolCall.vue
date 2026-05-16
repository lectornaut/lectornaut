<script lang="ts" setup>
/**
 * BotChatToolCall — renders one tool invocation segment from an agent
 * message. Four render modes, picked by `tool` shape:
 *
 *   1. Pending interrupt (`isInterrupt && output === undefined`):
 *      The chat is paused waiting for the user to answer an
 *      `askQuestion` interrupt. Renders the question and choice
 *      buttons; clicking one calls `respondToInterrupt` to resume.
 *
 *   2. Running (`output === undefined`, no interrupt):
 *      A normal tool is executing on the server. Shows a spinner.
 *      In practice this state is brief — execution is fast.
 *
 *   3. Resolved interrupt (`isInterrupt && output` set):
 *      The user answered an `askQuestion`. Renders the question with
 *      the chosen answer highlighted, instead of dumping the JSON
 *      input/output through the generic done view. Without this
 *      dedicated branch, the JSON dump would briefly flash in the
 *      card body during the auto-collapse animation.
 *
 *   4. Done (`output` set, not an interrupt):
 *      Tool returned. Shows the JSON input and output collapsed by
 *      default.
 *
 * The card body is collapsible so a chat with several tool calls
 * doesn't dominate the message column. Default state: open while
 * running / awaiting input; collapsed once complete.
 */
import {
  BotChatContextKey,
  type BotChatToolCall,
} from "@/composables/useBotChat"
import {
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconMessageCircle,
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
</script>

<template>
  <Collapsible v-model:open="open" class="my-1.5 w-full">
    <CollapsibleTrigger
      class="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors"
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
        class="text-muted-foreground size-3.5 shrink-0 transition-transform"
        :class="{ 'rotate-180': open }"
      />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <!-- Interrupt mode: render the question + choices form. -->
      <div
        v-if="isInterrupt && askQuestionInput"
        class="border-primary/30 bg-primary/5 space-y-2 rounded-md border p-3 text-xs"
      >
        <p class="text-foreground text-sm font-medium">
          {{ askQuestionInput.question }}
        </p>
        <div class="flex flex-wrap gap-1.5">
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
          class="border-primary/20 mt-2 flex items-center gap-1.5 border-t pt-2"
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
      <!-- Fallback: malformed interrupt payload — model hallucinated -->
      <!-- the input schema. Rare; show a polite escape hatch. -->
      <div
        v-else-if="isInterrupt"
        class="border-border bg-background/40 rounded-md border p-2 text-xs"
      >
        <p class="text-muted-foreground italic">
          {{ t("ai.toolCall.malformedInterrupt") }}
        </p>
      </div>
      <!-- Resolved interrupt: show the question with the chosen -->
      <!-- answer highlighted. Skips the generic JSON dump that would -->
      <!-- otherwise flash briefly during the auto-collapse. -->
      <div
        v-else-if="isResolvedInterrupt && askQuestionInput && interruptAnswer"
        class="border-primary/30 bg-primary/5 space-y-1.5 rounded-md border p-3 text-xs"
      >
        <p class="text-foreground text-sm font-medium">
          {{ askQuestionInput.question }}
        </p>
        <p class="text-primary flex items-center gap-1.5">
          <IconCheck class="size-3.5 shrink-0" />
          <span class="font-medium">{{ interruptAnswer }}</span>
        </p>
      </div>
      <!-- Normal tool card (running or done). -->
      <div
        v-else
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
            v-if="!isRunning"
            class="bg-muted text-foreground overflow-x-auto rounded px-2 py-1.5 font-mono text-xs leading-snug whitespace-pre-wrap"
          ><code>{{ outputText }}</code></pre>
          <p v-else class="text-muted-foreground italic">
            {{ t("ai.toolCall.waitingForReturn") }}
          </p>
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

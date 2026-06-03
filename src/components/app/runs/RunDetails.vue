<script lang="ts" setup>
import {
  IconCheck,
  IconChevronRight,
  IconCircleDashed,
  IconClock,
  IconLoader2,
  IconX,
} from "@/data/icons"
import {
  runStatusLabel,
  runStatusOptions,
  runStatusTextClass,
} from "@/data/workflowRunConstants"
import type { IWorkflowRun, IWorkflowRunChange } from "@/types/domain"
import { computed, type Component } from "vue"

const props = defineProps<{ run: IWorkflowRun }>()

const { t } = useI18n()

const tsMs = (ts: unknown): number | null =>
  (ts as { toDate?: () => Date })?.toDate?.()?.getTime?.() ?? null

// Timestamps mirror NodeActivityLog: relative text + full-date tooltip + ISO
// `datetime`. `useTimeAgo`/`useDateFormat` are VueUse (auto-imported), bound to
// this component's scope so their tickers dispose on unmount.
const relWhen = (ms: number | null): string =>
  ms ? useTimeAgo(new Date(ms)).value : "—"
const fullWhen = (ms: number | null): string | undefined =>
  ms ? useDateFormat(new Date(ms), "MMM D, YYYY · h:mm A").value : undefined
const isoWhen = (ms: number | null): string | undefined =>
  ms ? new Date(ms).toISOString() : undefined

const usage = computed(() => props.run.usage ?? null)
const changes = computed<IWorkflowRunChange[]>(() => props.run.changes ?? [])

/** Human description of what fired the run (rendered under the "Queued" step). */
const triggerText = computed<string>(() => {
  const tb = props.run.triggeredBy
  if (!tb) return ""
  if (tb.type === "manual") return t("settings.workflows.runTriggerManual")
  if (tb.type === "schedule") return t("settings.workflows.runTriggerSchedule")
  return t("settings.workflows.runTriggerEvent", {
    scope: tb.scope,
    id: tb.nodeId,
  })
})

/** Title for the terminal step — phrased by review mode + outcome. */
const finishedTitle = computed<string>(() => {
  const r = props.run
  // A partial apply sets `error` too, but it's not a failed run — label it by
  // its status ("Partially applied") rather than the generic "Failed".
  if (r.status === "partially_applied") return runStatusLabel(r.status)
  if (r.error) return t("settings.workflows.timelineFailed")
  if (r.status === "awaiting_review")
    return t("settings.workflows.timelineProposed")
  if (r.status === "applied" || r.status === "success")
    return t("settings.workflows.timelineApplied")
  return runStatusLabel(r.status)
})

const isApprovedOutcome = (status: string): boolean =>
  status === "applied" || status === "partially_applied"

const reviewedTitle = computed<string>(() =>
  isApprovedOutcome(props.run.status)
    ? t("settings.workflows.timelineApproved")
    : t("settings.workflows.timelineRejected")
)

/** The status's own glyph (same icons the table + filters use). */
const statusIcon = (status: string): Component =>
  runStatusOptions.find((o) => o.value === status)?.icon ?? IconCircleDashed

/**
 * Lifecycle steps in fixed chronological order, skipping stages that never
 * happened. Each carries its own icon + title so the template renders one
 * uniform step header (mirroring NodeActivityLog) and only the stage-specific
 * body differs. The terminal "finished" step also appears when a run captured
 * changes but hasn't been reviewed yet (awaiting_review leaves `finishedAt`
 * unset until the decision lands).
 */
const events = computed(() => {
  const r = props.run
  const list: {
    kind: string
    at: number | null
    icon: Component
    title: string
    titleClass: string
  }[] = []
  list.push({
    kind: "queued",
    at: tsMs(r.queuedAt),
    icon: IconClock,
    title: t("settings.workflows.timelineQueued"),
    titleClass: "",
  })
  if (tsMs(r.startedAt))
    list.push({
      kind: "started",
      at: tsMs(r.startedAt),
      icon: IconLoader2,
      title: t("settings.workflows.timelineStarted"),
      titleClass: "",
    })
  if (tsMs(r.finishedAt) || changes.value.length > 0 || r.error)
    list.push({
      kind: "finished",
      at: tsMs(r.finishedAt),
      icon: statusIcon(r.status),
      title: finishedTitle.value,
      titleClass: runStatusTextClass(r.status),
    })
  if (tsMs(r.reviewedAt))
    list.push({
      kind: "reviewed",
      at: tsMs(r.reviewedAt),
      icon: isApprovedOutcome(r.status) ? IconCheck : IconX,
      title: reviewedTitle.value,
      titleClass: "",
    })
  return list
})

/** Per-op diff styling — gutter colour, badge, and a +/~/→/− sign. */
const OP_STYLE: Record<string, { bar: string; badge: string; sign: string }> = {
  create: {
    bar: "border-l-green-500",
    badge: "bg-green-500/15 text-green-700 dark:text-green-400",
    sign: "+",
  },
  update: {
    bar: "border-l-blue-500",
    badge: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    sign: "~",
  },
  rename: {
    bar: "border-l-amber-500",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    sign: "✎",
  },
  move: {
    bar: "border-l-violet-500",
    badge: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    sign: "→",
  },
  archive: {
    bar: "border-l-red-500",
    badge: "bg-red-500/15 text-red-700 dark:text-red-400",
    sign: "−",
  },
}
const opStyle = (op: string) => OP_STYLE[op] ?? OP_STYLE.update
</script>

<template>
  <div class="bg-muted/30 flex flex-col gap-4 p-4">
    <div class="max-w-3xl">
      <!-- Status + usage summary -->
      <div
        class="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      >
        <span :class="runStatusTextClass(run.status)" class="font-medium">
          {{ runStatusLabel(run.status) }}
        </span>
        <template v-if="usage">
          <span v-if="usage.model" class="truncate">{{ usage.model }}</span>
          <span>
            {{
              (
                (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
              ).toLocaleString()
            }}
            {{ t("settings.workflows.tokensWord") }}
          </span>
          <span>${{ (usage.estimatedCostUsd ?? 0).toFixed(4) }}</span>
        </template>
      </div>

      <!-- Lifecycle timeline — read-only vertical Stepper (mirrors NodeActivityLog). -->
      <Stepper
        orientation="vertical"
        :model-value="-1"
        class="flex flex-col gap-0"
      >
        <StepperItem
          v-for="(event, i) in events"
          :key="event.kind"
          :step="i + 1"
          class="flex items-start self-stretch"
        >
          <div class="relative flex flex-col items-center self-stretch">
            <StepperIndicator as-child>
              <Button variant="outline" size="icon-xs">
                <Component :is="event.icon" />
              </Button>
            </StepperIndicator>
            <StepperSeparator
              v-if="i < events.length - 1"
              orientation="vertical"
              class="bg-border w-px grow"
            />
          </div>

          <div class="flex min-w-0 grow flex-col gap-2 p-2">
            <!-- Uniform step header: title + timestamp -->
            <div class="flex items-center justify-between gap-2">
              <StepperTitle class="truncate" :class="event.titleClass">
                {{ event.title }}
              </StepperTitle>
              <time
                v-if="event.at"
                class="text-muted-foreground shrink-0 text-xs"
                :datetime="isoWhen(event.at)"
                :title="fullWhen(event.at)"
              >
                {{ relWhen(event.at) }}
              </time>
            </div>

            <!-- Queued — what triggered the run -->
            <StepperDescription v-if="event.kind === 'queued' && triggerText">
              {{ triggerText }}
            </StepperDescription>

            <!-- Finished — changeset diff + reply / error -->
            <template v-if="event.kind === 'finished'">
              <div v-if="changes.length > 0" class="flex flex-col gap-1">
                <span class="text-muted-foreground text-xs font-medium">
                  {{ t("settings.workflows.changesWord") }} ({{
                    changes.length
                  }})
                </span>
                <div
                  class="overflow-hidden rounded-md border font-mono text-xs"
                >
                  <div
                    v-for="(c, ci) in changes"
                    :key="ci"
                    class="flex items-start gap-2 border-b border-l-2 px-2 py-1.5 last:border-b-0"
                    :class="opStyle(c.op).bar"
                  >
                    <span
                      class="text-muted-foreground w-2 shrink-0 text-center select-none"
                    >
                      {{ opStyle(c.op).sign }}
                    </span>
                    <span
                      class="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase"
                      :class="opStyle(c.op).badge"
                    >
                      {{ c.op }}
                    </span>
                    <span class="grow font-sans break-words">
                      {{ c.summary }}
                      <span class="text-muted-foreground">
                        ({{ c.scope
                        }}<template v-if="c.nodeId">/{{ c.nodeId }}</template
                        >)
                      </span>
                      <span
                        v-if="c.sourceNodeId"
                        class="text-muted-foreground block text-[11px]"
                      >
                        {{
                          t("settings.workflows.citedFrom", {
                            id: c.sourceNodeId,
                          })
                        }}
                      </span>
                      <span
                        v-if="c.applied === false"
                        class="block text-[11px] text-red-600 dark:text-red-400"
                      >
                        {{
                          c.applyError || t("settings.workflows.changeFailed")
                        }}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              <p v-if="run.replyPreview" class="text-muted-foreground text-xs">
                {{ run.replyPreview }}
              </p>
              <p
                v-if="run.error"
                class="text-xs text-red-600 dark:text-red-400"
              >
                {{ run.error }}
              </p>
            </template>
          </div>
        </StepperItem>
      </Stepper>

      <!-- Prompt snapshot -->
      <Collapsible v-if="run.prompt" class="group/runprompt mt-3">
        <CollapsibleTrigger
          class="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
        >
          <IconChevronRight
            class="size-3 transition-transform group-data-[state=open]/runprompt:rotate-90"
          />
          {{ t("settings.workflows.promptWord") }}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre
            class="text-muted-foreground bg-background mt-1 max-h-48 overflow-auto rounded-md border p-2 text-xs break-words whitespace-pre-wrap"
            >{{ run.prompt }}</pre
          >
        </CollapsibleContent>
      </Collapsible>
    </div>
  </div>
</template>

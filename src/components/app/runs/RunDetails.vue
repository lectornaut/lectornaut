<script lang="ts" setup>
import {
  IconCheck,
  IconChevronRight,
  IconCircleDashed,
  IconClock,
  IconPlay,
  IconX,
} from "@/data/icons"
import {
  runStatusLabel,
  runStatusOptions,
  runStatusTextClass,
} from "@/data/workflowRunConstants"
import type { IWorkflowRun, IWorkflowRunChange } from "@/types/domain"
import { tsToMillis } from "@/utils/firebase/firebase-timestamps"
import { formatTimeAgo } from "@vueuse/core"
import { computed, type Component } from "vue"

const props = defineProps<{ run: IWorkflowRun }>()

const { t, te } = useI18n()

// Each lifecycle step is stamped once (in the `events` computed) with the three
// representations the template needs: relative text, a full-date tooltip, and
// an ISO `datetime`. `formatTimeAgo` is VueUse's PURE formatter — unlike
// `useTimeAgo` it installs no interval, so stamping it here (rather than calling
// a composable per render) avoids orphaned tickers. The relative text is a
// point-in-time snapshot, which suits an already-finished run.
const stamp = (ms: number | null) => ({
  at: ms,
  rel: ms ? formatTimeAgo(new Date(ms)) : undefined,
  full: ms
    ? useDateFormat(new Date(ms), "MMM D, YYYY · h:mm A").value
    : undefined,
  iso: ms ? new Date(ms).toISOString() : undefined,
})

const usage = computed(() => props.run.usage ?? null)
const changes = computed<IWorkflowRunChange[]>(() => props.run.changes ?? [])

/**
 * Localized status label. `runStatusLabel` is hardcoded English (its callers are
 * plain-module column defs with no `useI18n()` context); this panel is
 * `t()`-driven, so route the label through i18n to keep one language, falling
 * back to the English label for any status without a translation key.
 */
const statusLabel = (status: string): string => {
  const key = `settings.workflows.runStatus.${status}`
  return te(key) ? t(key) : runStatusLabel(status)
}

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
  if (r.status === "partially_applied") return statusLabel(r.status)
  if (r.error) return t("settings.workflows.timelineFailed")
  if (r.status === "awaiting_review")
    return t("settings.workflows.timelineProposed")
  if (r.status === "applied" || r.status === "success")
    return t("settings.workflows.timelineApplied")
  return statusLabel(r.status)
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
    rel: string | undefined
    full: string | undefined
    iso: string | undefined
    icon: Component
    title: string
    titleClass: string
  }[] = []
  list.push({
    kind: "queued",
    ...stamp(tsToMillis(r.queuedAt)),
    icon: IconClock,
    title: t("settings.workflows.timelineQueued"),
    titleClass: "",
  })
  const startedMs = tsToMillis(r.startedAt)
  if (startedMs)
    list.push({
      kind: "started",
      ...stamp(startedMs),
      icon: IconPlay,
      title: t("settings.workflows.timelineStarted"),
      titleClass: "",
    })
  const finishedMs = tsToMillis(r.finishedAt)
  if (finishedMs || changes.value.length > 0 || r.error)
    list.push({
      kind: "finished",
      ...stamp(finishedMs),
      icon: statusIcon(r.status),
      title: finishedTitle.value,
      titleClass: runStatusTextClass(r.status),
    })
  const reviewedMs = tsToMillis(r.reviewedAt)
  if (reviewedMs)
    list.push({
      kind: "reviewed",
      ...stamp(reviewedMs),
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
  <div class="flex flex-col gap-4 p-4">
    <!-- Status + usage summary -->
    <div
      class="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
    >
      <span :class="runStatusTextClass(run.status)" class="font-medium">
        {{ statusLabel(run.status) }}
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
              :datetime="event.iso"
              :title="event.full"
            >
              {{ event.rel }}
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
                {{ t("settings.workflows.changesWord") }} ({{ changes.length }})
              </span>
              <div class="overflow-hidden rounded-4xl border font-mono text-xs">
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
                    class="shrink-0 rounded-4xl px-1 py-0.5 text-[10px] font-semibold uppercase"
                    :class="opStyle(c.op).badge"
                  >
                    {{ c.op }}
                  </span>
                  <span class="min-w-0 grow font-sans wrap-break-word">
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
                      {{ c.applyError || t("settings.workflows.changeFailed") }}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <p
              v-if="run.replyPreview"
              class="text-muted-foreground truncate text-xs"
            >
              {{ run.replyPreview }}
            </p>
            <p
              v-if="run.error"
              class="text-xs wrap-break-word text-red-600 dark:text-red-400"
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
          class="text-muted-foreground bg-background mt-1 max-h-48 overflow-auto rounded-4xl border p-2 text-xs wrap-break-word whitespace-pre-wrap"
          >{{ run.prompt }}</pre>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>

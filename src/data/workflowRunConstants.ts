/**
 * Shared display constants for workflow runs — faceted-filter options (for the
 * runs DataTable) and status → colour helpers (for cells + the calendar
 * indicators). Status labels resolve through the global i18n instance since
 * these are plain modules with no `useI18n()` context; trigger and update-mode
 * labels are still hardcoded English.
 */

import {
  IconAlertTriangle,
  IconBan,
  IconBolt,
  IconCheckCircle,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconEye,
  IconLoader2,
  IconPlay,
  IconXCircle,
} from "@/data/icons"
import { i18n } from "@/modules/i18n"
import type { Component } from "vue"

export interface RunOption {
  value: string
  label: string
  icon?: Component
}

const RUN_STATUS_ICONS: [string, Component][] = [
  ["queued", IconClock],
  ["running", IconLoader2],
  ["success", IconCheckCircle],
  ["awaiting_review", IconEye],
  ["applied", IconCheckCircle],
  ["partially_applied", IconAlertTriangle],
  ["cancelled", IconCircleX],
  ["error", IconXCircle],
  ["blocked", IconBan],
  ["skipped", IconCircleDashed],
]

// Getter so the label follows the active locale at read time.
export const runStatusOptions: RunOption[] = RUN_STATUS_ICONS.map(
  ([value, icon]) => ({
    value,
    icon,
    get label() {
      return runStatusLabel(value)
    },
  })
)

export const runTriggerOptions: RunOption[] = [
  { value: "schedule", label: "Schedule", icon: IconClock },
  { value: "event", label: "Content change", icon: IconBolt },
  { value: "manual", label: "Manual", icon: IconPlay },
]

export const runUpdateModeOptions: RunOption[] = [
  { value: "automatic", label: "Automatic", icon: IconBolt },
  { value: "require_review", label: "Review", icon: IconEye },
]

const STATUS_TEXT: Record<string, string> = {
  success: "text-green-600 dark:text-green-400",
  applied: "text-green-600 dark:text-green-400",
  partially_applied: "text-amber-600 dark:text-amber-400",
  queued: "text-blue-600 dark:text-blue-400",
  running: "text-blue-600 dark:text-blue-400",
  awaiting_review: "text-violet-600 dark:text-violet-400",
  error: "text-red-600 dark:text-red-400",
  blocked: "text-amber-600 dark:text-amber-400",
  cancelled: "text-muted-foreground",
  skipped: "text-muted-foreground",
}

const STATUS_DOT: Record<string, string> = {
  success: "bg-green-500",
  applied: "bg-green-500",
  partially_applied: "bg-amber-500",
  queued: "bg-blue-500",
  running: "bg-blue-500",
  awaiting_review: "bg-violet-500",
  error: "bg-red-500",
  blocked: "bg-amber-500",
  cancelled: "bg-muted-foreground",
  skipped: "bg-muted-foreground",
}

/**
 * Priority when several runs share a day in the calendar — the most
 * attention-worthy status wins the dot colour. Higher = more important.
 */
const STATUS_RANK: Record<string, number> = {
  awaiting_review: 6,
  error: 5,
  partially_applied: 5,
  blocked: 4,
  running: 3,
  queued: 3,
  applied: 2,
  success: 2,
  cancelled: 1,
  skipped: 1,
}

export const runStatusTextClass = (status: string): string =>
  STATUS_TEXT[status] ?? "text-muted-foreground"

export const runStatusDotClass = (status: string): string =>
  STATUS_DOT[status] ?? "bg-muted-foreground"

export const runStatusRank = (status: string): number =>
  STATUS_RANK[status] ?? 0

export const runStatusLabel = (status: string): string => {
  const key = `settings.workflows.runStatus.${status}`
  return i18n.global.te(key) ? i18n.global.t(key) : status
}

export const runTriggerLabel = (trigger: string): string =>
  runTriggerOptions.find((o) => o.value === trigger)?.label ?? "—"

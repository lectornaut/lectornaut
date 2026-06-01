/**
 * Shared state + derivations for the runs surfaces (Runs page, Settings →
 * Runs). Owns the two sidebar filters — a calendar date-range and a workflow
 * multi-select — and derives the flattened {@link RunRow}s, the per-day
 * calendar markers (past-run status + scheduled indicators), and the grouped
 * workflow filter list. Call once per surface; pass its refs to the calendar /
 * filter / table children.
 */

import { toRunRow, type RunRow } from "@/components/app/runs/runColumns"
import { runStatusDotClass, runStatusRank } from "@/data/workflowRunConstants"
import { useTeamWorkflowsStore } from "@/stores/teamWorkflowsStore"
import { storeToRefs } from "pinia"
import { computed, ref } from "vue"

/**
 * Structural calendar-date + range types. We deliberately DON'T use reka-ui's
 * `DateRange`/`DateValue` across module boundaries: those carry a branded
 * `ZonedDateTime` whose identity doesn't reconcile across files (reka-ui pulls
 * `@internationalized/date` independently). A reka-ui `DateValue` is assignable
 * INTO these (it has all of `year`/`month`/`day`/`toString`), so the calendar
 * still drives them — only the inner `RangeCalendarRoot` binding casts back.
 */
export interface CalDate {
  year: number
  month: number
  day: number
  toString(): string
}
export interface RunsDateRange {
  start?: CalDate
  end?: CalDate
}

/** Local-midnight epoch ms for a calendar date — matches `dateKeyFromMs`. */
const dvToLocalMs = (d: CalDate): number =>
  new Date(d.year, d.month - 1, d.day).getTime()

const dateKeyFromMs = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** Key a calendar cell's `DateValue` the same way `dateKeyFromMs` keys a run. */
export const dateKeyFromParts = (y: number, m: number, d: number): string =>
  `${y}-${m}-${d}`

const tsMs = (ts: unknown): number | null =>
  (ts as { toDate?: () => Date })?.toDate?.()?.getTime?.() ?? null

export interface WorkflowFilterItem {
  id: string
  name: string
  enabled: boolean
}
export interface WorkflowFilterGroup {
  label: string
  items: WorkflowFilterItem[]
}
export interface DayMarker {
  dotClass: string
  scheduled: boolean
}

export function useRunsExplorer() {
  const store = useTeamWorkflowsStore()
  const { recentRuns, activeWorkflows } = storeToRefs(store)

  /** Calendar range filter (undefined = all dates). */
  const range = ref<RunsDateRange | undefined>(undefined)
  /** Selected workflow ids (empty = all workflows). */
  const selectedWorkflowIds = ref<Set<string>>(new Set())

  const allRows = computed<RunRow[]>(() =>
    recentRuns.value.map((r) =>
      toRunRow(r, store.getById(r.workflowId)?.name ?? r.workflowId)
    )
  )

  const filteredRows = computed<RunRow[]>(() => {
    let rows = allRows.value
    if (selectedWorkflowIds.value.size > 0) {
      rows = rows.filter((r) => selectedWorkflowIds.value.has(r.workflowId))
    }
    const startMs = range.value?.start ? dvToLocalMs(range.value.start) : null
    const endMs = range.value?.end
      ? dvToLocalMs(range.value.end) + 86_400_000
      : null
    if (startMs != null)
      rows = rows.filter((r) => (r.queuedAtMs ?? 0) >= startMs)
    if (endMs != null) rows = rows.filter((r) => (r.queuedAtMs ?? 0) < endMs)
    return rows
  })

  const dayMarkers = computed<Map<string, DayMarker>>(() => {
    const markers = new Map<string, DayMarker>()
    const rankByKey = new Map<string, number>()
    // Past runs — dot coloured by the most attention-worthy status that day.
    for (const row of allRows.value) {
      if (!row.queuedAtMs) continue
      const key = dateKeyFromMs(row.queuedAtMs)
      const marker = markers.get(key) ?? { dotClass: "", scheduled: false }
      const rank = runStatusRank(row.status)
      if (rank > (rankByKey.get(key) ?? -1)) {
        rankByKey.set(key, rank)
        marker.dotClass = runStatusDotClass(row.status)
      }
      markers.set(key, marker)
    }
    // Scheduled — each enabled schedule workflow's next fire.
    for (const w of activeWorkflows.value) {
      const nextMs = tsMs(w.nextRunAt)
      if (!nextMs) continue
      const key = dateKeyFromMs(nextMs)
      const marker = markers.get(key) ?? { dotClass: "", scheduled: false }
      marker.scheduled = true
      markers.set(key, marker)
    }
    return markers
  })

  const groupItems = (predefined: boolean): WorkflowFilterItem[] =>
    activeWorkflows.value
      .filter((w) => (predefined ? !!w.presetKey : !w.presetKey))
      .map((w) => ({ id: w.id, name: w.name, enabled: w.enabled }))

  const workflowGroups = computed<WorkflowFilterGroup[]>(() =>
    [
      { label: "Predefined", items: groupItems(true) },
      { label: "Custom", items: groupItems(false) },
    ].filter((g) => g.items.length > 0)
  )

  const toggleWorkflow = (id: string): void => {
    const next = new Set(selectedWorkflowIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedWorkflowIds.value = next
  }
  const clearWorkflows = (): void => {
    selectedWorkflowIds.value = new Set()
  }
  const clearAll = (): void => {
    selectedWorkflowIds.value = new Set()
    range.value = undefined
  }

  const hasFilters = computed(
    () => selectedWorkflowIds.value.size > 0 || !!range.value?.start
  )

  return {
    range,
    selectedWorkflowIds,
    allRows,
    filteredRows,
    dayMarkers,
    workflowGroups,
    hasFilters,
    toggleWorkflow,
    clearWorkflows,
    clearAll,
  }
}

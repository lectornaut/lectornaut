/**
 * Shared state + derivations for the runs surfaces (Runs page, Settings →
 * Runs). Owns the two sidebar filters — a calendar date-range and a workflow
 * multi-select — and derives the flattened {@link RunRow}s, the per-day
 * calendar markers (past-run status + scheduled indicators), and the grouped
 * workflow filter list. Call once per surface; pass its refs to the calendar /
 * filter / table children.
 */

import { toRunRow, type RunRow } from "@/components/app/runs/runColumns"
import { getWorkflowPreset, WORKFLOW_PRESETS } from "@/data/workflowPresets"
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
  /**
   * Stable list + dedupe key — the `presetKey` for predefined rows (collapsing
   * any legacy data that materialized one preset into several docs), the
   * workflow doc id for custom rows. NOT itself a workflow id; selection keys
   * off `workflowIds`.
   */
  key: string
  name: string
  /**
   * Every workflow doc this row stands for. Normally one; >1 only in the legacy
   * multi-doc-per-preset case, where toggling the row covers them all so no
   * run is left unfilterable.
   */
  workflowIds: string[]
}
export interface WorkflowFilterGroup {
  label: string
  items: WorkflowFilterItem[]
}
export interface DayMarker {
  dotClass: string
  scheduled: boolean
}

/** Catalog order for predefined rows — keeps the filter list stable and aligned
 *  with Settings → Workflows (the workflows Firestore query is unordered). */
const PRESET_ORDER = new Map<string, number>(
  WORKFLOW_PRESETS.map((p, i) => [p.key, i])
)

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

  // Predefined rows collapse by `presetKey` so the canonical model — at most
  // one runnable doc per shipped preset (see SettingsWorkflows) — holds even
  // against legacy data that materialized a preset twice: the row carries every
  // matching doc id and toggles them as one. The label comes from the catalog
  // (the same name Settings shows), falling back to the doc name for a preset
  // that's since been retired from the catalog.
  const predefinedItems = (): WorkflowFilterItem[] => {
    const byKey = new Map<string, WorkflowFilterItem>()
    for (const w of activeWorkflows.value) {
      if (!w.presetKey) continue
      const item = byKey.get(w.presetKey)
      if (item) {
        item.workflowIds.push(w.id)
        continue
      }
      byKey.set(w.presetKey, {
        key: w.presetKey,
        name: getWorkflowPreset(w.presetKey)?.name ?? w.name,
        workflowIds: [w.id],
      })
    }
    return [...byKey.values()].sort(
      (a, b) =>
        (PRESET_ORDER.get(a.key) ?? Infinity) -
          (PRESET_ORDER.get(b.key) ?? Infinity) || a.name.localeCompare(b.name)
    )
  }

  // Custom workflows are already one-doc-per-row; key + select by the doc id.
  const customItems = (): WorkflowFilterItem[] =>
    activeWorkflows.value
      .filter((w) => !w.presetKey)
      .map((w) => ({ key: w.id, name: w.name, workflowIds: [w.id] }))

  const workflowGroups = computed<WorkflowFilterGroup[]>(() =>
    [
      { label: "Predefined", items: predefinedItems() },
      { label: "Custom", items: customItems() },
    ].filter((g) => g.items.length > 0)
  )

  /** A filter row reads as selected only when every doc it represents is. */
  const isWorkflowSelected = (workflowIds: string[]): boolean =>
    workflowIds.length > 0 &&
    workflowIds.every((id) => selectedWorkflowIds.value.has(id))

  // Toggle every doc the row stands for as a unit — clear them if all are
  // already selected, otherwise select them all. `selectedWorkflowIds` stays a
  // flat set of real doc ids, so `filteredRows` matching is unchanged.
  const toggleWorkflow = (workflowIds: string[]): void => {
    const next = new Set(selectedWorkflowIds.value)
    if (workflowIds.every((id) => next.has(id)))
      workflowIds.forEach((id) => next.delete(id))
    else workflowIds.forEach((id) => next.add(id))
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
    isWorkflowSelected,
    clearWorkflows,
    clearAll,
  }
}

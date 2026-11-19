/**
 * Shared derivations for the runs surfaces (Runs page, Settings → Runs): the
 * flattened {@link RunRow}s, the per-day calendar markers (past-run status +
 * scheduled indicators), and the grouped workflow filter list. Filtering lives
 * in the DataTable's own column filters now (date-range + faceted workflow), so
 * each surface binds its calendar / workflow tree to the table; this composable
 * only supplies the data those controls render.
 */

import { toRunRow, type RunRow } from "@/components/app/runs/runColumns"
import { useMemberNames } from "@/composables/useMemberNames"
import { getWorkflowPreset, WORKFLOW_PRESETS } from "@/data/workflowPresets"
import { runStatusDotClass, runStatusRank } from "@/data/workflowRunConstants"
import { useTeamWorkflowsStore } from "@/stores/teamWorkflowsStore"
import { storeToRefs } from "pinia"
import { computed } from "vue"

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
  /** Stable list key: the `presetKey` for predefined rows, else the doc id. */
  key: string
  name: string
  workflowId: string
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
  const { recentRuns, wsActiveWorkflows } = storeToRefs(store)

  const { memberName } = useMemberNames()
  const allRows = computed<RunRow[]>(() =>
    recentRuns.value.map((r) =>
      toRunRow(
        r,
        store.getById(r.workflowId)?.name ?? r.workflowId,
        r.forUid ? memberName(r.forUid) : ""
      )
    )
  )

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
    for (const w of wsActiveWorkflows.value) {
      const nextMs = tsMs(w.nextRunAt)
      if (!nextMs) continue
      const key = dateKeyFromMs(nextMs)
      const marker = markers.get(key) ?? { dotClass: "", scheduled: false }
      marker.scheduled = true
      markers.set(key, marker)
    }
    return markers
  })

  // One doc per shipped preset. The label comes from the catalog (the same
  // name Settings shows), falling back to the doc name for a preset that's
  // since been retired from the catalog.
  const predefinedItems = (): WorkflowFilterItem[] =>
    wsActiveWorkflows.value
      .filter((w) => !!w.presetKey)
      .map((w) => ({
        key: w.presetKey as string,
        name: getWorkflowPreset(w.presetKey as string)?.name ?? w.name,
        workflowId: w.id,
      }))
      .sort(
        (a, b) =>
          (PRESET_ORDER.get(a.key) ?? Infinity) -
            (PRESET_ORDER.get(b.key) ?? Infinity) ||
          a.name.localeCompare(b.name)
      )

  // Custom workflows are already one-doc-per-row; key + select by the doc id.
  const customItems = (): WorkflowFilterItem[] =>
    wsActiveWorkflows.value
      .filter((w) => !w.presetKey)
      .map((w) => ({ key: w.id, name: w.name, workflowId: w.id }))

  const workflowGroups = computed<WorkflowFilterGroup[]>(() =>
    [
      { label: "Predefined", items: predefinedItems() },
      { label: "Custom", items: customItems() },
    ].filter((g) => g.items.length > 0)
  )

  return {
    allRows,
    dayMarkers,
    workflowGroups,
  }
}

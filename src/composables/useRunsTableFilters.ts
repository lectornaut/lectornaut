/**
 * Bridges a runs DataTable's `columnFilters` to the calendar + workflow filter
 * controls, so an external surface (the Runs page sidebar, the Settings → Runs
 * popovers) drives the SAME filter state the built-in toolbar does — the two can
 * never drift apart. Pass a getter for the exposed table instance
 * (`() => tableRef.value?.table`); every read/write goes through it reactively.
 *
 * The date filter maps the calendar's {@link RunsDateRange} to the queued-time
 * column's `{start,end}` ISO-day strings; the workflow filter is an array of
 * workflow doc ids (a preset row toggles its several ids as a unit).
 */
import type { RunRow } from "@/components/app/runs/runColumns"
import type { RunsDateRange } from "@/composables/useRunsExplorer"
import { parseDate } from "@internationalized/date"
import type { Table as VueTable } from "@tanstack/vue-table"
import { computed } from "vue"

export function useRunsTableFilters(
  getTable: () => VueTable<RunRow> | undefined
) {
  const queuedColumn = () => getTable()?.getColumn("queuedAtMs")
  const workflowColumn = () => getTable()?.getColumn("workflowName")

  // Calendar ⇆ the queued-time date-range filter ({start,end} ISO-day strings).
  const dateRange = computed<RunsDateRange | undefined>({
    get() {
      const value = queuedColumn()?.getFilterValue() as
        { start?: string; end?: string } | undefined
      if (!value || (!value.start && !value.end)) return undefined
      try {
        return {
          start: value.start ? parseDate(value.start) : undefined,
          end: value.end ? parseDate(value.end) : undefined,
        }
      } catch {
        return undefined
      }
    },
    set(value) {
      const column = queuedColumn()
      if (!column) return
      const start = value?.start?.toString()
      const end = value?.end?.toString()
      column.setFilterValue(start || end ? { start, end } : undefined)
    },
  })

  /** Short "start → end" label for a collapsed date-filter trigger. */
  const rangeSummary = computed(() => {
    const value = queuedColumn()?.getFilterValue() as
      { start?: string; end?: string } | undefined
    const start = value?.start
    const end = value?.end
    if (start && end) return `${start} → ${end}`
    return start || end || ""
  })

  // Workflow tree / popover ⇆ the workflow faceted filter (array of doc ids).
  const selectedWorkflowIds = computed<Set<string>>(
    () => new Set((workflowColumn()?.getFilterValue() as string[]) ?? [])
  )
  const isWorkflowSelected = (workflowIds: string[]): boolean =>
    workflowIds.length > 0 &&
    workflowIds.every((id) => selectedWorkflowIds.value.has(id))
  const toggleWorkflow = (workflowIds: string[]): void => {
    const column = workflowColumn()
    if (!column) return
    const next = new Set(selectedWorkflowIds.value)
    if (workflowIds.every((id) => next.has(id)))
      workflowIds.forEach((id) => next.delete(id))
    else workflowIds.forEach((id) => next.add(id))
    column.setFilterValue(next.size ? [...next] : undefined)
  }
  const clearWorkflows = (): void => {
    workflowColumn()?.setFilterValue(undefined)
  }

  const hasFilters = computed(
    () => (getTable()?.getState().columnFilters.length ?? 0) > 0
  )
  const clearAll = (): void => getTable()?.resetColumnFilters()

  return {
    dateRange,
    rangeSummary,
    selectedWorkflowIds,
    isWorkflowSelected,
    toggleWorkflow,
    clearWorkflows,
    hasFilters,
    clearAll,
  }
}

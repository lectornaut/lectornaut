/**
 * Columns for the workflow-runs DataTable, shared by the Runs page, the
 * Settings → Runs panel, and the per-workflow runs table on the Workflows
 * page. Mirrors the demo `@/components/table/columns.ts` pattern (render
 * functions via `h`, faceted filters via `meta.filterOptions`). Rows are a
 * pre-flattened {@link RunRow} view-model so cells never need store lookups.
 */

import RunRowActions from "@/components/app/runs/RunRowActions.vue"
import DataTableColumnHeader from "@/components/table/DataTableColumnHeader.vue"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { IconChevronRight } from "@/data/icons"
import {
  runStatusOptions,
  runStatusTextClass,
  runTriggerOptions,
  runUpdateModeOptions,
  type RunOption,
} from "@/data/workflowRunConstants"
import type { IWorkflowRun } from "@/types/domain"
import type { Column, ColumnDef } from "@tanstack/vue-table"
import { h } from "vue"

export interface RunRow {
  id: string
  workflowId: string
  workflowName: string
  presetKey: string | null
  status: string
  trigger: string
  triggerNodeId: string | null
  updateMode: string
  changesCount: number
  model: string
  totalTokens: number
  costUsd: number
  queuedAtMs: number | null
  durationMs: number | null
  preview: string
  run: IWorkflowRun
}

const tsMs = (ts: unknown): number | null =>
  (ts as { toDate?: () => Date })?.toDate?.()?.getTime() ?? null

/** Flatten a run doc into the table view-model (resolves workflow name + usage). */
export function toRunRow(run: IWorkflowRun, workflowName: string): RunRow {
  const tb = run.triggeredBy
  const usage = run.usage
  const startedAtMs = tsMs(run.startedAt)
  const finishedAtMs = tsMs(run.finishedAt)
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName,
    presetKey: run.presetKey ?? null,
    status: run.status,
    trigger: tb?.type ?? "",
    triggerNodeId: tb && tb.type === "event" ? tb.nodeId : null,
    updateMode: run.updateMode ?? "",
    changesCount: run.changes?.length ?? 0,
    model: usage?.model ?? "",
    totalTokens: usage
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : 0,
    costUsd: usage?.estimatedCostUsd ?? 0,
    queuedAtMs: tsMs(run.queuedAt),
    durationMs: finishedAtMs && startedAtMs ? finishedAtMs - startedAtMs : null,
    preview: run.replyPreview || run.error || "",
    run,
  }
}

const fmtWhen = (ms: number | null): string =>
  ms ? new Date(ms).toLocaleString() : "—"

const fmtDuration = (ms: number | null): string => {
  if (ms == null) return "—"
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

const fmtTokens = (n: number): string => (n ? n.toLocaleString() : "—")
const fmtCost = (n: number): string => (n ? `$${n.toFixed(4)}` : "—")

const toUnknownColumn = (column: Column<RunRow, unknown>) =>
  column as Column<unknown, unknown>

const optionCell = (value: string, options: RunOption[], colored = false) => {
  const opt = options.find((o) => o.value === value)
  if (!opt) return h("span", { class: "text-muted-foreground" }, "—")
  return h(
    "div",
    {
      class: [
        "flex items-center gap-2",
        colored ? runStatusTextClass(value) : "",
      ],
    },
    [
      opt.icon
        ? h(opt.icon, { class: colored ? "" : "text-muted-foreground" })
        : null,
      h("span", {}, opt.label),
    ]
  )
}

const facetedFilterFn = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: string[]
) => value.includes(row.getValue(id) as string)

/** Faceted "Workflow" filter — matches on the row's workflow doc id (not its
 *  display name) so renamed/duplicate-named workflows still filter precisely,
 *  and a preset's several legacy docs can be selected as one unit. */
const workflowFilterFn = (
  row: { original: RunRow },
  _id: string,
  value: string[]
): boolean =>
  !Array.isArray(value) || value.length === 0
    ? true
    : value.includes(row.original.workflowId)

/** Date-range filter on a ms-timestamp column — reads the toolbar's
 *  `{start,end}` ISO-day strings as an inclusive local-day window. Mirrors the
 *  audit-logs timestamp filter so the two surfaces behave identically. */
const dateRangeFilterFn = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: unknown
): boolean => {
  if (!value || typeof value !== "object") return true
  const { start, end } = value as { start?: string; end?: string }
  if (!start && !end) return true
  const ts = row.getValue(id) as number
  if (!ts) return false
  if (start) {
    const startMs = new Date(`${start}T00:00:00`).getTime()
    if (!Number.isNaN(startMs) && ts < startMs) return false
  }
  if (end) {
    const endMs = new Date(`${end}T23:59:59.999`).getTime()
    if (!Number.isNaN(endMs) && ts > endMs) return false
  }
  return true
}

export interface RunColumnsOptions {
  /**
   * Options for the faceted "Workflow" filter ({@link RunOption} with
   * `value` = workflow doc id, `label` = display name). Omit or pass an empty
   * array to hide the filter — e.g. the per-workflow runs table, where every
   * row is the same workflow.
   */
  workflowOptions?: RunOption[]
  /** Show a date-range filter on the queued-time column. */
  dateRangeFilter?: boolean
}

/**
 * Build the workflow-runs columns. Filters are opt-in per surface: the Runs
 * page and Settings → Runs pass `workflowOptions` + `dateRangeFilter` so both
 * filters live in the DataTable toolbar; the per-workflow table on the
 * Workflows page calls `runColumns()` and gets neither.
 */
export function runColumns(
  options: RunColumnsOptions = {}
): ColumnDef<RunRow>[] {
  const { workflowOptions, dateRangeFilter = false } = options
  return [
    {
      id: "select",
      header: ({ table }) =>
        h(Checkbox, {
          modelValue: table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? "indeterminate"
              : false,
          "onUpdate:modelValue": (value: boolean | "indeterminate") =>
            table.toggleAllPageRowsSelected(!!value),
          ariaLabel: "Select all",
        }),
      cell: ({ row }) =>
        h(Checkbox, {
          modelValue: row.getIsSelected(),
          "onUpdate:modelValue": (value: boolean | "indeterminate") =>
            row.toggleSelected(!!value),
          ariaLabel: "Select row",
        }),
      enableSorting: false,
      enableHiding: false,
      enableGrouping: false,
      enablePinning: true,
    },
    {
      accessorKey: "workflowName",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Workflow",
        }),
      // Leading chevron doubles as the expand affordance — it rotates with the
      // row's expanded state (clicking anywhere on the row toggles it; see
      // DataTable's row-click handler).
      cell: ({ row }) =>
        h("div", { class: "flex items-center gap-2" }, [
          h(IconChevronRight, {
            class: [
              "text-muted-foreground size-4 shrink-0 transition-transform",
              row.getIsExpanded() ? "rotate-90" : "",
            ],
          }),
          h(
            "span",
            { class: "truncate font-medium" },
            row.original.workflowName
          ),
          row.original.presetKey
            ? h(Badge, { variant: "outline" }, () => "Predefined")
            : null,
        ]),
      ...(workflowOptions && workflowOptions.length > 0
        ? {
            filterFn: workflowFilterFn,
            meta: { filterTitle: "Workflow", filterOptions: workflowOptions },
          }
        : {}),
      enableHiding: false,
    },
    {
      accessorKey: "status",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Status",
        }),
      cell: ({ row }) =>
        optionCell(row.getValue("status"), runStatusOptions, true),
      filterFn: facetedFilterFn,
      meta: { filterTitle: "Status", filterOptions: runStatusOptions },
      enableSorting: true,
      enableGrouping: true,
    },
    {
      accessorKey: "trigger",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Trigger",
        }),
      cell: ({ row }) => optionCell(row.getValue("trigger"), runTriggerOptions),
      filterFn: facetedFilterFn,
      meta: { filterTitle: "Trigger", filterOptions: runTriggerOptions },
      enableGrouping: true,
    },
    {
      accessorKey: "updateMode",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Mode",
        }),
      cell: ({ row }) =>
        optionCell(row.getValue("updateMode"), runUpdateModeOptions),
      filterFn: facetedFilterFn,
      meta: { filterTitle: "Mode", filterOptions: runUpdateModeOptions },
      enableGrouping: true,
    },
    {
      accessorKey: "changesCount",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Changes",
        }),
      cell: ({ row }) =>
        h(
          "span",
          { class: row.original.changesCount ? "" : "text-muted-foreground" },
          String(row.original.changesCount || "—")
        ),
      enableSorting: true,
    },
    {
      accessorKey: "totalTokens",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Tokens",
        }),
      cell: ({ row }) =>
        h(
          "span",
          { class: "tabular-nums" },
          fmtTokens(row.original.totalTokens)
        ),
      enableSorting: true,
    },
    {
      accessorKey: "costUsd",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Est. cost",
        }),
      cell: ({ row }) =>
        h("span", { class: "tabular-nums" }, fmtCost(row.original.costUsd)),
      enableSorting: true,
    },
    {
      accessorKey: "model",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Model",
        }),
      cell: ({ row }) =>
        h(
          "span",
          { class: "text-muted-foreground truncate text-xs" },
          row.original.model || "—"
        ),
      enableHiding: true,
    },
    {
      accessorKey: "queuedAtMs",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "When",
        }),
      cell: ({ row }) =>
        h(
          "span",
          { class: "text-muted-foreground whitespace-nowrap text-xs" },
          fmtWhen(row.original.queuedAtMs)
        ),
      ...(dateRangeFilter
        ? {
            filterFn: dateRangeFilterFn,
            meta: { filterTitle: "Date range", filterType: "dateRange" },
          }
        : {}),
      enableSorting: true,
    },
    {
      accessorKey: "durationMs",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Duration",
        }),
      cell: ({ row }) =>
        h(
          "span",
          { class: "text-muted-foreground tabular-nums" },
          fmtDuration(row.original.durationMs)
        ),
      enableSorting: true,
    },
    {
      accessorKey: "preview",
      header: ({ column }) =>
        h(DataTableColumnHeader, {
          column: toUnknownColumn(column),
          title: "Summary",
        }),
      cell: ({ row }) =>
        h(
          "span",
          {
            class: "text-muted-foreground block max-w-[28rem] truncate text-xs",
          },
          row.original.preview || "—"
        ),
      enableHiding: true,
    },
    {
      id: "actions",
      cell: ({ row }) => h(RunRowActions, { run: row.original.run }),
      enablePinning: true,
      enableSorting: false,
      enableGrouping: false,
      enableHiding: false,
    },
  ]
}

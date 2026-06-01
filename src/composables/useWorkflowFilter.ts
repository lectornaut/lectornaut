/**
 * useWorkflowFilter — reactive search + filter + grouping for the Workflows
 * page sidebar, modelled on `useBotSessionFilter`. Instance-local state so it
 * doesn't leak across surfaces.
 *
 * Filters: `search` (name + description), `triggers` (schedule/event/manual),
 * `statuses` (enabled/disabled). View options: `groupBy` (kind = Predefined
 * then Custom | trigger | none) and `sortBy` (recency = last activity | name).
 * Match semantics are pure so callers can pipe lists through `.filter`.
 */
import type { IWorkflow } from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { computed, reactive } from "vue"

export const WORKFLOW_TRIGGER_VALUES = ["schedule", "event", "manual"] as const
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_VALUES)[number]

export const WORKFLOW_STATUS_VALUES = ["enabled", "disabled"] as const
export type WorkflowStatusFilter = (typeof WORKFLOW_STATUS_VALUES)[number]

export const WORKFLOW_GROUP_BY_VALUES = ["kind", "trigger", "none"] as const
export type WorkflowGroupBy = (typeof WORKFLOW_GROUP_BY_VALUES)[number]

export const WORKFLOW_SORT_BY_VALUES = ["recency", "alphabetical"] as const
export type WorkflowSortBy = (typeof WORKFLOW_SORT_BY_VALUES)[number]

export interface WorkflowFilterState {
  search: string
  /** Empty set = all triggers. */
  triggers: Set<WorkflowTriggerType>
  /** Empty set = all statuses. */
  statuses: Set<WorkflowStatusFilter>
  groupBy: WorkflowGroupBy
  sortBy: WorkflowSortBy
}

/** A bucket emitted by `groupWorkflows`; `key` maps to a localized label in the UI. */
export interface WorkflowGroup {
  key: string
  items: IWorkflow[]
}

const defaultState = (): WorkflowFilterState => ({
  search: "",
  triggers: new Set(),
  statuses: new Set(),
  groupBy: "kind",
  sortBy: "recency",
})

const tsMillis = (value: unknown): number =>
  value instanceof Timestamp ? value.toMillis() : 0

export function useWorkflowFilter() {
  const state = reactive<WorkflowFilterState>(defaultState())

  const isActive = computed(
    () =>
      state.search.trim().length > 0 ||
      state.triggers.size > 0 ||
      state.statuses.size > 0
  )

  const matches = (wf: IWorkflow): boolean => {
    if (state.triggers.size > 0 && !state.triggers.has(wf.trigger.type)) {
      return false
    }
    if (state.statuses.size > 0) {
      const s: WorkflowStatusFilter = wf.enabled ? "enabled" : "disabled"
      if (!state.statuses.has(s)) return false
    }
    const q = state.search.trim().toLowerCase()
    if (q.length > 0) {
      const name = (wf.name ?? "").toLowerCase()
      const desc = (wf.description ?? "").toLowerCase()
      if (!name.includes(q) && !desc.includes(q)) return false
    }
    return true
  }

  const filter = (list: IWorkflow[]): IWorkflow[] => list.filter(matches)

  /** Most-recent activity: last run, else last update, else creation. */
  const recencyMs = (wf: IWorkflow): number =>
    Math.max(
      tsMillis(wf.lastRunAt),
      tsMillis(wf.updatedAt),
      tsMillis(wf.createdAt)
    )

  const sortWorkflows = (list: IWorkflow[]): IWorkflow[] => {
    const arr = list.slice()
    if (state.sortBy === "alphabetical") {
      arr.sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "", undefined, {
          sensitivity: "base",
        })
      )
    } else {
      arr.sort((a, b) => recencyMs(b) - recencyMs(a))
    }
    return arr
  }

  const groupWorkflows = (list: IWorkflow[]): WorkflowGroup[] => {
    const sorted = sortWorkflows(list)
    if (sorted.length === 0) return []

    if (state.groupBy === "none") return [{ key: "all", items: sorted }]

    if (state.groupBy === "trigger") {
      const buckets: Record<WorkflowTriggerType, IWorkflow[]> = {
        schedule: [],
        event: [],
        manual: [],
      }
      for (const w of sorted) buckets[w.trigger.type].push(w)
      const out: WorkflowGroup[] = []
      for (const key of WORKFLOW_TRIGGER_VALUES) {
        if (buckets[key].length > 0) out.push({ key, items: buckets[key] })
      }
      return out
    }

    // kind — Predefined (presetKey) first, then Custom.
    const predefined = sorted.filter((w) => !!w.presetKey)
    const custom = sorted.filter((w) => !w.presetKey)
    const out: WorkflowGroup[] = []
    if (predefined.length) out.push({ key: "predefined", items: predefined })
    if (custom.length) out.push({ key: "custom", items: custom })
    return out
  }

  const reset = (): void => {
    state.search = ""
    state.triggers.clear()
    state.statuses.clear()
    state.groupBy = "kind"
    state.sortBy = "recency"
  }

  const toggleTrigger = (trigger: WorkflowTriggerType): void => {
    if (state.triggers.has(trigger)) state.triggers.delete(trigger)
    else state.triggers.add(trigger)
  }
  const toggleStatus = (status: WorkflowStatusFilter): void => {
    if (state.statuses.has(status)) state.statuses.delete(status)
    else state.statuses.add(status)
  }
  const setSearch = (value: string): void => {
    state.search = value
  }
  const setGroupBy = (value: WorkflowGroupBy): void => {
    state.groupBy = value
  }
  const setSortBy = (value: WorkflowSortBy): void => {
    state.sortBy = value
  }

  return {
    state,
    isActive,
    matches,
    filter,
    sortWorkflows,
    groupWorkflows,
    reset,
    toggleTrigger,
    toggleStatus,
    setSearch,
    setGroupBy,
    setSortBy,
  }
}

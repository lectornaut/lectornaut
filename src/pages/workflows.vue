<script lang="ts" setup>
import { runColumns, type RunRow } from "@/components/app/runs/runColumns"
import type { AppTableFeatures } from "@/components/table/features"
import { useRunsExplorer } from "@/composables/useRunsExplorer"
import { useTeamAgents } from "@/composables/useTeamAgents"
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { useWorkflowFilter } from "@/composables/useWorkflowFilter"
import {
  IconChevronRight,
  IconPlus,
  IconSearch,
  IconWorkflow,
  IconX,
} from "@/data/icons"
import { runStatusLabel, runStatusTextClass } from "@/data/workflowRunConstants"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import type { IWorkflow } from "@/types/domain"
import type { Table as VueTable } from "@tanstack/vue-table"
import { storeToRefs } from "pinia"
import { computed, nextTick, ref } from "vue"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Workflows",
    breadcrumb: "Workflows",
  },
})

const { t } = useI18n()
useHead({ title: "Workflows" })

const {
  wsActiveWorkflows,
  wsArchivedWorkflows,
  canManage,
  setEnabled,
  archive,
  remove,
  runNow,
} = useTeamWorkflows()
const { selectableAgents } = useTeamAgents()

// Workspace-wide runs explorer (mirrors the Runs page): the table shows every
// run in the workspace, filterable by Workflow + Date range from its toolbar.
const { allRows } = useRunsExplorer()

// Faceted "Workflow" filter options — one per distinct workflow present in the
// runs, keyed by doc id (label = display name). Same derivation as the Runs page.
const workflowOptions = computed(() => {
  const byId = new Map<string, string>()
  for (const row of allRows.value)
    if (!byId.has(row.workflowId)) byId.set(row.workflowId, row.workflowName)
  return [...byId]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
})
const columns = computed(() =>
  runColumns({ workflowOptions: workflowOptions.value, dateRangeFilter: true })
)

// Exposed table instance — lets the left-sidebar selection drive the table's
// Workflow column filter (clicking a workflow focuses its runs), mirroring how
// the Runs page sidebar drives its filters.
const tableRef = ref<{
  getTable: () => VueTable<AppTableFeatures, RunRow>
} | null>(null)

// Saved team-wide gate for custom workflows (creation only; predefined unaffected).
const { customWorkflowsEnabled } = storeToRefs(useTeamAgentsStore())

// ── Search + filter (BotHistorySidebar-style) ───────────────────────────────
const filter = useWorkflowFilter()

const activeGroups = computed(() =>
  filter.groupWorkflows(filter.filter(wsActiveWorkflows.value))
)
const archivedFiltered = computed(() =>
  filter.sortWorkflows(filter.filter(wsArchivedWorkflows.value))
)

const hasAnyRaw = computed(
  () =>
    wsActiveWorkflows.value.length > 0 || wsArchivedWorkflows.value.length > 0
)
const hasAnyFiltered = computed(
  () => activeGroups.value.length > 0 || archivedFiltered.value.length > 0
)
const isEmpty = computed(() => !hasAnyRaw.value)
const isFilteredEmpty = computed(() => hasAnyRaw.value && !hasAnyFiltered.value)

const groupLabel = (key: string): string => {
  if (key === "predefined") return t("pages.workflows.groupPredefined")
  if (key === "custom") return t("pages.workflows.groupCustom")
  if (key === "schedule") return t("settings.workflows.triggerScheduleOpt")
  if (key === "event") return t("settings.workflows.triggerEventOpt")
  if (key === "manual") return t("settings.workflows.triggerManualOpt")
  return t("pages.workflows.allWorkflows")
}

const searchExpanded = ref(false)
const expandSearch = (): void => {
  searchExpanded.value = true
  nextTick(() => document.getElementById("workflow-search")?.focus())
}
const onSearchBlur = (): void => {
  if (!filter.state.search.trim()) searchExpanded.value = false
}

// ── Selection drives the right-sidebar detail + focuses the runs table ──────
const selectedId = ref<string | null>(null)
const selectedWorkflow = computed<IWorkflow | null>(() => {
  const list = wsActiveWorkflows.value
  if (selectedId.value) {
    const found = list.find((w) => w.id === selectedId.value)
    if (found) return found
  }
  return list[0] ?? null
})
// Selecting a workflow shows its details on the right AND filters the table to
// its runs (preserving the page's "click a workflow → see its runs" flow). The
// toolbar's Workflow/Date filters layer on top and can broaden or clear it.
const select = (id: string): void => {
  selectedId.value = id
  tableRef.value?.getTable().getColumn("workflowName")?.setFilterValue([id])
}

// ── Editor dialog ───────────────────────────────────────────────────────────
const editorOpen = ref(false)
const editingWorkflow = ref<IWorkflow | null>(null)
const openCreate = (): void => {
  editingWorkflow.value = null
  editorOpen.value = true
}
const openEdit = (wf: IWorkflow): void => {
  editingWorkflow.value = wf
  editorOpen.value = true
}
const onSaved = (id: string | null): void => {
  if (id) selectedId.value = id
}

const confirmRemove = async (wf: IWorkflow): Promise<void> => {
  if (
    typeof window !== "undefined" &&
    !window.confirm(t("settings.workflows.confirmDelete", { name: wf.name }))
  )
    return
  await remove(wf.id)
}

// ── Right-sidebar detail helpers ────────────────────────────────────────────
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const minuteToTime = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
const triggerSummary = (wf: IWorkflow): string => {
  const tr = wf.trigger
  if (tr.type === "manual") return t("settings.workflows.triggerManual")
  if (tr.type === "event")
    return t("settings.workflows.triggerEvent", { scope: tr.scope })
  const s = tr.schedule
  if (s.type === "interval")
    return t("settings.workflows.everyHours", { n: s.everyHours })
  if (s.type === "daily")
    return t("settings.workflows.daily", { time: minuteToTime(s.atMinuteUTC) })
  return t("settings.workflows.weekly", {
    day: dayNames[s.dayOfWeek],
    time: minuteToTime(s.atMinuteUTC),
  })
}
const agentName = (id: string): string =>
  selectableAgents.value.find((a) => a.id === id)?.name ?? id
const modeLabel = (wf: IWorkflow): string =>
  (wf.updateMode ?? "require_review") === "automatic"
    ? t("settings.workflows.modeAutomatic")
    : t("settings.workflows.modeReview")
const formatWhen = (ts: unknown): string =>
  (ts as { toDate?: () => Date })?.toDate?.()?.toLocaleString?.() ?? "—"
</script>

<template>
  <!-- Left sidebar: search + filter + grouped workflow list -->
  <SidebarSlot side="left">
    <Sidebar collapsible="none" class="w-full">
      <SidebarHeader>
        <div class="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            class="grow justify-start"
            :disabled="
              !canManage ||
              selectableAgents.length === 0 ||
              !customWorkflowsEnabled
            "
            @click="openCreate"
          >
            <IconPlus />
            {{ t("settings.workflows.new") }}
          </Button>
          <InputGroup
            class="border-border border"
            :class="searchExpanded ? 'max-w-64' : 'w-auto'"
          >
            <InputGroupAddon v-if="!searchExpanded" key="search-compact">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton size="icon-xs" @click="expandSearch">
                      <IconSearch />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>{{
                    t("pages.workflows.search")
                  }}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </InputGroupAddon>

            <InputGroupAddon v-if="searchExpanded" key="search-icon">
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput
              v-if="searchExpanded"
              id="workflow-search"
              key="search-input"
              v-model="filter.state.search"
              :placeholder="t('pages.workflows.searchPlaceholder')"
              @blur="onSearchBlur"
            />

            <InputGroupAddon key="search-trailing" align="inline-end">
              <TooltipProvider v-if="searchExpanded && filter.state.search">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton
                      size="icon-xs"
                      @mousedown.prevent
                      @click="filter.state.search = ''"
                    >
                      <IconX />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>{{ t("ai.searchClear") }}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <WorkflowFilterMenu :filter="filter" />
            </InputGroupAddon>
          </InputGroup>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <ScrollContainer>
          <div
            v-if="isEmpty"
            class="text-muted-foreground flex flex-col items-center gap-2 p-6 text-center text-xs"
          >
            <IconWorkflow />
            <p>{{ t("settings.workflows.empty") }}</p>
          </div>
          <div
            v-else-if="isFilteredEmpty"
            class="text-muted-foreground flex flex-col items-center gap-2 p-6 text-center text-xs"
          >
            <IconWorkflow />
            <p>{{ t("pages.workflows.filterNoResults") }}</p>
            <Button variant="ghost" @click="filter.reset()">
              {{ t("ai.filterReset") }}
            </Button>
          </div>

          <SidebarGroup v-for="group in activeGroups" :key="group.key">
            <Collapsible default-open class="group/collapsible">
              <SidebarGroupLabel as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-2">
                  {{ groupLabel(group.key) }}
                  <span class="text-muted-foreground">{{
                    group.items.length
                  }}</span>
                  <IconChevronRight
                    class="ml-auto size-3! transition-transform group-data-[state=open]/collapsible:rotate-90"
                  />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <WorkflowSidebarItem
                      v-for="wf in group.items"
                      :key="wf.id"
                      :workflow="wf"
                      :is-active="wf.id === selectedWorkflow?.id"
                      :can-manage="canManage"
                      @select="select(wf.id)"
                      @run-now="runNow(wf.id)"
                      @edit="openEdit(wf)"
                      @toggle-enabled="(v) => setEnabled(wf.id, v)"
                      @archive="archive(wf.id, true)"
                      @remove="confirmRemove(wf)"
                    />
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>

          <template v-if="archivedFiltered.length > 0">
            <Separator class="my-1" />
            <SidebarGroup>
              <Collapsible class="group/collapsible">
                <SidebarGroupLabel as-child>
                  <CollapsibleTrigger class="flex w-full items-center gap-2">
                    {{
                      t("settings.workflows.archivedCount", {
                        n: archivedFiltered.length,
                      })
                    }}
                    <IconChevronRight
                      class="ml-auto size-3! transition-transform group-data-[state=open]/collapsible:rotate-90"
                    />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <WorkflowSidebarItem
                        v-for="wf in archivedFiltered"
                        :key="wf.id"
                        :workflow="wf"
                        :is-active="wf.id === selectedWorkflow?.id"
                        :can-manage="canManage"
                        is-archived
                        @select="select(wf.id)"
                        @restore="archive(wf.id, false)"
                        @remove="confirmRemove(wf)"
                      />
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          </template>
        </ScrollContainer>
      </SidebarContent>
    </Sidebar>
  </SidebarSlot>

  <!-- Main: workspace-wide runs, filterable by Workflow + Date range -->
  <div class="container mx-auto flex h-full min-h-0 max-w-4xl flex-col">
    <DataTable
      ref="tableRef"
      :data="allRows"
      :columns="columns"
      sticky-header
      :column-pinning="{ start: ['select'], end: ['actions'] }"
    >
      <template #expanded="{ row }">
        <RunDetails :run="row.original.run" />
      </template>
      <template #selection-actions="{ table, rows, count }">
        <RunsSelectionActions :table="table" :rows="rows" :count="count" />
      </template>
    </DataTable>
  </div>

  <!-- Right sidebar: selected workflow actions + details -->
  <SidebarSlot side="right">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <ScrollContainer>
          <SidebarGroup v-if="selectedWorkflow" class="gap-3">
            <div class="flex items-center justify-between gap-2">
              <h3 class="truncate text-sm font-medium">
                {{ selectedWorkflow.name }}
              </h3>
              <Switch
                :model-value="selectedWorkflow.enabled"
                :disabled="!canManage"
                @update:model-value="
                  (v: boolean) => setEnabled(selectedWorkflow!.id, v)
                "
              />
            </div>

            <div class="flex flex-wrap gap-2">
              <Button
                variant="outline"
                :disabled="!canManage"
                @click="runNow(selectedWorkflow.id)"
              >
                {{ t("settings.workflows.runNow") }}
              </Button>
              <Button
                variant="outline"
                :disabled="!canManage"
                @click="openEdit(selectedWorkflow)"
              >
                {{ t("settings.workflows.edit") }}
              </Button>
            </div>

            <Separator />

            <dl class="flex flex-col gap-2 text-sm">
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">
                  {{ t("settings.workflows.trigger") }}
                </dt>
                <dd class="text-right">
                  {{ triggerSummary(selectedWorkflow) }}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">
                  {{ t("settings.workflows.agent") }}
                </dt>
                <dd class="truncate text-right">
                  {{ agentName(selectedWorkflow.agentId) }}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">
                  {{ t("settings.workflows.updateMode") }}
                </dt>
                <dd class="text-right">{{ modeLabel(selectedWorkflow) }}</dd>
              </div>
              <div
                v-if="selectedWorkflow.lastRunStatus"
                class="flex justify-between gap-2"
              >
                <dt class="text-muted-foreground">
                  {{ t("pages.workflows.lastRun") }}
                </dt>
                <dd
                  class="text-right"
                  :class="runStatusTextClass(selectedWorkflow.lastRunStatus)"
                >
                  {{ runStatusLabel(selectedWorkflow.lastRunStatus) }}
                </dd>
              </div>
              <div
                v-if="selectedWorkflow.nextRunAt"
                class="flex justify-between gap-2"
              >
                <dt class="text-muted-foreground">
                  {{ t("pages.workflows.nextRun") }}
                </dt>
                <dd class="text-right text-xs">
                  {{ formatWhen(selectedWorkflow.nextRunAt) }}
                </dd>
              </div>
            </dl>
          </SidebarGroup>
          <div v-else class="text-muted-foreground p-4 text-sm">
            {{ t("pages.workflows.selectHint") }}
          </div>
        </ScrollContainer>
      </SidebarContent>
    </Sidebar>
  </SidebarSlot>

  <SettingsCustomWorkflow
    v-model:open="editorOpen"
    :workflow="editingWorkflow"
    @saved="onSaved"
  />
</template>

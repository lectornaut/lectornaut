<script lang="ts" setup>
import { runColumns, type RunRow } from "@/components/app/runs/runColumns"
import { useRunsExplorer } from "@/composables/useRunsExplorer"
import { useRunsTableFilters } from "@/composables/useRunsTableFilters"
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { IconChevronRight } from "@/data/icons"
import { runStatusDotClass, runStatusLabel } from "@/data/workflowRunConstants"
import type { Table as VueTable } from "@tanstack/vue-table"
import { computed, ref } from "vue"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Runs",
    breadcrumb: "Runs",
  },
})

const { t } = useI18n()
useHead({ title: "Runs" })

const { canManage } = useTeamWorkflows()
const { allRows, dayMarkers, workflowGroups } = useRunsExplorer()

// Faceted "Workflow" filter options — one per distinct workflow present in the
// runs, keyed by doc id (label = display name).
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

// One shared filter state, owned by the table's columnFilters — the sidebar
// calendar + workflow tree and the built-in toolbar both drive it through the
// exposed table ref, kept in sync by useRunsTableFilters (shared with
// Settings → Runs so the two surfaces behave identically).
const tableRef = ref<{ table: VueTable<RunRow> } | null>(null)
const { dateRange, isWorkflowSelected, toggleWorkflow, hasFilters, clearAll } =
  useRunsTableFilters(() => tableRef.value?.table)

// Right-sidebar summary over the currently-filtered runs (falls back to the full
// set until the table mounts and its filtered model is available).
const stats = computed(() => {
  const rows: RunRow[] = tableRef.value
    ? tableRef.value.table.getFilteredRowModel().rows.map((r) => r.original)
    : allRows.value
  const byStatus = new Map<string, number>()
  let cost = 0
  let tokens = 0
  for (const r of rows) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
    cost += r.costUsd
    tokens += r.totalTokens
  }
  return {
    total: rows.length,
    awaiting: byStatus.get("awaiting_review") ?? 0,
    cost,
    tokens,
    byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
  }
})
</script>

<template>
  <SidebarSlot side="left">
    <Sidebar collapsible="none" class="w-full">
      <SidebarHeader>
        <SidebarGroup>
          <SidebarGroupContent>
            <RunsCalendar
              v-model="dateRange"
              :markers="dayMarkers"
              class="**:[[role=gridcell]]:w-full"
            />
          </SidebarGroupContent>
        </SidebarGroup>
        <div
          class="text-muted-foreground flex items-center gap-3 px-3 pb-2 text-xs"
        >
          <span class="flex items-center gap-1">
            <span class="bg-primary size-1.5 rounded-md" />
            {{ t("pages.runs.legendPast") }}
          </span>
          <span class="flex items-center gap-1">
            <span class="size-1.5 rounded border border-current opacity-60" />
            {{ t("pages.runs.legendScheduled") }}
          </span>
        </div>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <ScrollContainer>
          <p
            v-if="workflowGroups.length === 0"
            class="text-muted-foreground px-4 py-2 text-xs"
          >
            {{ t("pages.runs.noWorkflows") }}
          </p>

          <template v-for="(group, index) in workflowGroups" :key="group.label">
            <SidebarSeparator v-if="index > 0" class="mx-0" />
            <SidebarGroup>
              <Collapsible
                :default-open="index === 0"
                class="group/collapsible"
              >
                <SidebarGroupLabel
                  as-child
                  class="group/label text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full gap-2 text-sm"
                >
                  <CollapsibleTrigger>
                    {{ group.label }}
                    <span class="text-muted-foreground">{{
                      group.items.length
                    }}</span>
                    <IconChevronRight
                      class="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90"
                    />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem
                        v-for="item in group.items"
                        :key="item.key"
                      >
                        <SidebarMenuButton as="label" class="cursor-pointer">
                          <Checkbox
                            :model-value="isWorkflowSelected(item.workflowIds)"
                            @update:model-value="
                              toggleWorkflow(item.workflowIds)
                            "
                          />
                          <span class="grow truncate">{{ item.name }}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          </template>
        </ScrollContainer>
      </SidebarContent>
      <Separator />
      <SidebarFooter>
        <Button v-if="hasFilters" variant="ghost" @click="clearAll">
          {{ t("pages.runs.clearAll") }}
        </Button>
      </SidebarFooter>
    </Sidebar>
  </SidebarSlot>

  <div class="container mx-auto flex h-full min-h-0 max-w-4xl flex-col">
    <DataTable
      v-if="canManage"
      ref="tableRef"
      :data="allRows"
      :columns="columns"
      sticky-header
      :column-pinning="{ left: ['select'], right: ['actions'] }"
    >
      <template #expanded="{ row }">
        <RunDetails :run="row.original.run" />
      </template>
      <template #selection-actions="{ table, rows, count }">
        <RunsSelectionActions :table="table" :rows="rows" :count="count" />
      </template>
    </DataTable>
    <div
      v-else
      class="text-muted-foreground flex h-full items-center justify-center p-8 text-sm"
    >
      {{ t("settings.workflows.adminOnly") }}
    </div>
  </div>

  <SidebarSlot side="right">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <ScrollContainer>
          <SidebarGroup class="gap-3">
            <h3 class="text-sm font-medium">{{ t("pages.runs.summary") }}</h3>
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded border p-2">
                <div class="text-lg font-semibold">{{ stats.total }}</div>
                <div class="text-muted-foreground text-xs">
                  {{ t("pages.runs.runsShown") }}
                </div>
              </div>
              <div class="rounded border p-2">
                <div
                  class="text-lg font-semibold"
                  :class="{
                    'text-violet-600 dark:text-violet-400': stats.awaiting > 0,
                  }"
                >
                  {{ stats.awaiting }}
                </div>
                <div class="text-muted-foreground text-xs">
                  {{ t("settings.workflows.needsReview") }}
                </div>
              </div>
              <div class="rounded border p-2">
                <div class="text-lg font-semibold tabular-nums">
                  ${{ stats.cost.toFixed(2) }}
                </div>
                <div class="text-muted-foreground text-xs">
                  {{ t("pages.runs.estCost") }}
                </div>
              </div>
              <div class="rounded border p-2">
                <div class="text-lg font-semibold tabular-nums">
                  {{ stats.tokens.toLocaleString() }}
                </div>
                <div class="text-muted-foreground text-xs">
                  {{ t("settings.workflows.tokensWord") }}
                </div>
              </div>
            </div>

            <div v-if="stats.byStatus.length > 0" class="flex flex-col gap-1">
              <span class="text-muted-foreground text-xs font-medium">
                {{ t("pages.runs.byStatus") }}
              </span>
              <div
                v-for="[status, count] in stats.byStatus"
                :key="status"
                class="flex items-center gap-2 text-sm"
              >
                <span
                  class="size-2 rounded-md"
                  :class="runStatusDotClass(status)"
                />
                <span class="grow">{{ runStatusLabel(status) }}</span>
                <span class="text-muted-foreground tabular-nums">{{
                  count
                }}</span>
              </div>
            </div>
          </SidebarGroup>
        </ScrollContainer>
      </SidebarContent>
    </Sidebar>
  </SidebarSlot>
</template>

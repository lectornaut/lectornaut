<script lang="ts" setup>
import { runColumns } from "@/components/app/runs/runColumns"
import { useRunsExplorer } from "@/composables/useRunsExplorer"
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { runStatusDotClass, runStatusLabel } from "@/data/workflowRunConstants"
import { computed } from "vue"

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
const {
  range,
  filteredRows,
  dayMarkers,
  workflowGroups,
  selectedWorkflowIds,
  hasFilters,
  toggleWorkflow,
  clearWorkflows,
  clearAll,
} = useRunsExplorer()

// Right-sidebar summary over the currently-filtered runs.
const stats = computed(() => {
  const rows = filteredRows.value
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
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarHeader>
        <SidebarGroup>
          <SidebarGroupContent>
            <RunsCalendar
              v-model="range"
              :markers="dayMarkers"
              class="**:[[role=gridcell]]:w-full"
            />
          </SidebarGroupContent>
        </SidebarGroup>
        <div
          class="text-muted-foreground flex items-center gap-3 px-3 pb-2 text-xs"
        >
          <span class="flex items-center gap-1">
            <span class="bg-primary size-1.5 rounded-full" />
            {{ t("pages.runs.legendPast") }}
          </span>
          <span class="flex items-center gap-1">
            <span
              class="size-1.5 rounded-full border border-current opacity-60"
            />
            {{ t("pages.runs.legendScheduled") }}
          </span>
        </div>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup>
            <WorkflowRunFilter
              :groups="workflowGroups"
              :selected-ids="selectedWorkflowIds"
              @toggle="toggleWorkflow"
              @clear="clearWorkflows"
            />
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
      <Separator />
      <SidebarFooter>
        <Button v-if="hasFilters" variant="ghost" size="sm" @click="clearAll">
          {{ t("pages.runs.clearAll") }}
        </Button>
      </SidebarFooter>
    </Sidebar>
  </Teleport>

  <DataTable
    v-if="canManage"
    :data="filteredRows"
    :columns="runColumns"
    sticky-header
    :column-pinning="{ left: [], right: ['actions'] }"
  />
  <div
    v-else
    class="text-muted-foreground flex h-full items-center justify-center p-8 text-sm"
  >
    {{ t("settings.workflows.adminOnly") }}
  </div>

  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <SidebarGroup class="gap-3">
            <h3 class="text-sm font-medium">{{ t("pages.runs.summary") }}</h3>
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded-md border p-2">
                <div class="text-lg font-semibold">{{ stats.total }}</div>
                <div class="text-muted-foreground text-xs">
                  {{ t("pages.runs.runsShown") }}
                </div>
              </div>
              <div class="rounded-md border p-2">
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
              <div class="rounded-md border p-2">
                <div class="text-lg font-semibold tabular-nums">
                  ${{ stats.cost.toFixed(2) }}
                </div>
                <div class="text-muted-foreground text-xs">
                  {{ t("pages.runs.estCost") }}
                </div>
              </div>
              <div class="rounded-md border p-2">
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
                  class="size-2 rounded-full"
                  :class="runStatusDotClass(status)"
                />
                <span class="grow">{{ runStatusLabel(status) }}</span>
                <span class="text-muted-foreground tabular-nums">{{
                  count
                }}</span>
              </div>
            </div>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>
</template>

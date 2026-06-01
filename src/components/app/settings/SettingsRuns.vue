<script lang="ts" setup>
import SettingsRestricted from "@/components/app/settings/SettingsRestricted.vue"
import { runColumns } from "@/components/app/runs/runColumns"
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useRunsExplorer } from "@/composables/useRunsExplorer"
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { IconCalendar, IconListFilter } from "@/data/icons"
import { computed } from "vue"

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()
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

const rangeSummary = computed(() => {
  const start = range.value?.start?.toString()
  const end = range.value?.end?.toString()
  if (start && end) return `${start} → ${end}`
  if (start) return start
  return ""
})
</script>

<template>
  <div v-if="canViewTeamSettings" class="flex h-full flex-col gap-4 p-6">
    <p
      v-if="!canManage"
      class="text-muted-foreground rounded-md border border-dashed p-4 text-sm"
    >
      {{ t("settings.workflows.adminOnly") }}
    </p>

    <template v-else>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" class="data-[state=open]:bg-accent">
              <IconCalendar />
              {{ t("settings.runs.dateRange") }}
              <template v-if="rangeSummary">
                <Separator orientation="vertical" />
                <Badge variant="secondary">{{ rangeSummary }}</Badge>
              </template>
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0">
            <RunsCalendar v-model="range" :markers="dayMarkers" />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" class="data-[state=open]:bg-accent">
              <IconListFilter />
              {{ t("pages.runs.filterByWorkflow") }}
              <template v-if="selectedWorkflowIds.size > 0">
                <Separator orientation="vertical" />
                <Badge variant="secondary">{{
                  selectedWorkflowIds.size
                }}</Badge>
              </template>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-72">
            <WorkflowRunFilter
              :groups="workflowGroups"
              :selected-ids="selectedWorkflowIds"
              @toggle="toggleWorkflow"
              @clear="clearWorkflows"
            />
          </PopoverContent>
        </Popover>

        <Button v-if="hasFilters" variant="ghost" @click="clearAll">
          {{ t("pages.runs.clearAll") }}
        </Button>
      </div>

      <div
        class="flex min-h-[24rem] grow flex-col overflow-hidden rounded-md border"
      >
        <DataTable
          :data="filteredRows"
          :columns="runColumns"
          sticky-header
          :column-pinning="{ left: [], right: ['actions'] }"
        />
      </div>
    </template>
  </div>
  <SettingsRestricted v-else />
</template>

<script lang="ts" setup>
import SettingsRestricted from "@/components/app/settings/SettingsRestricted.vue"
import { runColumns, type RunRow } from "@/components/app/runs/runColumns"
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useRunsExplorer } from "@/composables/useRunsExplorer"
import { useRunsTableFilters } from "@/composables/useRunsTableFilters"
import { useTeamWorkflows } from "@/composables/useTeamWorkflows"
import { IconAlertTriangle, IconCalendar, IconListFilter } from "@/data/icons"
import type { Table as VueTable } from "@tanstack/vue-table"
import { computed, ref } from "vue"

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()
const { canManage } = useTeamWorkflows()
const { allRows, dayMarkers, workflowGroups } = useRunsExplorer()

// Faceted "Workflow" filter options — one per distinct workflow present in the
// runs, keyed by doc id (label = display name). Derived from the rows so every
// run stays filterable even if its workflow was since archived or deleted.
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

// Date + workflow filter popovers (mirrors the Runs page sidebar) drive the same
// columnFilters the built-in toolbar does, via the exposed table ref.
const tableRef = ref<{ table: VueTable<RunRow> } | null>(null)
const {
  dateRange,
  rangeSummary,
  selectedWorkflowIds,
  toggleWorkflow,
  clearWorkflows,
  hasFilters,
  clearAll,
} = useRunsTableFilters(() => tableRef.value?.table)
</script>

<template>
  <div v-if="canViewTeamSettings" class="p-6">
    <FieldGroup>
      <FieldSet>
        <!-- Inner manage gate — mirrors SettingsLogs / SettingsSessions so the
             admin-only runs view shares the same empty-state UX. -->
        <Field v-if="!canManage" orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconAlertTriangle />
                </EmptyMedia>
                <EmptyTitle>
                  {{ t("settings.runs.noPermissionTitle") }}
                </EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.runs.noPermissionDescription") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
        <template v-else>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{ t("settings.runs.runsLabel") }}</FieldLabel>
              <FieldDescription>
                {{ t("settings.runs.runsDescription") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <Popover>
                  <PopoverTrigger as-child>
                    <Button
                      variant="outline"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconCalendar />
                      {{ t("settings.runs.dateRange") }}
                      <template v-if="rangeSummary">
                        <Separator orientation="vertical" />
                        <Badge variant="secondary">{{ rangeSummary }}</Badge>
                      </template>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-auto p-0">
                    <RunsCalendar v-model="dateRange" :markers="dayMarkers" />
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger as-child>
                    <Button
                      variant="outline"
                      class="data-[state=open]:bg-accent"
                    >
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
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent class="min-w-0">
              <DataTable
                ref="tableRef"
                :data="allRows"
                :columns="columns"
                :column-pinning="{ left: ['select'], right: ['actions'] }"
                class="overflow-clip rounded-xl border"
              >
                <template #expanded="{ row }">
                  <RunDetails :run="row.original.run" />
                </template>
              </DataTable>
            </FieldContent>
          </Field>
        </template>
      </FieldSet>
    </FieldGroup>
  </div>
  <SettingsRestricted v-else />
</template>

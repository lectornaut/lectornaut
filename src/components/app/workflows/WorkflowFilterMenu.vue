<script lang="ts" setup>
import {
  WORKFLOW_GROUP_BY_VALUES,
  WORKFLOW_SORT_BY_VALUES,
  WORKFLOW_STATUS_VALUES,
  WORKFLOW_TRIGGER_VALUES,
  type WorkflowGroupBy,
  type WorkflowSortBy,
  type WorkflowStatusFilter,
  type WorkflowTriggerType,
  useWorkflowFilter,
} from "@/composables/useWorkflowFilter"
import { IconListFilter } from "@/data/icons"
import { runTriggerLabel } from "@/data/workflowRunConstants"

const props = defineProps<{
  filter: ReturnType<typeof useWorkflowFilter>
}>()

const { t } = useI18n()

const triggerLabel = (trigger: WorkflowTriggerType): string =>
  runTriggerLabel(trigger)

const statusLabel = (status: WorkflowStatusFilter): string =>
  status === "enabled"
    ? t("settings.workflows.statusEnabled")
    : t("settings.workflows.statusDisabled")

const groupByLabel = (g: WorkflowGroupBy): string => {
  if (g === "kind") return t("pages.workflows.groupKind")
  if (g === "trigger") return t("pages.workflows.groupTrigger")
  return t("ai.groupByNone")
}

const sortByLabel = (s: WorkflowSortBy): string =>
  s === "recency" ? t("ai.sortByRecency") : t("ai.sortByAlphabetical")

const showActiveDot = props.filter.isActive

const keepMenuOpen = (event: Event): void => {
  event.preventDefault()
}
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child>
            <InputGroupButton
              size="icon-xs"
              class="data-[state=open]:bg-accent relative"
            >
              <IconListFilter />
              <span
                v-if="showActiveDot"
                class="bg-primary absolute -top-0.5 -right-0.5 size-2 rounded-full"
              />
            </InputGroupButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{{ t("pages.workflows.filter") }}</TooltipContent>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel class="flex items-center justify-between gap-2">
            {{ t("pages.workflows.filter") }}
            <Badge
              v-if="filter.isActive.value"
              variant="ghost"
              @click.stop="filter.reset()"
            >
              {{ t("ai.filterReset") }}
            </Badge>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{{
              t("settings.workflows.trigger")
            }}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuCheckboxItem
                v-for="tr in WORKFLOW_TRIGGER_VALUES"
                :key="tr"
                :model-value="filter.state.triggers.has(tr)"
                @update:model-value="filter.toggleTrigger(tr)"
                @select="keepMenuOpen"
              >
                {{ triggerLabel(tr) }}
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{{
              t("pages.workflows.status")
            }}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuCheckboxItem
                v-for="s in WORKFLOW_STATUS_VALUES"
                :key="s"
                :model-value="filter.state.statuses.has(s)"
                @update:model-value="filter.toggleStatus(s)"
                @select="keepMenuOpen"
              >
                {{ statusLabel(s) }}
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{{
              t("ai.groupBy")
            }}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                :model-value="filter.state.groupBy"
                @update:model-value="
                  (v) => filter.setGroupBy(v as WorkflowGroupBy)
                "
              >
                <DropdownMenuRadioItem
                  v-for="g in WORKFLOW_GROUP_BY_VALUES"
                  :key="g"
                  :value="g"
                >
                  {{ groupByLabel(g) }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{{
              t("ai.sortBy")
            }}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                :model-value="filter.state.sortBy"
                @update:model-value="
                  (v) => filter.setSortBy(v as WorkflowSortBy)
                "
              >
                <DropdownMenuRadioItem
                  v-for="s in WORKFLOW_SORT_BY_VALUES"
                  :key="s"
                  :value="s"
                >
                  {{ sortByLabel(s) }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>

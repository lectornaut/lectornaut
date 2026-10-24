<script lang="ts" setup>
import { labels } from "@/data/constants"
import type { Task } from "@/data/schema"
import { taskSchema } from "@/data/schema"
import type { AppTableFeatures } from "@/components/table/features"
import type { Row } from "@tanstack/vue-table"

interface DataTableRowActionsProps {
  row: Row<AppTableFeatures, Task>
}
const props = defineProps<DataTableRowActionsProps>()

defineEmits<{
  (e: "expand"): void
}>()

const { t } = useI18n()
const task = computed(() => taskSchema.parse(props.row.original))
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child>
            <DataTableRowActionsButton :label="t('actions.moreOptions')" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem>{{ t("actions.edit") }}</DropdownMenuItem>
          <DropdownMenuItem>{{ t("actions.duplicate") }}</DropdownMenuItem>
          <DropdownMenuItem>{{ t("labels.favorites") }}</DropdownMenuItem>
          <!-- <DropdownMenuItem @click="$emit('expand')">
              {{ row.getIsExpanded() ? "Collapse" : "Expand" }}
            </DropdownMenuItem> -->
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuItem as-child>
              <DropdownMenuSubTrigger>
                {{ t("components.dataTable.labels") }}
              </DropdownMenuSubTrigger>
            </DropdownMenuItem>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup v-model="task.label">
                <DropdownMenuRadioItem
                  v-for="label in labels"
                  :key="label.value"
                  :value="label.value"
                >
                  {{ label.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            {{ t("actions.delete") }}
            <DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
        <TooltipContent>{{ t("actions.moreOptions") }}</TooltipContent>
      </DropdownMenu>
    </Tooltip>
  </TooltipProvider>
</template>

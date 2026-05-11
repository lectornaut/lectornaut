<script lang="ts" setup>
import { labels } from "@/data/constants"
import { IconEllipsis } from "@/data/icons"
import type { Task } from "@/data/schema"
import { taskSchema } from "@/data/schema"
import type { Row } from "@tanstack/vue-table"

interface DataTableRowActionsProps {
  row: Row<Task>
}
const props = defineProps<DataTableRowActionsProps>()

defineEmits<{
  (e: "expand"): void
}>()

const { t } = useI18n()
const task = computed(() => taskSchema.parse(props.row.original))
</script>

<template>
  <DropdownMenu>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="data-[state=open]:bg-accent"
            >
              <IconEllipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-50">
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
              <DropdownMenuSubContent class="w-50">
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
        </TooltipTrigger>
        <TooltipContent>{{ t("actions.moreOptions") }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </DropdownMenu>
</template>

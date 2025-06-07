<script setup lang="ts">
import { labels } from "@/data/constants"
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
              <icon-lucide-ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Make a copy</DropdownMenuItem>
            <DropdownMenuItem>Favorite</DropdownMenuItem>
            <DropdownMenuItem @click="$emit('expand')">
              Expand
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Labels</DropdownMenuSubTrigger>
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
              Delete
              <DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </DropdownMenu>
</template>

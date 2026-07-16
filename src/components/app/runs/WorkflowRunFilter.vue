<script lang="ts" setup>
import type { WorkflowFilterGroup } from "@/composables/useRunsExplorer"
import { computed } from "vue"

const props = defineProps<{
  groups: WorkflowFilterGroup[]
  selectedIds: Set<string>
}>()

const emit = defineEmits<{ toggle: [workflowIds: string[]]; clear: [] }>()

const { t } = useI18n()
const anySelected = computed(() => props.selectedIds.size > 0)

// A row is checked only when every doc it represents is in the selection.
const isSelected = (workflowIds: string[]): boolean =>
  workflowIds.length > 0 && workflowIds.every((id) => props.selectedIds.has(id))
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-muted-foreground text-xs font-medium">
        {{ t("pages.runs.filterByWorkflow") }}
      </span>
      <button
        v-if="anySelected"
        class="text-muted-foreground hover:text-foreground text-xs"
        @click="emit('clear')"
      >
        {{ t("pages.runs.clear") }}
      </button>
    </div>

    <p v-if="groups.length === 0" class="text-muted-foreground text-xs">
      {{ t("pages.runs.noWorkflows") }}
    </p>

    <div v-for="group in groups" :key="group.label" class="flex flex-col gap-1">
      <span class="text-muted-foreground text-[11px] tracking-wide uppercase">
        {{ group.label }}
      </span>
      <label
        v-for="item in group.items"
        :key="item.key"
        class="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm"
      >
        <Checkbox
          :model-value="isSelected(item.workflowIds)"
          @update:model-value="emit('toggle', item.workflowIds)"
        />
        <span class="grow truncate">{{ item.name }}</span>
      </label>
    </div>
  </div>
</template>

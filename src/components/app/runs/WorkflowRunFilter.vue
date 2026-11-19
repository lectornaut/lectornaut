<script lang="ts" setup>
import type { WorkflowFilterGroup } from "@/composables/useRunsExplorer"
import { computed } from "vue"

const props = defineProps<{
  groups: WorkflowFilterGroup[]
  selectedIds: Set<string>
}>()

const emit = defineEmits<{ toggle: [workflowId: string]; clear: [] }>()

const { t } = useI18n()
const anySelected = computed(() => props.selectedIds.size > 0)
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
        class="hover:bg-accent rounded-control flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm"
      >
        <Checkbox
          :model-value="selectedIds.has(item.workflowId)"
          @update:model-value="emit('toggle', item.workflowId)"
        />
        <span class="grow truncate">{{ item.name }}</span>
      </label>
    </div>
  </div>
</template>

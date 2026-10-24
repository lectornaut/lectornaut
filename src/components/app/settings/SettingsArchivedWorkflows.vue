<script setup lang="ts">
import { IconChevronDown } from "@/data/icons"
import type { IWorkflow } from "@/types/domain"
import { ref } from "vue"

defineProps<{
  workflows: IWorkflow[]
  canManage: boolean
  isSaving: boolean
  describe: (workflow: IWorkflow) => string
}>()
const emit = defineEmits<{
  edit: [workflow: IWorkflow]
  restore: [workflow: IWorkflow]
  remove: [workflow: IWorkflow]
  toggleEnabled: [workflow: IWorkflow, enabled: boolean]
}>()
const { t } = useI18n()
const open = ref(false)
</script>

<template>
  <Collapsible v-if="workflows.length > 0" v-model:open="open">
    <CollapsibleTrigger as-child>
      <Button variant="ghost" class="w-full justify-between">
        {{ t("settings.workflows.archivedCount", { n: workflows.length }) }}
        <IconChevronDown
          class="size-4 transition-transform"
          :class="{ 'rotate-180': open }"
        />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ItemGroup class="gap-2 pt-2">
        <SettingsWorkflowRow
          v-for="workflow in workflows"
          :id="workflow.id"
          :key="workflow.id"
          :name="workflow.name"
          :avatar-seed="workflow.avatarSeed"
          :description="describe(workflow)"
          :enabled="workflow.enabled"
          :is-predefined="!!workflow.presetKey"
          is-archived
          :can-manage="canManage"
          :is-saving="isSaving"
          :can-archive="false"
          :can-delete="true"
          @edit="emit('edit', workflow)"
          @toggle-enabled="
            (enabled) => emit('toggleEnabled', workflow, enabled)
          "
          @restore="emit('restore', workflow)"
          @remove="emit('remove', workflow)"
        />
      </ItemGroup>
    </CollapsibleContent>
  </Collapsible>
</template>

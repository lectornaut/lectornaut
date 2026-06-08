<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import { IconCirclePlus, IconFolder, IconUsers } from "@/data/icons"
import type { AcceptableValue } from "reka-ui"
import { toast } from "vue-sonner"

const { t } = useI18n()

const {
  workspaces,
  isLoading,
  currentWorkspace,
  canCreateWorkspace,
  getCannotCreateWorkspaceReason,
  switchWorkspace,
} = useWorkspaceActions()

const { currentTeam, clearCurrentTeam } = useTeamActions()

const isCreateWorkspaceDialogOpen = ref(false)

const workspaceOptions = computed(() =>
  workspaces.value.map((w) => ({
    label: w.name,
    value: w.id,
    original: w,
  }))
)

const onSelectWorkspace = (value: AcceptableValue) => {
  if (typeof value === "string") void switchWorkspace(value)
}

const deselectTeam = async () => {
  try {
    await clearCurrentTeam()
  } catch (error) {
    console.error("[WorkspaceSelector] Failed to deselect team:", error)
    toast.error(t("components.workspaceSelector.changeTeam"))
  }
}
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <IconFolder />
      </EmptyMedia>
      <EmptyTitle>{{ t("components.workspaceSelector.title") }}</EmptyTitle>
      <EmptyDescription>
        {{ t("components.workspaceSelector.description") }}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent
      class="bg-background flex max-w-xs flex-col items-stretch gap-2 rounded-xl border p-2"
    >
      <LoadingState v-if="isLoading" />
      <Select
        v-else
        :model-value="currentWorkspace?.id"
        :disabled="!currentTeam"
        @update:model-value="onSelectWorkspace"
      >
        <SelectTrigger>
          <SelectValue
            :placeholder="t('components.workspaceSelector.placeholder')"
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel v-if="workspaceOptions.length === 0">
              {{ t("components.workspaceSelector.noWorkspaces") }}
            </SelectLabel>
            <SelectItem
              v-for="workspace in workspaceOptions"
              :key="workspace.value"
              :value="workspace.value"
            >
              <div class="flex items-center gap-2">
                <AppAvatar
                  class="size-4"
                  :src="workspace.original?.photoURL"
                  :name="workspace.label"
                />
                {{ workspace.label }}
              </div>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <div class="grid">
              <Button
                variant="secondary"
                class="justify-start"
                :disabled="!currentTeam || !canCreateWorkspace"
                @click="isCreateWorkspaceDialogOpen = true"
              >
                <IconCirclePlus />
                {{ t("components.workspaceSelector.createWorkspace") }}
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent v-if="!currentTeam || !canCreateWorkspace">
            {{
              !currentTeam
                ? t("components.workspaceSelector.selectTeamToCreate")
                : getCannotCreateWorkspaceReason
            }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </EmptyContent>
    <Button variant="outline" @click="deselectTeam">
      <IconUsers />
      {{ t("components.workspaceSelector.changeTeam") }}
    </Button>
    <WorkspaceDialog v-model:open="isCreateWorkspaceDialogOpen" mode="create" />
  </Empty>
</template>

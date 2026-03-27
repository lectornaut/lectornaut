<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import { IconCirclePlus, IconFolder, IconUsers } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
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

const isCreatingWorkspaceDialogOpen = ref(false)

const computedWorkspaces = computed(() =>
  workspaces.value.map((w) => ({
    label: w.name,
    value: w.id,
    original: w,
  }))
)

const handleSwitchWorkspace = async (workspaceId: AcceptableValue) => {
  if (typeof workspaceId !== "string") return
  await switchWorkspace(workspaceId)
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
      class="bg-background flex max-w-xs flex-col items-stretch gap-2 rounded-lg border p-2"
    >
      <div v-if="isLoading" class="flex justify-center p-4">
        <Spinner />
      </div>
      <Select
        v-else
        :model-value="currentWorkspace?.id"
        :disabled="!currentTeam"
        @update:model-value="handleSwitchWorkspace"
      >
        <SelectTrigger class="w-full">
          <SelectValue
            :placeholder="t('components.workspaceSelector.placeholder')"
          />
        </SelectTrigger>
        <SelectContent>
          <SelectLabel v-if="computedWorkspaces.length === 0">
            {{ t("components.workspaceSelector.noWorkspaces") }}
          </SelectLabel>
          <SelectItem
            v-for="workspace in computedWorkspaces"
            :key="workspace.value"
            :value="workspace.value"
          >
            <div class="flex items-center gap-2">
              <Avatar class="size-4">
                <AvatarImage
                  :src="workspace.original?.photoURL!"
                  :alt="workspace.label"
                  class="size-4"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback class="size-4">
                  {{ getInitials(workspace.label) }}
                </AvatarFallback>
              </Avatar>
              {{ workspace.label }}
            </div>
          </SelectItem>
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
                @click="isCreatingWorkspaceDialogOpen = true"
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
    <Button variant="outline" size="sm" @click="deselectTeam">
      <IconUsers />
      {{ t("components.workspaceSelector.changeTeam") }}
    </Button>
    <WorkspaceDialog
      v-model:open="isCreatingWorkspaceDialogOpen"
      mode="create"
    />
  </Empty>
</template>

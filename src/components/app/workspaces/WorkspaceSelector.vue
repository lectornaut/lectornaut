<script lang="ts" setup>
import { IconCirclePlus, IconFolder, IconUsers } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { useTeamStore } from "@/stores/teamStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"
import type { AcceptableValue } from "reka-ui"
import { toast } from "vue-sonner"

const workspaceStore = useWorkspaceStore()
const { workspaces, isLoading } = storeToRefs(workspaceStore)

const teamStore = useTeamStore()
const { currentTeam } = storeToRefs(teamStore)

const isCreatingWorkspaceDialogOpen = ref(false)

const computedWorkspaces = computed(() =>
  workspaces.value.map((w) => ({
    label: w.name,
    value: w.id,
    original: w,
  }))
)

const switchWorkspace = async (workspaceId: AcceptableValue) => {
  if (typeof workspaceId !== "string") return

  try {
    await workspaceStore.switchWorkspace(workspaceId)
  } catch (_error) {
    toast.error("Failed to switch workspace")
  }
}

const deselectTeam = async () => {
  try {
    await teamStore.clearCurrentTeam()
  } catch (_error) {
    toast.error("Failed to deselect team")
  }
}
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <IconFolder class="text-muted-foreground size-6" />
      </EmptyMedia>
      <EmptyTitle>Workspaces</EmptyTitle>
      <EmptyDescription> Select a workspace to continue </EmptyDescription>
    </EmptyHeader>
    <EmptyContent
      class="bg-background flex max-w-xs flex-col items-stretch gap-2 rounded-lg border p-2"
    >
      <div v-if="isLoading" class="flex justify-center p-4">
        <Spinner />
      </div>
      <Select
        v-else
        :disabled="!currentTeam"
        @update:model-value="switchWorkspace"
      >
        <SelectTrigger class="w-full">
          <SelectValue placeholder="Select workspace" />
        </SelectTrigger>
        <SelectContent>
          <SelectLabel v-if="computedWorkspaces.length === 0">
            No workspaces available
          </SelectLabel>
          <SelectItem
            v-for="workspace in computedWorkspaces"
            :key="workspace.value"
            :value="workspace.value"
          >
            <div class="flex items-center gap-2">
              <Avatar class="size-5">
                <AvatarImage
                  :src="workspace.original?.photoURL!"
                  :alt="workspace.label"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback>
                  {{ getInitials(workspace.label) }}
                </AvatarFallback>
              </Avatar>
              {{ workspace.label }}
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="secondary"
        class="justify-start"
        :disabled="!currentTeam"
        @click="isCreatingWorkspaceDialogOpen = true"
      >
        <IconCirclePlus />
        Create workspace
      </Button>
    </EmptyContent>
    <Button variant="outline" size="sm" @click="deselectTeam">
      <IconUsers />
      Change team
    </Button>
  </Empty>
  <WorkspaceDialog v-model:open="isCreatingWorkspaceDialogOpen" mode="create" />
</template>

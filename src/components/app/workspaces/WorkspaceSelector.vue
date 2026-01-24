<script lang="ts" setup>
import { IconCirclePlus, IconLogOut } from "@/data/icons"
import { useTeamStore } from "@/stores/teamStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const workspaceStore = useWorkspaceStore()
const { workspaces, isLoading } = storeToRefs(workspaceStore)

const teamStore = useTeamStore()

const isCreatingWorkspaceDialogOpen = ref(false)

const switchWorkspace = async (workspaceId: string) => {
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
  <div>
    <div class="w-full max-w-sm space-y-4">
      <div class="space-y-2 text-center">
        <h1 class="text-2xl font-bold tracking-tight">Workspaces</h1>
        <p class="text-muted-foreground text-xs">
          Choose a workspace to continue or create a new one.
        </p>
      </div>
      <div class="bg-background rounded-lg border">
        <div class="p-2">
          <div v-if="isLoading" class="flex justify-center p-4">
            <Spinner />
          </div>
          <template v-else>
            <div
              v-if="workspaces.length === 0"
              class="text-muted-foreground p-4 text-center"
            >
              No workspaces available yet.
            </div>
            <Button
              v-for="workspace in workspaces"
              :key="workspace.id"
              variant="ghost"
              size="lg"
              class="w-full justify-start p-3"
              @click="switchWorkspace(workspace.id)"
            >
              <Avatar class="size-5">
                <AvatarImage
                  :src="`https://avatar.vercel.sh/${workspace.name}.png`"
                  :alt="workspace.name"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback>
                  {{ workspace.name.charAt(0).toUpperCase() }}
                </AvatarFallback>
              </Avatar>
              {{ workspace.name }}
            </Button>
          </template>
        </div>
        <Separator />
        <div class="grid p-2">
          <Button @click="isCreatingWorkspaceDialogOpen = true">
            <IconCirclePlus />
            Create workspace
          </Button>
        </div>
      </div>
      <div class="text-center">
        <Button variant="outline" size="sm" @click="deselectTeam">
          <IconLogOut />
          Deselect team
        </Button>
      </div>
    </div>
    <WorkspaceDialog
      v-model:open="isCreatingWorkspaceDialogOpen"
      mode="create"
    />
  </div>
</template>

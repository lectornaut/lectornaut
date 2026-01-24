<script setup lang="ts">
import { IconCheck, IconChevronDown, IconCirclePlus } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()

const workspaceStore = useWorkspaceStore()
const { workspaces, currentWorkspace, isLoading } = storeToRefs(workspaceStore)

const isCreatingWorkspaceDialogOpen = ref(false)

const switchWorkspace = async (workspaceId: string) => {
  try {
    await workspaceStore.switchWorkspace(workspaceId)
  } catch (_error) {
    toast.error("Failed to switch workspace")
  }
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="data-[state=open]:bg-accent">
            <Avatar class="size-4">
              <AvatarImage
                class="size-4"
                :src="`https://avatar.vercel.sh/${currentWorkspace?.name!}.png`"
                :alt="currentWorkspace?.name!"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="size-4">
                {{ currentWorkspace?.name! }}
              </AvatarFallback>
            </Avatar>
            {{ currentWorkspace?.name! }}
            <IconChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-48">
          <DropdownMenuGroup v-if="isLoading" class="flex justify-center py-2">
            <Spinner />
          </DropdownMenuGroup>
          <DropdownMenuGroup v-else>
            <DropdownMenuLabel class="text-muted-foreground text-xs">
              {{
                workspaces.length === 0
                  ? t("components.workspaceSwitcher.noOtherWorkspaces")
                  : t("components.workspaceSwitcher.myWorkspaces")
              }}
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="workspace in workspaces"
              :key="workspace.id"
              @click="switchWorkspace(workspace.id)"
            >
              <Avatar class="size-4">
                <AvatarImage
                  class="size-4"
                  :src="`https://avatar.vercel.sh/${workspace.name}.png`"
                  :alt="workspace.name"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback class="size-4">
                  {{ getInitials(workspace.name) }}
                </AvatarFallback>
              </Avatar>
              <span class="truncate">
                {{ workspace.name }}
              </span>
              <DropdownMenuShortcut
                v-if="workspace.id === currentWorkspace?.id"
              >
                <IconCheck />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="isCreatingWorkspaceDialogOpen = true">
              <IconCirclePlus />
              {{ t("components.workspaceSwitcher.createWorkspace") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ContextMenuTrigger>
  </ContextMenu>
  <WorkspaceDialog v-model:open="isCreatingWorkspaceDialogOpen" mode="create" />
</template>

<script setup lang="ts">
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconBlocks,
  IconCheck,
  IconChevronDown,
  IconCirclePlus,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useTeamStore } from "@/stores/teamStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()

const workspaceStore = useWorkspaceStore()
const { workspaces, currentWorkspace, isLoading } = storeToRefs(workspaceStore)
const { canCreateWorkspace, getCannotCreateWorkspaceReason } =
  useWorkspaceActions()

const teamStore = useTeamStore()
const { currentTeam } = storeToRefs(teamStore)

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
    <ContextMenuTrigger id="tour-workspace-switcher">
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="data-[state=open]:bg-accent"
                  :disabled="!currentTeam"
                >
                  <template v-if="currentWorkspace">
                    <Avatar class="size-4">
                      <AvatarImage
                        class="size-4"
                        :src="currentWorkspace?.photoURL!"
                        :alt="currentWorkspace?.name!"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback class="size-4">
                        {{ getInitials(currentWorkspace?.name!) }}
                      </AvatarFallback>
                    </Avatar>
                    {{ currentWorkspace?.name! }}
                  </template>
                  <template v-else>
                    {{ t("components.workspaceSwitcher.selectWorkspace") }}
                  </template>
                  <IconChevronDown />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {{ t("components.workspaceSwitcher.tooltip") }}
            </TooltipContent>
            <DropdownMenuContent class="w-48">
              <DropdownMenuGroup
                v-if="isLoading"
                class="flex justify-center py-2"
              >
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
                      :src="workspace.photoURL!"
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
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <!-- Wrapper div to capture hover when disabled -->
                      <div>
                        <DropdownMenuItem
                          :disabled="!canCreateWorkspace"
                          @click="isCreatingWorkspaceDialogOpen = true"
                        >
                          <IconCirclePlus />
                          {{
                            t("components.workspaceSwitcher.createWorkspace")
                          }}
                        </DropdownMenuItem>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent v-if="!canCreateWorkspace">
                      {{ t(getCannotCreateWorkspaceReason || "") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Tooltip>
      </TooltipProvider>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-48">
      <ContextMenuGroup>
        <ContextMenuItem
          @click="emitter.emit('Dialog.Settings.Open', 'workspaces')"
        >
          <IconBlocks />
          {{ t("components.workspaceSwitcher.menu.settings") }}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
  <WorkspaceDialog v-model:open="isCreatingWorkspaceDialogOpen" mode="create" />
</template>

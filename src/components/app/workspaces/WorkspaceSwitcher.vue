<script setup lang="ts">
import { useTeamActions } from "@/composables/useTeamActions"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconBlocks,
  IconCheck,
  IconChevronDown,
  IconCirclePlus,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()

const {
  workspaces,
  currentWorkspace,
  isLoading,
  canCreateWorkspace,
  getCannotCreateWorkspaceReason,
  switchWorkspace,
} = useWorkspaceActions()

const { currentTeam } = useTeamActions()

const isCreatingWorkspaceDialogOpen = ref(false)
const isWorkspaceSwitcherOpen = ref(false)

const openWorkspaceSwitcher = () => {
  if (!currentTeam.value) return
  isWorkspaceSwitcherOpen.value = true
}

emitter.on("Workspace.Switch", openWorkspaceSwitcher)

onUnmounted(() => {
  emitter.off("Workspace.Switch", openWorkspaceSwitcher)
})
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger id="tour-workspace-switcher">
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu v-model:open="isWorkspaceSwitcherOpen">
            <TooltipTrigger as-child>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
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
            <DropdownMenuContent>
              <DropdownMenuGroup
                v-if="isLoading"
                class="flex justify-center py-2"
              >
                <Spinner />
              </DropdownMenuGroup>
              <DropdownMenuGroup v-else>
                <DropdownMenuLabel v-if="workspaces.length === 0">
                  {{ t("components.workspaceSwitcher.noOtherWorkspaces") }}
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
    <ContextMenuContent>
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

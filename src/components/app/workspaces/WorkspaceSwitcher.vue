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

const isCreateWorkspaceDialogOpen = ref(false)
const isSwitcherOpen = ref(false)

// External surfaces drive these without re-mounting the component.
const openSwitcher = () => {
  if (currentTeam.value) isSwitcherOpen.value = true
}
const openCreateWorkspace = () => {
  isCreateWorkspaceDialogOpen.value = true
}

emitter.on("Workspace.Switch", openSwitcher)
emitter.on("Dialog.CreateWorkspace.Open", openCreateWorkspace)

onUnmounted(() => {
  emitter.off("Workspace.Switch", openSwitcher)
  emitter.off("Dialog.CreateWorkspace.Open", openCreateWorkspace)
})
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem id="tour-workspace-switcher">
      <ContextMenu>
        <ContextMenuTrigger>
          <DropdownMenu v-model:open="isSwitcherOpen">
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton
                class="data-[state=open]:bg-accent"
                :tooltip="t('components.workspaceSwitcher.tooltip')"
                :disabled="!currentTeam"
              >
                <div class="flex grow items-center gap-2">
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
                    <span class="truncate">
                      {{ currentWorkspace?.name! }}
                    </span>
                  </template>
                  <template v-else>
                    <IconBlocks />
                    <span class="truncate">
                      {{ t("components.workspaceSwitcher.selectWorkspace") }}
                    </span>
                  </template>
                </div>
                <SyncIndicator />
                <IconChevronDown />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
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
                          @click="isCreateWorkspaceDialogOpen = true"
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
        </ContextMenuTrigger>
        <ContextMenuContent class="w-auto">
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
    </SidebarMenuItem>
  </SidebarMenu>
  <WorkspaceDialog v-model:open="isCreateWorkspaceDialogOpen" mode="create" />
</template>

<script setup lang="ts">
import { IconCheck, IconChevronDown, IconCirclePlus } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"

const { t } = useI18n()

const isLoading = ref(false)
const workspaces = [
  { id: "1", name: "Workspace one" },
  { id: "2", name: "Workspace two" },
]
const activeWorkspace = ref(workspaces[0])
const switchWorkspace = (workspaceId: string) => {
  activeWorkspace.value = workspaces.find(
    (workspace) => workspace.id === workspaceId
  )!
  console.log(`Switching to workspace with ID: ${workspaceId}`)
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
                :src="`https://avatar.vercel.sh/${activeWorkspace?.name!}.png`"
                :alt="activeWorkspace?.name!"
                referrerpolicy="no-referrer"
              />
              <AvatarFallback class="size-4">
                {{ activeWorkspace?.name! }}
              </AvatarFallback>
            </Avatar>
            {{ activeWorkspace?.name! }}
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
              <DropdownMenuShortcut v-if="workspace.id === activeWorkspace?.id">
                <IconCheck />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem @click="console.log('Create workspace')">
              <IconCirclePlus />
              {{ t("components.workspaceSwitcher.createWorkspace") }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ContextMenuTrigger>
  </ContextMenu>
</template>

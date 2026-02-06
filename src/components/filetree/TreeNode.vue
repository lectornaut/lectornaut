<script lang="ts" setup>
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import {
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconMoreHorizontal,
  IconPencil,
  IconPlus,
  IconRefreshCcw,
  IconTrash,
} from "@/data/icons"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import type { WorkspaceNode } from "@/types"
import { showErrorToast, showSuccessToast } from "@/utils/toast-helpers"
import { computed, ref } from "vue"

defineOptions({
  name: "TreeNode",
})

const props = defineProps<{
  teamId: string
  workspaceId: string
  nodeId: string
}>()

const emit = defineEmits<{
  (e: "create-folder", node: WorkspaceNode): void
  (e: "create-file", node: WorkspaceNode): void
  (e: "rename", node: WorkspaceNode): void
  (e: "delete", node: WorkspaceNode): void
  (e: "restore", node: WorkspaceNode): void
}>()

const store = useFileTreeStore()

const node = computed(() =>
  store.getNode(props.teamId, props.workspaceId, props.nodeId)
)

const isFolder = computed(() => node.value?.type === "folder")

const isExpanded = computed(() =>
  isFolder.value
    ? store.isExpanded(props.teamId, props.workspaceId, props.nodeId)
    : false
)

const isLoading = computed(() =>
  isFolder.value
    ? store.isParentLoading(props.teamId, props.workspaceId, props.nodeId)
    : false
)

const childrenIds = computed(() =>
  isFolder.value
    ? store.getChildrenIds(props.teamId, props.workspaceId, props.nodeId)
    : []
)

const pagination = computed(() =>
  store.getPagination(props.teamId, props.workspaceId, props.nodeId)
)

const selectedId = computed(() =>
  store.getSelectedNodeId(props.teamId, props.workspaceId)
)

const isDragOver = ref(false)

const isValidDropEvent = (event: DragEvent) => {
  const types = event.dataTransfer?.types ?? []
  return types.includes("application/x-lectornaut-node")
}

const handleToggle = (open: boolean) => {
  if (!node.value || node.value.type !== "folder") return
  if (open) {
    store.expandFolder(props.teamId, props.workspaceId, props.nodeId)
  } else {
    store.collapseFolder(props.teamId, props.workspaceId, props.nodeId)
  }
}

const handleSelect = () => {
  if (!node.value) return
  store.setSelectedNode(props.teamId, props.workspaceId, node.value.id)
}

const handleDragStart = (event: DragEvent) => {
  if (!node.value || node.value.isDeleted) return
  if (event.dataTransfer) {
    event.dataTransfer.setData("application/x-lectornaut-node", node.value.id)
    event.dataTransfer.setData("text/plain", node.value.id)
    event.dataTransfer.effectAllowed = "move"
  }
}

const handleDragEnter = (event: DragEvent) => {
  if (!node.value || node.value.type !== "folder" || node.value.isDeleted)
    return
  if (!isValidDropEvent(event)) return
  isDragOver.value = true
}

const handleDragOver = (event: DragEvent) => {
  if (!node.value || node.value.type !== "folder" || node.value.isDeleted)
    return
  if (!isValidDropEvent(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move"
  }
  isDragOver.value = true
}

const handleDragLeave = (event: DragEvent) => {
  if (!node.value || node.value.type !== "folder" || node.value.isDeleted)
    return
  const currentTarget = event.currentTarget as HTMLElement | null
  const relatedTarget = event.relatedTarget as Node | null
  if (
    !currentTarget ||
    !relatedTarget ||
    !currentTarget.contains(relatedTarget)
  ) {
    isDragOver.value = false
  }
}

const handleDrop = async (event: DragEvent) => {
  if (!node.value || node.value.type !== "folder" || node.value.isDeleted)
    return
  event.preventDefault()
  event.stopPropagation()
  const draggedId = event.dataTransfer?.getData("application/x-lectornaut-node")
  if (!draggedId || draggedId === node.value.id) {
    isDragOver.value = false
    return
  }

  try {
    await store.moveNodeAction(
      props.teamId,
      props.workspaceId,
      draggedId,
      node.value.id
    )
    showSuccessToast("Moved")
  } catch (error) {
    showErrorToast("Failed to move", (error as Error).message)
  } finally {
    isDragOver.value = false
  }
}

const loadMore = async () => {
  await store.loadMore(props.teamId, props.workspaceId, props.nodeId)
}

const showEmptyState = computed(
  () =>
    isFolder.value &&
    !isLoading.value &&
    childrenIds.value.length === 0 &&
    pagination.value.hasMore === false
)
</script>

<template>
  <SidebarMenuItem v-if="node">
    <template v-if="isFolder">
      <Collapsible :open="isExpanded" @update:open="handleToggle">
        <CollapsibleTrigger as-child>
          <SidebarMenuButton
            :is-active="selectedId === node.id"
            :draggable="!node.isDeleted"
            :class="{
              'bg-sidebar-accent/50 text-sidebar-accent-foreground ring-sidebar-ring ring':
                isDragOver,
            }"
            @click="handleSelect"
            @dragstart="handleDragStart"
            @dragenter="handleDragEnter"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          >
            <Spinner v-if="isLoading" />
            <IconFolderOpen v-else-if="isExpanded" />
            <IconFolder v-else />
            <span
              class="truncate"
              :class="
                node.isDeleted ? 'text-muted-foreground line-through' : ''
              "
            >
              {{ node.name }}
            </span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuAction show-on-hover as-child>
              <Button variant="ghost" size="icon" class="h-6 w-6" @click.stop>
                <IconMoreHorizontal />
              </Button>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <template v-if="!node.isDeleted">
              <DropdownMenuItem @click="emit('create-folder', node)">
                <IconPlus />
                New Folder
              </DropdownMenuItem>
              <DropdownMenuItem @click="emit('create-file', node)">
                <IconPlus />
                New File
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </template>
            <DropdownMenuItem
              :disabled="node.isDeleted"
              @click="emit('rename', node)"
            >
              <IconPencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              v-if="!node.isDeleted"
              @click="emit('delete', node)"
            >
              <IconTrash />
              Delete
            </DropdownMenuItem>
            <DropdownMenuItem v-else @click="emit('restore', node)">
              <IconRefreshCcw />
              Restore
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CollapsibleContent>
          <SidebarMenuSub class="mr-0 pr-0">
            <TreeNode
              v-for="childId in childrenIds"
              :key="childId"
              :team-id="props.teamId"
              :workspace-id="props.workspaceId"
              :node-id="childId"
              @create-folder="emit('create-folder', $event)"
              @create-file="emit('create-file', $event)"
              @rename="emit('rename', $event)"
              @delete="emit('delete', $event)"
              @restore="emit('restore', $event)"
            />
            <SidebarMenuItem v-if="showEmptyState">
              <SidebarMenuButton
                size="sm"
                disabled
                class="text-muted-foreground text-xs"
              >
                Empty
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="pagination.hasMore">
              <SidebarMenuButton
                size="sm"
                class="justify-start text-xs"
                :disabled="pagination.loadingMore"
                @click="loadMore"
              >
                <span v-if="pagination.loadingMore">Loading...</span>
                <span v-else>Load more</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </template>

    <template v-else>
      <SidebarMenuButton
        :is-active="selectedId === node.id"
        :draggable="!node.isDeleted"
        @click="handleSelect"
        @dragstart="handleDragStart"
      >
        <IconFile />
        <span
          class="truncate"
          :class="node.isDeleted ? 'text-muted-foreground line-through' : ''"
        >
          {{ node.name }}
        </span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuAction show-on-hover as-child>
            <Button variant="ghost" size="icon" class="h-6 w-6" @click.stop>
              <IconMoreHorizontal />
            </Button>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            :disabled="node.isDeleted"
            @click="emit('rename', node)"
          >
            <IconPencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            v-if="!node.isDeleted"
            @click="emit('delete', node)"
          >
            <IconTrash />
            Delete
          </DropdownMenuItem>
          <DropdownMenuItem v-else @click="emit('restore', node)">
            <IconRefreshCcw />
            Restore
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
  </SidebarMenuItem>
</template>

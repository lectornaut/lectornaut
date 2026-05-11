<script lang="ts" setup>
import {
  IconChevronRight,
  IconFile,
  IconFilePlus,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMoreHorizontal,
  IconPencil,
  IconRefreshCcw,
  IconTrash,
  IconTrash2,
} from "@/data/icons"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"
import { computed, ref } from "vue"

defineOptions({
  name: "TreeNode",
})

const props = defineProps<{
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
  selectedNodeId?: string | null
}>()

const emit = defineEmits<{
  (e: "create-folder", node: WorkspaceNode): void
  (e: "create-file", node: WorkspaceNode): void
  (e: "rename", node: WorkspaceNode): void
  (e: "archive", node: WorkspaceNode): void
  (e: "unarchive", node: WorkspaceNode): void
  (e: "delete", node: WorkspaceNode): void
  (e: "select", node: WorkspaceNode): void
}>()

const store = useFileTreeStore()
const hasControlledSelection = computed(
  () => props.selectedNodeId !== undefined
)

const node = computed(() =>
  store.getNode(props.scope, props.teamId, props.workspaceId, props.nodeId)
)

const isFolder = computed(() => node.value?.type === "folder")

const isExpanded = computed(() =>
  isFolder.value
    ? store.isExpanded(
        props.scope,
        props.teamId,
        props.workspaceId,
        props.nodeId
      )
    : false
)

const isLoading = computed(() =>
  isFolder.value
    ? store.isParentLoading(
        props.scope,
        props.teamId,
        props.workspaceId,
        props.nodeId
      )
    : false
)

const childrenIds = computed(() =>
  isFolder.value
    ? store.getChildrenIds(
        props.scope,
        props.teamId,
        props.workspaceId,
        props.nodeId
      )
    : []
)

const pagination = computed(() =>
  store.getPagination(
    props.scope,
    props.teamId,
    props.workspaceId,
    props.nodeId
  )
)

const selectedId = computed(() =>
  hasControlledSelection.value
    ? (props.selectedNodeId ?? null)
    : store.getSelectedNodeId(props.scope, props.teamId, props.workspaceId)
)

const isDragOver = ref(false)

const isValidDropEvent = (event: DragEvent) => {
  const types = event.dataTransfer?.types ?? []
  return types.includes("application/x-lectornaut-node")
}

const handleToggle = (open: boolean) => {
  if (!node.value || node.value.type !== "folder") return
  if (open) {
    store.expandFolder(
      props.scope,
      props.teamId,
      props.workspaceId,
      props.nodeId
    )
  } else {
    store.collapseFolder(
      props.scope,
      props.teamId,
      props.workspaceId,
      props.nodeId
    )
  }
}

const handleSelect = () => {
  if (!node.value) return
  if (hasControlledSelection.value) {
    emit("select", node.value)
    return
  }
  store.setSelectedNode(
    props.scope,
    props.teamId,
    props.workspaceId,
    node.value.id
  )
}

const handleDragStart = (event: DragEvent) => {
  if (!node.value || node.value.isArchived) return
  if (event.dataTransfer) {
    event.dataTransfer.setData("application/x-lectornaut-node", node.value.id)
    event.dataTransfer.setData("text/plain", node.value.id)
    event.dataTransfer.effectAllowed = "move"
  }
}

const handleDragEnter = (event: DragEvent) => {
  if (!node.value || node.value.type !== "folder" || node.value.isArchived)
    return
  if (!isValidDropEvent(event)) return
  isDragOver.value = true
}

const handleDragOver = (event: DragEvent) => {
  if (!node.value || node.value.type !== "folder" || node.value.isArchived)
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
  if (!node.value || node.value.type !== "folder" || node.value.isArchived)
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
  if (!node.value || node.value.type !== "folder" || node.value.isArchived)
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
      props.scope,
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
  await store.loadMore(
    props.scope,
    props.teamId,
    props.workspaceId,
    props.nodeId
  )
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
  <template v-if="node">
    <template v-if="isFolder">
      <Collapsible :open="isExpanded" @update:open="handleToggle">
        <SidebarMenuItem>
          <CollapsibleTrigger as-child>
            <SidebarMenuButton
              :is-active="selectedId === node.id"
              :draggable="!node.isArchived"
              :class="{
                'bg-sidebar-accent/50 text-sidebar-accent-foreground ring-sidebar-ring ring-2':
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
              <template v-else>
                <IconChevronRight
                  class="transition"
                  :class="{ 'rotate-90': isExpanded }"
                />
                <IconFolderOpen v-if="isExpanded" />
                <IconFolder v-else />
              </template>
              <span
                class="truncate"
                :class="{
                  'text-muted-foreground line-through': node.isArchived,
                }"
              >
                {{ node.name }}
              </span>
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuAction
                show-on-hover
                class="data-[state=open]:bg-accent"
              >
                <IconMoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-50">
              <template v-if="!node.isArchived">
                <DropdownMenuItem @click="emit('create-folder', node)">
                  <IconFolderPlus />
                  New Folder
                </DropdownMenuItem>
                <DropdownMenuItem @click="emit('create-file', node)">
                  <IconFilePlus />
                  New File
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </template>
              <DropdownMenuItem
                :disabled="node.isArchived"
                @click="emit('rename', node)"
              >
                <IconPencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                v-if="!node.isArchived"
                @click="emit('archive', node)"
              >
                <IconTrash />
                Archive
              </DropdownMenuItem>
              <template v-else>
                <DropdownMenuItem @click="emit('unarchive', node)">
                  <IconRefreshCcw />
                  Unarchive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @click="emit('delete', node)">
                  <IconTrash2 />
                  Delete
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
        <CollapsibleContent>
          <SidebarMenuSub class="mr-0 pr-0">
            <TreeNode
              v-for="childId in childrenIds"
              :key="childId"
              :scope="props.scope"
              :team-id="props.teamId"
              :workspace-id="props.workspaceId"
              :node-id="childId"
              :selected-node-id="props.selectedNodeId"
              @create-folder="emit('create-folder', $event)"
              @create-file="emit('create-file', $event)"
              @rename="emit('rename', $event)"
              @archive="emit('archive', $event)"
              @unarchive="emit('unarchive', $event)"
              @delete="emit('delete', $event)"
              @select="emit('select', $event)"
            />
            <SidebarMenuItem v-if="showEmptyState">
              <SidebarMenuButton disabled> Empty </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="pagination.hasMore">
              <SidebarMenuButton
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
      <SidebarMenuItem>
        <SidebarMenuButton
          :is-active="selectedId === node.id"
          :draggable="!node.isArchived"
          @click="handleSelect"
          @dragstart="handleDragStart"
        >
          <IconFile />
          <span
            class="truncate"
            :class="{ 'text-muted-foreground line-through': node.isArchived }"
          >
            {{ node.name }}
          </span>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <SidebarMenuAction
              show-on-hover
              class="data-[state=open]:bg-accent"
            >
              <IconMoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-50">
            <DropdownMenuItem
              :disabled="node.isArchived"
              @click="emit('rename', node)"
            >
              <IconPencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              v-if="!node.isArchived"
              @click="emit('archive', node)"
            >
              <IconTrash />
              Archive
            </DropdownMenuItem>
            <template v-else>
              <DropdownMenuItem @click="emit('unarchive', node)">
                <IconRefreshCcw />
                Unarchive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="emit('delete', node)">
                <IconTrash2 />
                Delete
              </DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </template>
  </template>
</template>

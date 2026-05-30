<script lang="ts" setup>
import { useFileTreeSelection } from "@/composables/useFileTreeSelection"
import {
  IconArchive,
  IconChevronRight,
  IconCircleFilled,
  IconFile,
  IconFilePlus,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMoreHorizontal,
  IconPencil,
  IconRefreshCcw,
  IconTrash2,
} from "@/data/icons"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"
import { useHotkeys } from "@tanstack/vue-hotkeys"
import { computed, ref } from "vue"

defineOptions({
  name: "TreeNode",
})

const props = defineProps<{
  scope: WorkspaceNodeScope
  teamId: string
  workspaceId: string
  nodeId: string
}>()

const emit = defineEmits<{
  (e: "create-folder", node: WorkspaceNode): void
  (e: "create-file", node: WorkspaceNode): void
  (e: "rename", node: WorkspaceNode): void
  (e: "archive", node: WorkspaceNode): void
  (e: "unarchive", node: WorkspaceNode): void
  (e: "delete", node: WorkspaceNode): void
}>()

const store = useFileTreeStore()
const { t } = useI18n()

// `FileTree` provides this context for every descendant. The fallback
// (null check) lets a `TreeNode` render outside a `FileTree` for unit
// tests or storybook stories without crashing.
const selection = useFileTreeSelection()
const selectionMode = computed(() => selection?.mode.value ?? "none")

const node = computed(() =>
  store.getNode(props.scope, props.teamId, props.workspaceId, props.nodeId)
)

const isFolder = computed(() => node.value?.type === "folder")

const isSelected = computed(() => selection?.isSelected(props.nodeId) ?? false)

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

const handleRowClick = () => {
  if (!node.value) return
  selection?.onRowClick(node.value)
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
    showSuccessToast(t("fileTree.toast.moved"))
  } catch (error) {
    showErrorToast(t("fileTree.toast.moveFailed"), (error as Error).message)
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

// ──────────────────────────────────────────────────────────────────────────
// Menu keyboard shortcuts
//
// While THIS node's dropdown menu is open, expose accelerators mirroring the
// menu items: R = rename, E = archive/unarchive, ⌫/Delete = delete.
//
// `useHotkeys` registers on `document`; because `TreeNode` is recursive, every
// instance binds the same keys, so `conflictBehavior: "allow"` suppresses the
// duplicate-registration warnings. reka-ui dropdowns are modal (one open at a
// time), so the per-binding `enabled` gate — driven by `menuOpen` — guarantees
// only the open menu's handlers ever run.
// ──────────────────────────────────────────────────────────────────────────
const menuOpen = ref(false)

// Mirror the click path: dispatching an action also dismisses the menu.
const runMenuAction = (action: () => void) => {
  action()
  menuOpen.value = false
}

// Shared gate: an accelerator only fires while this node's menu is open.
const menuActionEnabled = () => menuOpen.value && !!node.value

// Child creation is folder-only and unavailable on archived nodes — keep the
// gate congruent with the menu items, which only render under the same checks.
const canCreateChild = () =>
  menuActionEnabled() && isFolder.value && !node.value?.isArchived

const createFolder = () => {
  const current = node.value
  if (!current || current.type !== "folder" || current.isArchived) return
  runMenuAction(() => emit("create-folder", current))
}

const createFile = () => {
  const current = node.value
  if (!current || current.type !== "folder" || current.isArchived) return
  runMenuAction(() => emit("create-file", current))
}

const renameNode = () => {
  const current = node.value
  if (!current || current.isArchived) return
  runMenuAction(() => emit("rename", current))
}

const toggleArchiveNode = () => {
  const current = node.value
  if (!current) return
  // One key covers both states — only one of the two items is ever shown.
  runMenuAction(() => {
    if (current.isArchived) {
      emit("unarchive", current)
    } else {
      emit("archive", current)
    }
  })
}

const deleteNode = () => {
  const current = node.value
  if (!current) return
  runMenuAction(() => emit("delete", current))
}

useHotkeys(
  [
    {
      hotkey: "Shift+N",
      callback: createFolder,
      options: { enabled: canCreateChild },
    },
    {
      hotkey: "N",
      callback: createFile,
      options: { enabled: canCreateChild },
    },
    {
      hotkey: "R",
      callback: renameNode,
      // Rename is unavailable for archived nodes (mirrors the disabled item).
      options: {
        enabled: () => menuActionEnabled() && !node.value?.isArchived,
      },
    },
    {
      hotkey: "E",
      callback: toggleArchiveNode,
      options: { enabled: menuActionEnabled },
    },
    // Bind both Backspace (macOS ⌫) and Delete (Windows / forward-delete).
    {
      hotkey: "Backspace",
      callback: deleteNode,
      options: { enabled: menuActionEnabled },
    },
    {
      hotkey: "Delete",
      callback: deleteNode,
      options: { enabled: menuActionEnabled },
    },
  ],
  { conflictBehavior: "allow" }
)
</script>

<template>
  <template v-if="node">
    <template v-if="isFolder">
      <Collapsible :open="isExpanded" @update:open="handleToggle">
        <SidebarMenuItem>
          <!--
            Chevron is a real `<button>` rendered as a sibling of the
            row. The absolute positioning mirrors the pattern used by
            `SidebarMenuAction` (top-right) — we just mount it on the
            left. The `@click.stop` keeps the click from bubbling out
            of the chevron region in case something further up the tree
            tries to catch it. The Collapsible primitive listens for
            clicks on its trigger directly, so propagation stop is
            safe.
          -->
          <CollapsibleTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              class="absolute top-1 left-1"
              @click.stop
            >
              <Spinner v-if="isLoading" />
              <IconChevronRight
                v-else
                class="transition-transform"
                :class="{ 'rotate-90': isExpanded }"
              />
            </Button>
          </CollapsibleTrigger>
          <SidebarMenuButton
            class="pl-8"
            :is-active="isSelected"
            :draggable="!node.isArchived"
            :class="{
              'bg-sidebar-accent/50 text-sidebar-accent-foreground ring-sidebar-ring ring-2':
                isDragOver,
            }"
            @click="handleRowClick"
            @dragstart="handleDragStart"
            @dragenter="handleDragEnter"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          >
            <!--
              Selection indicator. Renders only for "single" / "multiple"
              modes — "none" gets nothing because the row highlight alone
              carries the selection signal there. We use the real Checkbox
              primitive (for proper a11y semantics) but make it
              non-interactive — the row click is the single canonical
              trigger. This avoids "did the checkbox or the row fire?"
              double-handling ambiguity.
            -->
            <Checkbox
              v-if="selectionMode === 'multiple'"
              :model-value="isSelected"
              tabindex="-1"
              aria-hidden="true"
              class="pointer-events-none"
            />
            <span
              v-else-if="selectionMode === 'single'"
              role="radio"
              :aria-checked="isSelected"
              :data-state="isSelected ? 'checked' : 'unchecked'"
              class="border-input data-[state=checked]:bg-primary data-[state=checked]:border-primary relative flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border"
            >
              <IconCircleFilled
                v-if="isSelected"
                class="text-primary-foreground size-2!"
              />
            </span>

            <IconFolderOpen v-if="isExpanded" />
            <IconFolder v-else />
            <span
              class="truncate"
              :class="{
                'text-muted-foreground line-through': node.isArchived,
              }"
            >
              {{ node.name }}
            </span>
          </SidebarMenuButton>
          <DropdownMenu v-model:open="menuOpen">
            <DropdownMenuTrigger as-child>
              <SidebarMenuAction
                show-on-hover
                class="data-[state=open]:bg-accent"
              >
                <IconMoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-auto">
              <template v-if="!node.isArchived">
                <DropdownMenuItem @click="emit('create-folder', node)">
                  <IconFolderPlus />
                  {{ t("fileTree.newFolder") }}
                  <DropdownMenuShortcut>⇧N</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem @click="emit('create-file', node)">
                  <IconFilePlus />
                  {{ t("fileTree.newFile") }}
                  <DropdownMenuShortcut>N</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </template>
              <DropdownMenuItem
                :disabled="node.isArchived"
                @click="emit('rename', node)"
              >
                <IconPencil />
                {{ t("actions.rename") }}
                <DropdownMenuShortcut v-if="!node.isArchived">
                  R
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="!node.isArchived"
                @click="emit('archive', node)"
              >
                <IconArchive />
                {{ t("fileTree.archive") }}
                <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem v-else @click="emit('unarchive', node)">
                <IconRefreshCcw />
                {{ t("fileTree.unarchive") }}
                <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="emit('delete', node)">
                <IconTrash2 />
                {{ t("actions.delete") }}
                <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
              </DropdownMenuItem>
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
              @create-folder="emit('create-folder', $event)"
              @create-file="emit('create-file', $event)"
              @rename="emit('rename', $event)"
              @archive="emit('archive', $event)"
              @unarchive="emit('unarchive', $event)"
              @delete="emit('delete', $event)"
            />
            <SidebarMenuItem v-if="showEmptyState">
              <SidebarMenuButton disabled>
                {{ t("fileTree.emptyFolder") }}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="pagination.hasMore">
              <SidebarMenuButton
                class="justify-start text-xs"
                :disabled="pagination.loadingMore"
                @click="loadMore"
              >
                <span v-if="pagination.loadingMore">
                  {{ t("states.loading") }}
                </span>
                <span v-else>{{ t("fileTree.loadMore") }}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </template>

    <template v-else>
      <SidebarMenuItem>
        <!--
          Files have no chevron — render a width-matched spacer so the
          file/folder icons of files and folders stay vertically aligned
          inside the same parent list.
        -->
        <SidebarMenuButton
          class="pl-8"
          :is-active="isSelected"
          :draggable="!node.isArchived"
          @click="handleRowClick"
          @dragstart="handleDragStart"
        >
          <Checkbox
            v-if="selectionMode === 'multiple'"
            :model-value="isSelected"
            tabindex="-1"
            aria-hidden="true"
            class="pointer-events-none"
          />
          <span
            v-else-if="selectionMode === 'single'"
            role="radio"
            :aria-checked="isSelected"
            :data-state="isSelected ? 'checked' : 'unchecked'"
            class="border-input data-[state=checked]:bg-primary data-[state=checked]:border-primary relative flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border"
          >
            <IconCircleFilled
              v-if="isSelected"
              class="text-primary-foreground size-2!"
            />
          </span>

          <IconFile />
          <span
            class="truncate"
            :class="{ 'text-muted-foreground line-through': node.isArchived }"
          >
            {{ node.name }}
          </span>
        </SidebarMenuButton>
        <DropdownMenu v-model:open="menuOpen">
          <DropdownMenuTrigger as-child>
            <SidebarMenuAction
              show-on-hover
              class="data-[state=open]:bg-accent"
            >
              <IconMoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-auto">
            <DropdownMenuItem
              :disabled="node.isArchived"
              @click="emit('rename', node)"
            >
              <IconPencil />
              {{ t("actions.rename") }}
              <DropdownMenuShortcut v-if="!node.isArchived">
                R
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="!node.isArchived"
              @click="emit('archive', node)"
            >
              <IconArchive />
              {{ t("fileTree.archive") }}
              <DropdownMenuShortcut>E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem v-else @click="emit('unarchive', node)">
              <IconRefreshCcw />
              {{ t("fileTree.unarchive") }}
              <DropdownMenuShortcut>E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="emit('delete', node)">
              <IconTrash2 />
              {{ t("actions.delete") }}
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </template>
  </template>
</template>

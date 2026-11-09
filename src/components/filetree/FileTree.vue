<script lang="ts" setup>
import {
  provideSidebarContext,
  useSidebar,
} from "@/components/ui/sidebar/utils"
import {
  provideFileTreeSelection,
  type FileTreeSelectionMode,
} from "@/composables/useFileTreeSelection"
import {
  IconArchive,
  IconChevronDown,
  IconChevronRight,
  IconRefreshCcw,
  IconTrash2,
  IconX,
  IconFilePlus,
  IconFolderPlus,
  IconFolder,
} from "@/data/icons"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import {
  ROOT_PARENT_ID,
  type WorkspaceNode,
  type WorkspaceNodeScope,
} from "@/types/nodes"
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue"

const props = withDefaults(
  defineProps<{
    teamId: string
    workspaceId: string
    scope: WorkspaceNodeScope
    /**
     * How the tree renders selection state.
     *   - "none":     row click writes to the file-tree store; highlight
     *                 tracks the store. Routing pages use this.
     *   - "single":   row click emits `select`; highlight tracks the
     *                 string passed in `selection`.
     *   - "multiple": row click emits `select`; highlight tracks the
     *                 array passed in `selection`.
     */
    selectionMode?: FileTreeSelectionMode
    /**
     * Read-only selection state. The shape must match `selectionMode`:
     * a string (or null) for "single", an array for "multiple",
     * ignored for "none".
     */
    selection?: string | readonly string[] | null
  }>(),
  {
    selectionMode: "none",
    selection: null,
  }
)

const emit = defineEmits<{
  (e: "select", node: WorkspaceNode): void
}>()

const store = useFileTreeStore()
const { t } = useI18n()
const treeSidebarOpen = ref(true)
const treeSidebarOpenMobile = ref(false)
const treeSidebarIsMobile = ref(false)
const existingSidebarContext = useSidebar(null)

// FileTree can render inside sheets and layoutless routes without the app shell.
if (!existingSidebarContext) {
  provideSidebarContext({
    state: computed(() => (treeSidebarOpen.value ? "expanded" : "collapsed")),
    open: treeSidebarOpen,
    setOpen: (value: boolean) => {
      treeSidebarOpen.value = value
    },
    isMobile: treeSidebarIsMobile,
    openMobile: treeSidebarOpenMobile,
    setOpenMobile: (value: boolean) => {
      treeSidebarOpenMobile.value = value
    },
    toggleSidebar: () => {
      treeSidebarOpen.value = !treeSidebarOpen.value
    },
  })
}

// ── Selection context ────────────────────────────────────────────────────────
//
// Computed set of "currently highlighted" ids. Built once per change so
// nested `TreeNode`s can ask `isSelected(id)` in O(1) without re-deriving
// from the raw selection prop each call. The store fallback applies only
// in "none" mode — the page-level routes write their current node into
// the store and we render whatever the store says is selected.

const selectionMode = computed<FileTreeSelectionMode>(() => props.selectionMode)

// ── Finder-style multi-select ("none" mode only) ───────────────────────────
//
// ⌘/Ctrl-click toggles a row into `multiSelectedIds`, Shift-click selects
// the visible range from the anchor. A plain click clears it and opens the
// node as before. Bulk actions live in the "N selected" menu under the tree;
// row menus always act on their own node.

const multiSelectedIds = ref<string[]>([])
let anchorId: string | null = null

const storeSelectedId = computed(() =>
  store.getSelectedNodeId(props.scope, props.teamId, props.workspaceId)
)

/** Ids in on-screen order: children of expanded folders follow their parent. */
const visibleIds = (parentId: string): string[] =>
  store
    .getChildrenIds(props.scope, props.teamId, props.workspaceId, parentId)
    .flatMap((id) => [
      id,
      ...(store.isExpanded(props.scope, props.teamId, props.workspaceId, id)
        ? visibleIds(id)
        : []),
    ])

const handleMultiSelectClick = (node: WorkspaceNode, event: MouseEvent) => {
  if (event.shiftKey) {
    const order = visibleIds(ROOT_PARENT_ID)
    const to = order.indexOf(node.id)
    const anchorIndex = order.indexOf(anchorId ?? storeSelectedId.value ?? "")
    const from = anchorIndex === -1 ? to : anchorIndex
    multiSelectedIds.value = order.slice(
      Math.min(from, to),
      Math.max(from, to) + 1
    )
    return true
  }
  if (event.metaKey || event.ctrlKey) {
    const base = selectedNodes.value.length
      ? selectedNodes.value.map((n) => n.id)
      : storeSelectedId.value
        ? [storeSelectedId.value]
        : []
    multiSelectedIds.value = base.includes(node.id)
      ? base.filter((id) => id !== node.id)
      : [...base, node.id]
    anchorId = node.id
    return true
  }
  multiSelectedIds.value = []
  anchorId = node.id
  return false
}

const hasAncestorIn = (id: string, ids: Set<string>) => {
  let parentId = store.getNode(
    props.scope,
    props.teamId,
    props.workspaceId,
    id
  )?.parentId
  while (parentId && parentId !== ROOT_PARENT_ID) {
    if (ids.has(parentId)) return true
    parentId = store.getNode(
      props.scope,
      props.teamId,
      props.workspaceId,
      parentId
    )?.parentId
  }
  return false
}

// Resolved against the live store, so deleted nodes (and a deleted
// folder's subtree) drop out of the selection on their own.
const selectedNodes = computed<WorkspaceNode[]>(() =>
  multiSelectedIds.value
    .map((id) =>
      store.getNode(props.scope, props.teamId, props.workspaceId, id)
    )
    .filter((n): n is WorkspaceNode => Boolean(n))
)

/** Selected nodes, minus any whose ancestor is also selected. */
const bulkTargets = computed<WorkspaceNode[]>(() => {
  const ids = new Set(selectedNodes.value.map((n) => n.id))
  // Archive/delete cascade to descendants, so acting on a selected folder
  // already covers its selected children; acting twice would fail.
  return selectedNodes.value.filter((n) => !hasAncestorIn(n.id, ids))
})

const bulkBusy = ref(false)

const bulkHasActive = computed(() =>
  bulkTargets.value.some((n) => !n.isArchived)
)
const bulkHasArchived = computed(() =>
  bulkTargets.value.some((n) => n.isArchived)
)

const clearSelection = () => {
  multiSelectedIds.value = []
}

/** Drop acted-on nodes (and their descendants) from the multi-selection. */
const deselect = (nodes: WorkspaceNode[]) => {
  const done = new Set(nodes.map((n) => n.id))
  multiSelectedIds.value = multiSelectedIds.value.filter(
    (id) => !done.has(id) && !hasAncestorIn(id, done)
  )
}

const selectedIds = computed<Set<string>>(() => {
  if (selectionMode.value === "multiple") {
    return new Set(Array.isArray(props.selection) ? props.selection : [])
  }
  if (selectionMode.value === "single") {
    const id = typeof props.selection === "string" ? props.selection : null
    return new Set(id ? [id] : [])
  }
  // "none": follow the store so URL-driven selection still highlights,
  // unless a ⌘/Shift multi-selection is active.
  if (selectedNodes.value.length) {
    return new Set(selectedNodes.value.map((n) => n.id))
  }
  return new Set(storeSelectedId.value ? [storeSelectedId.value] : [])
})

provideFileTreeSelection({
  mode: selectionMode,
  isSelected: (id: string) => selectedIds.value.has(id),
  onRowClick: (node: WorkspaceNode, event: MouseEvent) => {
    if (selectionMode.value === "none") {
      if (handleMultiSelectClick(node, event)) return
      store.setSelectedNode(
        props.scope,
        props.teamId,
        props.workspaceId,
        node.id
      )
      return
    }
    // For "single" and "multiple", the parent owns the selection state.
    // It also decides whether a click means "set" or "toggle", since
    // that depends on context (e.g. the AI composer caps at 10).
    emit("select", node)
  },
})

const rootChildren = computed(() =>
  store.getChildrenIds(
    props.scope,
    props.teamId,
    props.workspaceId,
    ROOT_PARENT_ID
  )
)

const rootLoading = computed(() =>
  store.isParentLoading(
    props.scope,
    props.teamId,
    props.workspaceId,
    ROOT_PARENT_ID
  )
)

const rootPagination = computed(() =>
  store.getPagination(
    props.scope,
    props.teamId,
    props.workspaceId,
    ROOT_PARENT_ID
  )
)

const dialogs = reactive({
  create: {
    open: false,
    type: "folder" as "folder" | "file",
    parentId: ROOT_PARENT_ID,
  },
  rename: {
    open: false,
    node: null as WorkspaceNode | null,
  },
  archive: {
    open: false,
    nodes: [] as WorkspaceNode[],
  },
  delete: {
    open: false,
    nodes: [] as WorkspaceNode[],
  },
})

const createName = ref("")
const isCreating = ref(false)
const renameName = ref("")
const isRenaming = ref(false)

const openCreateDialog = (type: "folder" | "file", parentId: string) => {
  dialogs.create.type = type
  dialogs.create.parentId = parentId
  dialogs.create.open = true
}

const openRenameDialog = (node: WorkspaceNode) => {
  dialogs.rename.node = node
  dialogs.rename.open = true
}

const openArchiveDialog = (nodes: WorkspaceNode[]) => {
  dialogs.archive.nodes = nodes.filter((n) => !n.isArchived)
  dialogs.archive.open = true
}

const openDeleteDialog = (nodes: WorkspaceNode[]) => {
  dialogs.delete.nodes = nodes
  dialogs.delete.open = true
}

/** Confirm-dialog copy: the node's name, or a count for a multi-selection. */
const describeTargets = (
  nodes: WorkspaceNode[],
  oneKey: string,
  manyKey: string
) =>
  nodes.length > 1
    ? t(manyKey, { count: nodes.length })
    : t(oneKey, { name: nodes[0]?.name ?? "" })

watch(
  () => dialogs.create.open,
  (open) => {
    if (open) {
      createName.value = ""
    }
  }
)

watch(
  () => dialogs.rename.open,
  (open) => {
    if (open && dialogs.rename.node) {
      renameName.value = dialogs.rename.node.name
    }
  }
)

/**
 * Runs `action` on every node in parallel and drops the ones that succeeded
 * from the multi-selection; the first failure is rethrown for the caller's
 * toast, so a partial run stays visible instead of silently half-done.
 */
const runOnNodes = async (
  nodes: WorkspaceNode[],
  action: (node: WorkspaceNode) => Promise<unknown>
) => {
  bulkBusy.value = true
  try {
    const results = await Promise.allSettled(nodes.map(action))
    deselect(nodes.filter((_, i) => results[i]?.status === "fulfilled"))
    const failed = results.find((r) => r.status === "rejected")
    if (failed) throw failed.reason
  } finally {
    bulkBusy.value = false
  }
}

const handleUnarchive = async (nodes: WorkspaceNode[]) => {
  try {
    await runOnNodes(
      nodes.filter((n) => n.isArchived),
      (n) =>
        store.unarchiveNodeAction(
          props.scope,
          props.teamId,
          props.workspaceId,
          n.id
        )
    )
    showSuccessToast(t("fileTree.toast.unarchived"))
  } catch (error) {
    showErrorToast(
      t("fileTree.toast.unarchiveFailed"),
      (error as Error).message
    )
  }
}

const handleCreated = async (nodeId: string) => {
  if (dialogs.create.parentId !== ROOT_PARENT_ID) {
    store.expandFolder(
      props.scope,
      props.teamId,
      props.workspaceId,
      dialogs.create.parentId
    )
  }

  if (dialogs.create.type !== "file") return

  // For controlled modes the parent decides what to do with the new
  // file. For "none", we set it as the store's selection so the route
  // can react and open the editor.
  if (selectionMode.value !== "none") {
    const createdNode = await store.ensureNodeLoaded(
      props.scope,
      props.teamId,
      props.workspaceId,
      nodeId
    )

    if (createdNode) {
      emit("select", createdNode)
    }

    return
  }

  store.setSelectedNode(props.scope, props.teamId, props.workspaceId, nodeId)
}

const handleCreateSubmit = async () => {
  if (!createName.value.trim()) return

  isCreating.value = true
  try {
    const nodeId =
      dialogs.create.type === "folder"
        ? await store.createFolderNode(
            props.scope,
            props.teamId,
            props.workspaceId,
            dialogs.create.parentId,
            createName.value
          )
        : await store.createFileNode(
            props.scope,
            props.teamId,
            props.workspaceId,
            dialogs.create.parentId,
            createName.value
          )

    showSuccessToast(
      dialogs.create.type === "folder"
        ? t("fileTree.toast.folderCreated")
        : t("fileTree.toast.fileCreated")
    )
    await handleCreated(nodeId)
    dialogs.create.open = false
  } catch (error) {
    showErrorToast(t("fileTree.toast.createFailed"), (error as Error).message)
  } finally {
    isCreating.value = false
  }
}

const handleRenameSubmit = async () => {
  if (!dialogs.rename.node) return
  if (!renameName.value.trim()) return

  isRenaming.value = true
  try {
    await store.renameNodeAction(
      props.scope,
      props.teamId,
      props.workspaceId,
      dialogs.rename.node.id,
      renameName.value
    )
    showSuccessToast(t("fileTree.toast.renamed"))
    dialogs.rename.open = false
  } catch (error) {
    showErrorToast(t("fileTree.toast.renameFailed"), (error as Error).message)
  } finally {
    isRenaming.value = false
  }
}

const isRootDragOver = ref(false)

const isValidRootDrop = (event: DragEvent) => {
  const types = event.dataTransfer?.types ?? []
  return types.includes("application/x-lectornaut-node")
}

const handleRootDragEnter = (event: DragEvent) => {
  if (!isValidRootDrop(event)) return
  isRootDragOver.value = true
}

const handleRootDragOver = (event: DragEvent) => {
  if (!isValidRootDrop(event)) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move"
  }
  isRootDragOver.value = true
}

const handleRootDragLeave = (event: DragEvent) => {
  const currentTarget = event.currentTarget as HTMLElement | null
  const relatedTarget = event.relatedTarget as Node | null
  if (
    !currentTarget ||
    !relatedTarget ||
    !currentTarget.contains(relatedTarget)
  ) {
    isRootDragOver.value = false
  }
}

const handleRootDrop = async (event: DragEvent) => {
  const draggedId = event.dataTransfer?.getData("application/x-lectornaut-node")
  if (!draggedId) return
  event.preventDefault()
  isRootDragOver.value = false

  try {
    await store.moveNodeAction(
      props.scope,
      props.teamId,
      props.workspaceId,
      draggedId,
      ROOT_PARENT_ID
    )
    showSuccessToast(t("fileTree.toast.moved"))
  } catch (error) {
    showErrorToast(t("fileTree.toast.moveFailed"), (error as Error).message)
  }
}

const handleArchiveConfirm = async () => {
  if (!dialogs.archive.nodes.length) return

  try {
    await runOnNodes(dialogs.archive.nodes, (n) =>
      store.archiveNodeAction(
        props.scope,
        props.teamId,
        props.workspaceId,
        n.id
      )
    )
    showSuccessToast(t("fileTree.toast.archived"))
  } catch (error) {
    showErrorToast(t("fileTree.toast.archiveFailed"), (error as Error).message)
    return false
  }
}

const handleDeleteConfirm = async () => {
  if (!dialogs.delete.nodes.length) return

  try {
    await runOnNodes(dialogs.delete.nodes, (n) =>
      store.deleteNodeAction(props.scope, props.teamId, props.workspaceId, n.id)
    )
    showSuccessToast(t("fileTree.toast.deleted"))
  } catch (error) {
    showErrorToast(t("fileTree.toast.deleteFailed"), (error as Error).message)
    return false
  }
}

const loadMoreRoot = async () => {
  await store.loadMore(
    props.scope,
    props.teamId,
    props.workspaceId,
    ROOT_PARENT_ID
  )
}

watch(
  () => [props.scope, props.teamId, props.workspaceId] as const,
  ([scope, teamId, workspaceId], previous) => {
    const prevScope = previous?.[0]
    const prevTeamId = previous?.[1]
    const prevWorkspaceId = previous?.[2]
    multiSelectedIds.value = []
    anchorId = null
    if (prevScope && prevTeamId && prevWorkspaceId) {
      store.releaseWorkspace(prevScope, prevTeamId, prevWorkspaceId)
    }
    if (scope && teamId && workspaceId) {
      store.retainWorkspace(scope, teamId, workspaceId)
      store.ensureRootSubscribed(scope, teamId, workspaceId)
    }
  },
  { immediate: true }
)

// ── Reveal-on-selection ──────────────────────────────────────────────────────
//
// When the active selection points to a node deep in the tree, walk up the
// parent chain and expand each ancestor folder so the highlighted row is
// actually visible. `selectedIds` already unifies "none", "single", and
// "multiple" above, so one watcher covers all three modes.
//
// `revealEpoch` cancels in-flight walks when the selection changes mid-run:
// each `await store.ensureNodeLoaded` may hit Firestore and resume into
// stale state, so we bail when our epoch is no longer the latest. Manual
// collapses by the user are preserved — the watcher only fires when
// `selectedIds` itself changes, not on every render.

let revealEpoch = 0

const revealSelectedNodes = async () => {
  const epoch = ++revealEpoch
  const ids = selectedIds.value
  if (!ids.size) return

  const scope = props.scope
  const teamId = props.teamId
  const workspaceId = props.workspaceId
  const visited = new Set<string>()

  for (const id of ids) {
    let cursorId: string | null = id
    while (cursorId && cursorId !== ROOT_PARENT_ID) {
      if (visited.has(cursorId)) break
      visited.add(cursorId)

      const node = await store.ensureNodeLoaded(
        scope,
        teamId,
        workspaceId,
        cursorId
      )
      if (epoch !== revealEpoch) return
      if (!node) break

      const parentId = node.parentId
      if (parentId && parentId !== ROOT_PARENT_ID) {
        store.expandFolder(scope, teamId, workspaceId, parentId)
      }
      cursorId = parentId
    }
  }
}

watch(selectedIds, () => revealSelectedNodes(), { immediate: true })

onBeforeUnmount(() => {
  store.releaseWorkspace(props.scope, props.teamId, props.workspaceId)
})
</script>

<template>
  <SidebarGroup>
    <Collapsible default-open class="group/collapsible grid gap-2">
      <SidebarGroupLabel
        as-child
        class="h-auto w-full justify-between p-0 pl-2"
      >
        <CollapsibleTrigger>
          <span class="flex items-center gap-2">
            <IconFolder />
            {{ t("fileTree.documents") }}
            <IconChevronRight
              class="transition-transform group-data-[state=open]/collapsible:rotate-90"
            />
          </span>
          <TooltipProvider>
            <ButtonGroup>
              <!-- <ButtonGroup> -->
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    :aria-label="t('fileTree.newFolder')"
                    size="icon"
                    variant="outline"
                    @click.stop="openCreateDialog('folder', ROOT_PARENT_ID)"
                  >
                    <IconFolderPlus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t("fileTree.newFolder") }}</TooltipContent>
              </Tooltip>
              <!-- </ButtonGroup>
              <ButtonGroup> -->
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    :aria-label="t('fileTree.newFile')"
                    size="icon"
                    variant="outline"
                    @click.stop="openCreateDialog('file', ROOT_PARENT_ID)"
                  >
                    <IconFilePlus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t("fileTree.newFile") }}</TooltipContent>
              </Tooltip>
            </ButtonGroup>
            <!-- </ButtonGroup> -->
          </TooltipProvider>
        </CollapsibleTrigger>
      </SidebarGroupLabel>
      <CollapsibleContent>
        <SidebarGroupContent
          class="transition-colors"
          :class="{
            'bg-sidebar-accent/50 ring-sidebar-ring ring-2': isRootDragOver,
          }"
          @dragenter="handleRootDragEnter"
          @dragover="handleRootDragOver"
          @dragleave="handleRootDragLeave"
          @drop="handleRootDrop"
        >
          <SidebarMenu class="select-none">
            <TreeNode
              v-for="childId in rootChildren"
              :key="childId"
              :scope="props.scope"
              :team-id="props.teamId"
              :workspace-id="props.workspaceId"
              :node-id="childId"
              @create-folder="openCreateDialog('folder', $event.id)"
              @create-file="openCreateDialog('file', $event.id)"
              @rename="openRenameDialog"
              @archive="openArchiveDialog([$event])"
              @unarchive="handleUnarchive([$event])"
              @delete="openDeleteDialog([$event])"
            />
          </SidebarMenu>
          <div v-if="rootLoading" class="text-muted-foreground p-2 text-xs">
            {{ t("states.loading") }}
          </div>
          <Empty v-else-if="rootChildren.length === 0" class="p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconFolderPlus />
              </EmptyMedia>
              <EmptyTitle>{{ t("fileTree.empty") }}</EmptyTitle>
            </EmptyHeader>
          </Empty>
          <div v-if="rootPagination.hasMore" class="p-2">
            <Button
              variant="ghost"
              class="w-full justify-start"
              :disabled="rootPagination.loadingMore"
              @click="loadMoreRoot"
            >
              <span v-if="rootPagination.loadingMore">
                {{ t("states.loading") }}
              </span>
              <span v-else>{{ t("fileTree.loadMore") }}</span>
            </Button>
          </div>
        </SidebarGroupContent>
      </CollapsibleContent>
    </Collapsible>
    <!-- Bulk actions for the ⌘/Shift selection, pinned in the page's -->
    <!-- sidebar footer (outside the scroll area) like the chat history -->
    <!-- sidebar; mirrors DataTable's selected-count chip. Only "none" -->
    <!-- mode (write/code pages, which own the target) ever multi-selects. -->
    <Teleport v-if="selectedNodes.length" defer to="#file-tree-footer">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="outline"
            class="data-[state=open]:bg-accent self-stretch border-dashed tabular-nums"
          >
            {{ t("fileTree.selectedCount", { count: selectedNodes.length }) }}
            <IconChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" class="min-w-48">
          <DropdownMenuItem
            v-if="bulkHasActive"
            :disabled="bulkBusy"
            @click="openArchiveDialog(bulkTargets)"
          >
            <IconArchive />
            {{ t("fileTree.bulkArchive") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="bulkHasArchived"
            :disabled="bulkBusy"
            @click="handleUnarchive(bulkTargets)"
          >
            <IconRefreshCcw />
            {{ t("fileTree.bulkUnarchive") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            :disabled="bulkBusy"
            @click="openDeleteDialog(bulkTargets)"
          >
            <IconTrash2 />
            {{ t("fileTree.bulkDelete") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="bulkBusy" @click="clearSelection">
            <IconX />
            {{ t("fileTree.bulkClear") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Teleport>
  </SidebarGroup>

  <Dialog
    :open="dialogs.create.open"
    @update:open="(value) => (dialogs.create.open = value)"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {{
            dialogs.create.type === "folder"
              ? t("fileTree.createFolder")
              : t("fileTree.createFile")
          }}
        </DialogTitle>
        <DialogDescription>{{ t("fileTree.createHint") }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="handleCreateSubmit">
        <Input
          id="node-name"
          v-model="createName"
          :placeholder="t('fileTree.untitledPlaceholder')"
          autocomplete="off"
        />
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">
              {{ t("actions.cancel") }}
              <Kbd>Esc</Kbd>
            </Button>
          </DialogClose>
          <Button
            type="submit"
            data-dialog-action
            :disabled="isCreating || !createName.trim()"
          >
            {{ isCreating ? t("states.creating") : t("actions.create") }}
            <Kbd> ↩ </Kbd>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog
    :open="dialogs.rename.open"
    @update:open="(value) => (dialogs.rename.open = value)"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t("fileTree.renameTitle") }}</DialogTitle>
        <DialogDescription>{{ t("fileTree.renameHint") }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="handleRenameSubmit">
        <Field>
          <FieldLabel for="rename-name">
            {{ t("labels.name") }}
          </FieldLabel>
          <Input
            id="rename-name"
            v-model="renameName"
            :placeholder="t('fileTree.untitledPlaceholder')"
            autocomplete="off"
          />
        </Field>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">
              {{ t("actions.cancel") }}
              <Kbd>Esc</Kbd>
            </Button>
          </DialogClose>
          <Button
            type="submit"
            data-dialog-action
            :disabled="isRenaming || !renameName.trim()"
          >
            {{ isRenaming ? t("states.saving") : t("actions.save") }}
            <Kbd> ↩ </Kbd>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <ConfirmAction
    v-model:open="dialogs.archive.open"
    :title="t('fileTree.archiveTitle')"
    :description="
      describeTargets(
        dialogs.archive.nodes,
        'fileTree.archiveConfirm',
        'fileTree.archiveManyConfirm'
      )
    "
    :action-label="t('fileTree.archive')"
    :on-confirm="handleArchiveConfirm"
  />

  <ConfirmAction
    v-model:open="dialogs.delete.open"
    :title="t('fileTree.deleteTitle')"
    :description="
      describeTargets(
        dialogs.delete.nodes,
        'fileTree.deleteConfirm',
        'fileTree.deleteManyConfirm'
      )
    "
    :action-label="t('actions.delete')"
    destructive
    :on-confirm="handleDeleteConfirm"
  />
</template>

<script lang="ts" setup>
import {
  provideSidebarContext,
  useSidebar,
} from "@/components/ui/sidebar/utils"
import {
  provideFileTreeSelection,
  type FileTreeSelectionMode,
} from "@/composables/useFileTreeSelection"
import { IconChevronRight, IconFilePlus, IconFolderPlus } from "@/data/icons"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import {
  ROOT_PARENT_ID,
  type WorkspaceNode,
  type WorkspaceNodeScope,
} from "@/types/nodes"
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue"
import TreeNode from "./TreeNode.vue"

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

const selectedIds = computed<Set<string>>(() => {
  if (selectionMode.value === "multiple") {
    return new Set(Array.isArray(props.selection) ? props.selection : [])
  }
  if (selectionMode.value === "single") {
    const id = typeof props.selection === "string" ? props.selection : null
    return new Set(id ? [id] : [])
  }
  // "none": follow the store so URL-driven selection still highlights.
  const storeId = store.getSelectedNodeId(
    props.scope,
    props.teamId,
    props.workspaceId
  )
  return new Set(storeId ? [storeId] : [])
})

provideFileTreeSelection({
  mode: selectionMode,
  isSelected: (id: string) => selectedIds.value.has(id),
  onRowClick: (node: WorkspaceNode) => {
    if (selectionMode.value === "none") {
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
    node: null as WorkspaceNode | null,
  },
  delete: {
    open: false,
    node: null as WorkspaceNode | null,
  },
})

const createName = ref("")
const isCreating = ref(false)
const renameName = ref("")
const isRenaming = ref(false)
const isArchiving = ref(false)
const isDeleting = ref(false)

const openCreateDialog = (type: "folder" | "file", parentId: string) => {
  dialogs.create.type = type
  dialogs.create.parentId = parentId
  dialogs.create.open = true
}

const openRenameDialog = (node: WorkspaceNode) => {
  dialogs.rename.node = node
  dialogs.rename.open = true
}

const openArchiveDialog = (node: WorkspaceNode) => {
  dialogs.archive.node = node
  dialogs.archive.open = true
}

const openDeleteDialog = (node: WorkspaceNode) => {
  dialogs.delete.node = node
  dialogs.delete.open = true
}

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

const handleUnarchive = async (node: WorkspaceNode) => {
  try {
    await store.unarchiveNodeAction(
      props.scope,
      props.teamId,
      props.workspaceId,
      node.id
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
  if (!dialogs.archive.node) return

  isArchiving.value = true
  try {
    await store.archiveNodeAction(
      props.scope,
      props.teamId,
      props.workspaceId,
      dialogs.archive.node.id
    )
    showSuccessToast(t("fileTree.toast.archived"))
    dialogs.archive.open = false
  } catch (error) {
    showErrorToast(t("fileTree.toast.archiveFailed"), (error as Error).message)
  } finally {
    isArchiving.value = false
  }
}

const handleDeleteConfirm = async () => {
  if (!dialogs.delete.node) return

  isDeleting.value = true
  try {
    await store.deleteNodeAction(
      props.scope,
      props.teamId,
      props.workspaceId,
      dialogs.delete.node.id
    )
    showSuccessToast(t("fileTree.toast.deleted"))
    dialogs.delete.open = false
  } catch (error) {
    showErrorToast(t("fileTree.toast.deleteFailed"), (error as Error).message)
  } finally {
    isDeleting.value = false
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
    <Collapsible default-open class="group/collapsible">
      <SidebarGroupLabel as-child>
        <CollapsibleTrigger class="w-full">
          {{ t("fileTree.documents") }}
          <IconChevronRight
            class="mr-auto ml-1 size-3! transition-transform group-data-[state=open]/collapsible:rotate-90"
          />
          <TooltipProvider>
            <ButtonGroup>
              <ButtonGroup>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton
                      size="icon-xs"
                      @click.stop="openCreateDialog('folder', ROOT_PARENT_ID)"
                    >
                      <IconFolderPlus />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>{{ t("fileTree.newFolder") }}</TooltipContent>
                </Tooltip>
              </ButtonGroup>
              <ButtonGroup>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <InputGroupButton
                      size="icon-xs"
                      @click.stop="openCreateDialog('file', ROOT_PARENT_ID)"
                    >
                      <IconFilePlus />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>{{ t("fileTree.newFile") }}</TooltipContent>
                </Tooltip>
              </ButtonGroup>
            </ButtonGroup>
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
          <SidebarMenu>
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
              @archive="openArchiveDialog"
              @unarchive="handleUnarchive"
              @delete="openDeleteDialog"
            />
          </SidebarMenu>
          <div v-if="rootLoading" class="text-muted-foreground p-2 text-xs">
            {{ t("states.loading") }}
          </div>
          <div
            v-else-if="rootChildren.length === 0"
            class="text-muted-foreground p-2 text-xs"
          >
            {{ t("fileTree.empty") }}
          </div>
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
      <form class="space-y-4" @submit.prevent="handleCreateSubmit">
        <div class="space-y-2">
          <Input
            id="node-name"
            v-model="createName"
            :placeholder="t('fileTree.untitledPlaceholder')"
            autocomplete="off"
          />
        </div>
        <DialogFooter>
          <Button @click="dialogs.create.open = false">
            {{ t("actions.cancel") }}
          </Button>
          <Button type="submit" :disabled="isCreating || !createName.trim()">
            {{ isCreating ? t("states.creating") : t("actions.create") }}
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
      <form class="space-y-4" @submit.prevent="handleRenameSubmit">
        <div class="grid gap-2">
          <Label class="text-secondary-foreground text-xs" for="rename-name">
            {{ t("labels.name") }}
          </Label>
          <Input
            id="rename-name"
            v-model="renameName"
            :placeholder="t('fileTree.untitledPlaceholder')"
            autocomplete="off"
          />
        </div>
        <DialogFooter>
          <Button @click="dialogs.rename.open = false">
            {{ t("actions.cancel") }}
          </Button>
          <Button type="submit" :disabled="isRenaming || !renameName.trim()">
            {{ isRenaming ? t("states.saving") : t("actions.save") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <AlertDialog
    :open="dialogs.archive.open"
    @update:open="(value) => (dialogs.archive.open = value)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("fileTree.archiveTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("fileTree.archiveConfirm", {
              name: dialogs.archive.node?.name ?? "",
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="dialogs.archive.open = false">
          {{ t("actions.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction as-child>
          <Button
            variant="destructive"
            class="text-current"
            :disabled="isArchiving"
            @click="handleArchiveConfirm"
          >
            {{ isArchiving ? t("states.archiving") : t("fileTree.archive") }}
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <AlertDialog
    :open="dialogs.delete.open"
    @update:open="(value) => (dialogs.delete.open = value)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("fileTree.deleteTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("fileTree.deleteConfirm", {
              name: dialogs.delete.node?.name ?? "",
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="dialogs.delete.open = false">
          {{ t("actions.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction as-child>
          <Button
            variant="destructive"
            class="text-current"
            :disabled="isDeleting"
            @click="handleDeleteConfirm"
          >
            {{ isDeleting ? t("states.deleting") : t("actions.delete") }}
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

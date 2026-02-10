<script lang="ts" setup>
import { IconChevronRight, IconFilePlus, IconFolderPlus } from "@/data/icons"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import {
  ROOT_PARENT_ID,
  type WorkspaceNode,
  type WorkspaceNodeScope,
} from "@/types"
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue"
import TreeNode from "./TreeNode.vue"

const props = defineProps<{
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
}>()

const store = useFileTreeStore()

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
    showSuccessToast("Unarchived")
  } catch (error) {
    showErrorToast("Failed to unarchive", (error as Error).message)
  }
}

const handleCreated = (nodeId: string) => {
  if (dialogs.create.type === "file") {
    store.setSelectedNode(props.scope, props.teamId, props.workspaceId, nodeId)
  }
  if (dialogs.create.parentId !== ROOT_PARENT_ID) {
    store.expandFolder(
      props.scope,
      props.teamId,
      props.workspaceId,
      dialogs.create.parentId
    )
  }
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
      dialogs.create.type === "folder" ? "Folder created" : "File created"
    )
    handleCreated(nodeId)
    dialogs.create.open = false
  } catch (error) {
    showErrorToast("Failed to create", (error as Error).message)
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
    showSuccessToast("Renamed")
    dialogs.rename.open = false
  } catch (error) {
    showErrorToast("Failed to rename", (error as Error).message)
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
    showSuccessToast("Moved")
  } catch (error) {
    showErrorToast("Failed to move", (error as Error).message)
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
    showSuccessToast("Archived")
    dialogs.archive.open = false
  } catch (error) {
    showErrorToast("Failed to archive", (error as Error).message)
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
    showSuccessToast("Deleted")
    dialogs.delete.open = false
  } catch (error) {
    showErrorToast("Failed to delete", (error as Error).message)
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
  () => [props.teamId, props.workspaceId],
  ([teamId, workspaceId], previous) => {
    const [prevTeamId, prevWorkspaceId] = previous ?? []
    if (prevTeamId && prevWorkspaceId) {
      store.cleanupWorkspace(props.scope, prevTeamId, prevWorkspaceId)
    }
    if (teamId && workspaceId) {
      store.ensureRootSubscribed(props.scope, teamId, workspaceId)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  store.cleanupWorkspace(props.scope, props.teamId, props.workspaceId)
})
</script>

<template>
  <SidebarGroup>
    <Collapsible default-open class="group/collapsible">
      <SidebarGroupLabel as-child>
        <CollapsibleTrigger class="w-full">
          Documents
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
                  <TooltipContent> New folder </TooltipContent>
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
                  <TooltipContent> New file </TooltipContent>
                </Tooltip>
              </ButtonGroup>
            </ButtonGroup>
          </TooltipProvider>
        </CollapsibleTrigger>
      </SidebarGroupLabel>
      <CollapsibleContent>
        <SidebarGroupContent
          class="rounded-md transition-colors"
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
            Loading...
          </div>
          <div
            v-else-if="rootChildren.length === 0"
            class="text-muted-foreground p-2 text-xs"
          >
            No files yet.
          </div>
          <div v-if="rootPagination.hasMore" class="p-2">
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start"
              :disabled="rootPagination.loadingMore"
              @click="loadMoreRoot"
            >
              <span v-if="rootPagination.loadingMore">Loading...</span>
              <span v-else>Load more</span>
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
            dialogs.create.type === "folder" ? "Create Folder" : "Create File"
          }}
        </DialogTitle>
        <DialogDescription> Choose a name for your item. </DialogDescription>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="handleCreateSubmit">
        <div class="space-y-2">
          <Input
            id="node-name"
            v-model="createName"
            placeholder="Untitled"
            autocomplete="off"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            @click="dialogs.create.open = false"
          >
            Cancel
          </Button>
          <Button type="submit" :disabled="isCreating || !createName.trim()">
            {{ isCreating ? "Creating..." : "Create" }}
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
        <DialogTitle>Rename</DialogTitle>
        <DialogDescription>Update the name of this item.</DialogDescription>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="handleRenameSubmit">
        <div class="grid gap-2">
          <Label class="text-secondary-foreground text-xs" for="rename-name">
            Name
          </Label>
          <Input
            id="rename-name"
            v-model="renameName"
            placeholder="Untitled"
            autocomplete="off"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            @click="dialogs.rename.open = false"
          >
            Cancel
          </Button>
          <Button type="submit" :disabled="isRenaming || !renameName.trim()">
            {{ isRenaming ? "Saving..." : "Save" }}
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
        <AlertDialogTitle>Archive</AlertDialogTitle>
        <AlertDialogDescription>
          This will archive
          <span class="font-medium">
            {{ dialogs.archive.node?.name }}
          </span>
          . You can unarchive it later.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="dialogs.archive.open = false">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction as-child>
          <Button
            variant="destructive"
            :disabled="isArchiving"
            @click="handleArchiveConfirm"
          >
            {{ isArchiving ? "Archiving..." : "Archive" }}
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
        <AlertDialogTitle>Delete</AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently delete
          <span class="font-medium">
            {{ dialogs.delete.node?.name }}
          </span>
          . This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="dialogs.delete.open = false">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction as-child>
          <Button
            variant="destructive"
            :disabled="isDeleting"
            @click="handleDeleteConfirm"
          >
            {{ isDeleting ? "Deleting..." : "Delete" }}
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

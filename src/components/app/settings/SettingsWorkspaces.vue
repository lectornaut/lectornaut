<script lang="ts" setup>
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowUpDown,
  IconCheck,
  IconMoreHorizontal,
  IconPencil,
  IconPlus,
  IconSwitchHorizontal,
  IconTrash,
  IconX,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import type { IWorkspace } from "@/types/domain"
import { DateFormatter } from "@internationalized/date"

const df = new DateFormatter("en-US", {
  dateStyle: "medium",
})

// Use workspace actions composable - all logic is now self-contained
const {
  currentWorkspace,
  workspaces,
  isLoading,
  canManageWorkspaces,
  loading: workspaceLoading,
  switchWorkspace,
  deleteWorkspace,
  updateWorkspacePhoto,
  removeWorkspacePhoto,
} = useWorkspaceActions()

// Workspace Dialog State
const isWorkspaceDialogOpen = ref(false)
const workspaceDialogMode = ref<"create" | "edit">("create")
const workspaceDialogWorkspace = ref<IWorkspace | undefined>(undefined)

const openWorkspaceDialog = (
  mode: "create" | "edit",
  workspace?: IWorkspace
) => {
  workspaceDialogMode.value = mode
  workspaceDialogWorkspace.value = workspace
  isWorkspaceDialogOpen.value = true
}

// Confirmation dialog
const deleteWorkspaceDialog = useConfirmationDialog<IWorkspace>()

const handleDeleteWorkspace = () =>
  deleteWorkspaceDialog.confirm((ws) => deleteWorkspace(ws.id))

// Photo upload
const workspacePhotoUpload = usePhotoUpload({
  onUpload: updateWorkspacePhoto,
  canUpload: () => canManageWorkspaces.value,
})

const handleWorkspaceAvatarClick = (workspace: IWorkspace) => {
  workspacePhotoUpload.triggerUpload(workspace.id)
}

// Sorting state
type SortDirection = "asc" | "desc" | null
type WorkspaceSortKey = "name" | "created"

const workspaceSortKey = ref<WorkspaceSortKey | null>(null)
const workspaceSortDirection = ref<SortDirection>(null)

const toggleWorkspaceSort = (key: WorkspaceSortKey) => {
  if (workspaceSortKey.value === key) {
    if (workspaceSortDirection.value === "asc") {
      workspaceSortDirection.value = "desc"
    } else if (workspaceSortDirection.value === "desc") {
      workspaceSortKey.value = null
      workspaceSortDirection.value = null
    } else {
      workspaceSortDirection.value = "asc"
    }
  } else {
    workspaceSortKey.value = key
    workspaceSortDirection.value = "asc"
  }
}

const sortedWorkspaces = computed(() => {
  if (!workspaceSortKey.value || !workspaceSortDirection.value) {
    return workspaces.value
  }

  const sorted = [...workspaces.value]
  const direction = workspaceSortDirection.value === "asc" ? 1 : -1

  sorted.sort((a, b) => {
    if (workspaceSortKey.value === "name") {
      const nameA = (a.name || "").toLowerCase()
      const nameB = (b.name || "").toLowerCase()
      return nameA.localeCompare(nameB) * direction
    } else if (workspaceSortKey.value === "created") {
      const dateA = a.createdAt?.toDate?.()?.getTime() || 0
      const dateB = b.createdAt?.toDate?.()?.getTime() || 0
      return (dateA - dateB) * direction
    }
    return 0
  })

  return sorted
})
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Workspaces</FieldLabel>
            <FieldDescription>
              Manage workspaces in your current team.
            </FieldDescription>
          </FieldContent>
          <Button
            v-if="canManageWorkspaces"
            @click="openWorkspaceDialog('create')"
          >
            <IconPlus />
            Create Workspace
          </Button>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <div v-if="isLoading" class="flex justify-center py-8">
              <Spinner />
            </div>
            <div v-else class="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-1/4">
                      <Button
                        variant="ghost"
                        size="sm"
                        @click="toggleWorkspaceSort('name')"
                      >
                        Name
                        <IconArrowUp
                          v-if="
                            workspaceSortKey === 'name' &&
                            workspaceSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            workspaceSortKey === 'name' &&
                            workspaceSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/4">Description</TableHead>
                    <TableHead class="w-1/4">
                      <Button
                        variant="ghost"
                        size="sm"
                        @click="toggleWorkspaceSort('created')"
                      >
                        Created
                        <IconArrowUp
                          v-if="
                            workspaceSortKey === 'created' &&
                            workspaceSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            workspaceSortKey === 'created' &&
                            workspaceSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/4 text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="workspace in sortedWorkspaces"
                    :key="workspace.id"
                  >
                    <TableCell>
                      <Item size="sm" class="group w-full gap-2 p-0">
                        <ItemMedia class="group relative">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <Avatar
                                  class="flex items-center justify-center rounded-md"
                                  @click="handleWorkspaceAvatarClick(workspace)"
                                >
                                  <template
                                    v-if="
                                      workspaceLoading.isLoading(
                                        `photo-${workspace.id}`
                                      )
                                    "
                                  >
                                    <Spinner />
                                  </template>
                                  <template v-else>
                                    <AvatarImage
                                      class="rounded-md"
                                      :src="workspace.photoURL!"
                                      :alt="workspace.name"
                                    />
                                    <AvatarFallback class="rounded-md">
                                      {{ getInitials(workspace.name) }}
                                    </AvatarFallback>
                                  </template>
                                </Avatar>
                              </TooltipTrigger>
                              <TooltipContent v-if="canManageWorkspaces">
                                {{
                                  workspaceLoading.isLoading(
                                    `photo-${workspace.id}`
                                  )
                                    ? "Uploading..."
                                    : "Upload workspace photo"
                                }}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip
                              v-if="canManageWorkspaces && workspace.photoURL"
                            >
                              <TooltipTrigger as-child>
                                <Button
                                  variant="secondary"
                                  class="ring-background absolute -top-2 -right-2 size-5 rounded-full opacity-0 ring-2 transition group-hover:opacity-100"
                                  size="icon-sm"
                                  @click.stop="
                                    removeWorkspacePhoto(workspace.id)
                                  "
                                >
                                  <IconX />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent
                                >Remove workspace photo</TooltipContent
                              >
                            </Tooltip>
                          </TooltipProvider>
                        </ItemMedia>
                        <ItemContent class="gap-0.5 truncate">
                          <ItemTitle class="truncate">
                            {{ workspace.name }}
                          </ItemTitle>
                          <ItemDescription class="truncate text-xs">
                            {{ workspace.description || "No description" }}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    </TableCell>
                    <TableCell class="truncate">
                      {{ workspace.description || "No description" }}
                    </TableCell>
                    <TableCell>
                      {{ df.format(workspace.createdAt.toDate()) }}
                    </TableCell>
                    <TableCell class="flex items-center justify-end text-right">
                      <ButtonGroup>
                        <ButtonGroup>
                          <Button
                            v-if="currentWorkspace?.id !== workspace.id"
                            variant="outline"
                            :disabled="workspaceLoading.isLoading(workspace.id)"
                            @click="switchWorkspace(workspace.id)"
                          >
                            <Spinner
                              v-if="workspaceLoading.isLoading(workspace.id)"
                            />
                            <template v-else>
                              <IconSwitchHorizontal />
                              Switch
                            </template>
                          </Button>
                          <Button v-else variant="outline" disabled>
                            <IconCheck />
                            Current
                          </Button>
                        </ButtonGroup>
                        <ButtonGroup v-if="canManageWorkspaces">
                          <DropdownMenu>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <DropdownMenuTrigger as-child>
                                    <Button variant="outline" size="icon">
                                      <IconMoreHorizontal />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      @click="
                                        openWorkspaceDialog('edit', workspace)
                                      "
                                    >
                                      <IconPencil />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      @click="
                                        deleteWorkspaceDialog.open(workspace)
                                      "
                                    >
                                      <IconTrash />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </TooltipTrigger>
                                <TooltipContent>Actions</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </DropdownMenu>
                        </ButtonGroup>
                      </ButtonGroup>
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="workspaces.length === 0">
                    <TableCell
                      colspan="4"
                      class="text-muted-foreground h-24 text-center"
                    >
                      No workspaces found.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </FieldContent>
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>

  <!-- Delete Workspace Dialog -->
  <AlertDialog v-model:open="deleteWorkspaceDialog.isOpen.value">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete Workspace</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete
          <span class="text-foreground font-medium">{{
            deleteWorkspaceDialog.item.value?.name
          }}</span
          >? This action cannot be undone and will permanently delete the
          workspace and all its content.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          :disabled="
            deleteWorkspaceDialog.item.value &&
            workspaceLoading.isLoading(
              `delete-${deleteWorkspaceDialog.item.value.id}`
            )
          "
          @click.prevent="handleDeleteWorkspace"
        >
          <Spinner
            v-if="
              deleteWorkspaceDialog.item.value &&
              workspaceLoading.isLoading(
                `delete-${deleteWorkspaceDialog.item.value.id}`
              )
            "
          />
          Delete Workspace
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Workspace Create/Edit Dialog -->
  <WorkspaceDialog
    v-model:open="isWorkspaceDialogOpen"
    :mode="workspaceDialogMode"
    :workspace="workspaceDialogWorkspace"
  />
</template>

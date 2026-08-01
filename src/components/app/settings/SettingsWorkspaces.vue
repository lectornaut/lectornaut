<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowUpDown,
  IconCheck,
  IconLayoutGrid,
  IconMoreHorizontal,
  IconPencil,
  IconPlus,
  IconSwitchHorizontal,
  IconTrash,
  IconX,
} from "@/data/icons"
import type { IWorkspace } from "@/types/domain"

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

// Use workspace actions composable - all logic is now self-contained
const {
  currentWorkspace,
  workspaces,
  isLoading,
  canCreateWorkspace,
  canUpdateWorkspace,
  canDeleteWorkspace,
  getCannotCreateWorkspaceReason,
  getCannotUpdateWorkspaceReason,
  getCannotDeleteWorkspaceReason,
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

// Photo upload. The per-workspace edit gate needs the row's id, but
// `usePhotoUpload`'s `canUpload` callback takes no argument — so stash the id
// of the workspace whose avatar was clicked and gate against that.
const pendingPhotoWorkspaceId = ref<string | null>(null)
const workspacePhotoUpload = usePhotoUpload({
  onUpload: updateWorkspacePhoto,
  canUpload: () => canUpdateWorkspace(pendingPhotoWorkspaceId.value),
})

const handleWorkspaceAvatarClick = (workspace: IWorkspace) => {
  if (!canUpdateWorkspace(workspace.id)) return
  pendingPhotoWorkspaceId.value = workspace.id
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

const formatCreatedAt = (value: IWorkspace["createdAt"] | null | undefined) => {
  const date = value?.toDate?.()
  return date ? useDateFormat(date, "MMM D, YYYY").value : "—"
}
</script>

<template>
  <div v-if="canViewTeamSettings" class="p-6">
    <FieldGroup>
      <!-- min-w-0 (here and on the table's FieldContent) beats the fieldset
         UA `min-inline-size: min-content` floor so the Table shrinks with
         the dialog and scrolls inside its own overflow-x-auto container
         (same recipe as SettingsConnections' Manage tab). -->
      <FieldSet class="min-w-0">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.workspacesList.label") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.workspacesList.description") }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Button
                    :disabled="!canCreateWorkspace"
                    @click="openWorkspaceDialog('create')"
                  >
                    <IconPlus />
                    {{ t("settings.workspacesList.createWorkspace") }}
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canCreateWorkspace">
                {{ getCannotCreateWorkspaceReason }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>
        <Field orientation="horizontal">
          <FieldContent class="min-w-0">
            <LoadingState v-if="isLoading" />
            <div v-else class="overflow-clip rounded-4xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-1/4">
                      <Button
                        variant="ghost"
                        @click="toggleWorkspaceSort('name')"
                      >
                        {{ t("settings.workspacesList.columnName") }}
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
                    <TableHead class="w-1/4">{{
                      t("settings.workspacesList.columnDescription")
                    }}</TableHead>
                    <TableHead class="w-1/4">
                      <Button
                        variant="ghost"
                        @click="toggleWorkspaceSort('created')"
                      >
                        {{ t("settings.workspacesList.columnCreated") }}
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
                    <!-- whitespace-normal resets TableCell's default nowrap so
                       the Item's line-clamp can wrap-and-ellipsize instead of
                       one long line setting the table's min-content width. -->
                    <TableCell class="whitespace-normal">
                      <Item class="group p-0" size="xs">
                        <ItemMedia class="group relative">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <AppAvatar
                                  :class="{
                                    'cursor-pointer': canUpdateWorkspace(
                                      workspace.id
                                    ),
                                    'cursor-not-allowed opacity-60':
                                      !canUpdateWorkspace(workspace.id),
                                  }"
                                  :loading="
                                    workspaceLoading.isLoading(
                                      `photo-${workspace.id}`
                                    )
                                  "
                                  :src="workspace.photoURL"
                                  :name="workspace.name"
                                  @click="handleWorkspaceAvatarClick(workspace)"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {{
                                  !canUpdateWorkspace(workspace.id)
                                    ? getCannotUpdateWorkspaceReason(
                                        workspace.id
                                      )
                                    : workspaceLoading.isLoading(
                                          `photo-${workspace.id}`
                                        )
                                      ? t(
                                          "settings.overview.teamPhoto.uploading"
                                        )
                                      : t("settings.workspacesList.uploadPhoto")
                                }}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip v-if="workspace.photoURL">
                              <TooltipTrigger as-child>
                                <Button
                                  variant="secondary"
                                  class="ring-background absolute -top-2 -right-2 size-4 opacity-0! ring-2 transition group-hover:enabled:opacity-100!"
                                  size="icon"
                                  :disabled="!canUpdateWorkspace(workspace.id)"
                                  @click.stop="
                                    removeWorkspacePhoto(workspace.id)
                                  "
                                >
                                  <IconX />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{
                                  !canUpdateWorkspace(workspace.id)
                                    ? getCannotUpdateWorkspaceReason(
                                        workspace.id
                                      )
                                    : t("settings.workspacesList.removePhoto")
                                }}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>
                            {{ workspace.name }}
                          </ItemTitle>
                          <ItemDescription class="text-xs">
                            {{
                              workspace.description ||
                              t("settings.workspacesList.noDescription")
                            }}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    </TableCell>
                    <TableCell class="whitespace-normal">
                      <span class="line-clamp-2">
                        {{
                          workspace.description ||
                          t("settings.workspacesList.noDescription")
                        }}
                      </span>
                    </TableCell>
                    <TableCell>
                      {{ formatCreatedAt(workspace.createdAt) }}
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
                              {{ t("actions.switch") }}
                            </template>
                          </Button>
                          <Button v-else variant="outline" disabled>
                            <IconCheck />
                            {{ t("settings.workspacesList.current") }}
                          </Button>
                        </ButtonGroup>
                        <ButtonGroup>
                          <DropdownMenu>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <DropdownMenuTrigger as-child>
                                    <Button variant="outline" size="icon">
                                      <IconMoreHorizontal />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent>
                                    <Tooltip>
                                      <TooltipTrigger as-child>
                                        <div>
                                          <DropdownMenuItem
                                            :disabled="
                                              !canUpdateWorkspace(workspace.id)
                                            "
                                            data-hotkey="e"
                                            @click="
                                              openWorkspaceDialog(
                                                'edit',
                                                workspace
                                              )
                                            "
                                          >
                                            <IconPencil />
                                            {{ t("actions.edit") }}
                                            <DropdownMenuShortcut>
                                              E
                                            </DropdownMenuShortcut>
                                          </DropdownMenuItem>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        v-if="!canUpdateWorkspace(workspace.id)"
                                      >
                                        {{
                                          getCannotUpdateWorkspaceReason(
                                            workspace.id
                                          )
                                        }}
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger as-child>
                                        <div>
                                          <DropdownMenuItem
                                            :disabled="
                                              !canDeleteWorkspace(workspace.id)
                                            "
                                            data-hotkey="backspace delete"
                                            @click="
                                              deleteWorkspaceDialog.open(
                                                workspace
                                              )
                                            "
                                          >
                                            <IconTrash />
                                            {{ t("actions.delete") }}
                                            <DropdownMenuShortcut>
                                              ⌫
                                            </DropdownMenuShortcut>
                                          </DropdownMenuItem>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        v-if="!canDeleteWorkspace(workspace.id)"
                                      >
                                        {{
                                          getCannotDeleteWorkspaceReason(
                                            workspace.id
                                          )
                                        }}
                                      </TooltipContent>
                                    </Tooltip>
                                  </DropdownMenuContent>
                                </TooltipTrigger>
                                <TooltipContent>{{
                                  t("settings.workspacesList.actionsTooltip")
                                }}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </DropdownMenu>
                        </ButtonGroup>
                      </ButtonGroup>
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="workspaces.length === 0">
                    <TableCell colspan="4">
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <IconLayoutGrid />
                          </EmptyMedia>
                          <EmptyTitle>
                            {{ t("settings.workspacesList.noWorkspaces") }}
                          </EmptyTitle>
                        </EmptyHeader>
                      </Empty>
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
  <SettingsRestricted v-else />

  <!-- Delete Workspace Dialog -->
  <AlertDialog v-model:open="deleteWorkspaceDialog.isOpen.value">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          t("settings.workspacesList.deleteTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          <i18n-t keypath="settings.workspacesList.deleteConfirm" tag="span">
            <template #name>
              <span class="text-foreground font-medium">{{
                deleteWorkspaceDialog.item.value?.name
              }}</span>
            </template>
          </i18n-t>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel
          >{{ t("actions.cancel") }}<Kbd>Esc</Kbd>
        </AlertDialogCancel>
        <AlertDialogAction
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
          {{ t("settings.workspacesList.deleteTitle") }}
          <Kbd>↩</Kbd>
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

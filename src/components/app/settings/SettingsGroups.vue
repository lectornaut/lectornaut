<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import { withToast } from "@/helpers/toast"
import { IconPencil, IconPlus, IconTrash, IconUsers2 } from "@/data/icons"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamGroupsStore } from "@/stores/teamGroupsStore"
import type { IGroup } from "@/types/domain"
import { isUserMembership, type IMembership } from "@/types/membership"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()

const membershipStore = useMembershipStore()
const { teamMembers, canManageMembers } = storeToRefs(membershipStore)

const groupsStore = useTeamGroupsStore()
const { groups, isLoading, usageForGroup } = storeToRefs(groupsStore)

// Resolve a group's member uids to their member rows (for avatars). Only humans
// can be in a group; a stale id (a member who left) simply resolves to nothing.
const humanMemberById = computed(
  () =>
    new Map<string, IMembership>(
      teamMembers.value.filter(isUserMembership).map((m) => [m.userId, m])
    )
)

const AVATAR_LIMIT = 4
const groupMembers = (group: IGroup): IMembership[] =>
  group.memberIds
    .map((id) => humanMemberById.value.get(id))
    .filter((m): m is IMembership => Boolean(m))

const memberLabel = (member: IMembership) =>
  member.user?.displayName || member.user?.email || member.userId

// ── Dialog state ──────────────────────────────────────────────────────────────
const isDialogOpen = ref(false)
const dialogMode = ref<"create" | "edit">("create")
const editingGroup = ref<IGroup | undefined>(undefined)

const openCreate = () => {
  dialogMode.value = "create"
  editingGroup.value = undefined
  isDialogOpen.value = true
}

const openEdit = (group: IGroup) => {
  dialogMode.value = "edit"
  editingGroup.value = group
  isDialogOpen.value = true
}

// ── Photo upload/remove (immediate, straight from the table) ────────────────
// One busy set for BOTH upload and remove drives the avatar spinner, same as
// the `photo-${id}` loading key Teams/Workspaces share across both actions.
const photoBusyIds = ref<Set<string>>(new Set())
const isPhotoBusy = (id: string) => photoBusyIds.value.has(id)

const runPhotoChange = async (
  id: string,
  photoFile: File | null,
  messages: Parameters<typeof withToast>[1]
) => {
  photoBusyIds.value = new Set(photoBusyIds.value).add(id)
  try {
    await withToast(() => groupsStore.updateGroup(id, { photoFile }), messages)
  } catch (error) {
    console.error("[SettingsGroups] Failed to change group photo", error)
  } finally {
    const next = new Set(photoBusyIds.value)
    next.delete(id)
    photoBusyIds.value = next
  }
}

const groupPhotoUpload = usePhotoUpload({
  canUpload: () => canManageMembers.value,
  onUpload: (id, file) =>
    runPhotoChange(id, file, {
      info: t("settings.groups.photoUploading"),
      success: t("settings.groups.photoUpdated"),
      error: t("settings.groups.photoUpdateError"),
    }),
})

const handleGroupAvatarClick = (group: IGroup) => {
  if (!canManageMembers.value) return
  groupPhotoUpload.triggerUpload(group.id)
}

const removeGroupPhoto = (group: IGroup) =>
  runPhotoChange(group.id, null, {
    success: t("settings.groups.photoRemoved"),
    error: t("settings.groups.photoRemoveError"),
  })

// ── Delete ──────────────────────────────────────────────────────────────────
const deleteGroupDialog = useConfirmationDialog<IGroup>()

// Toasts its own failure and returns false so the confirm stays open.
const handleDelete = async () => {
  try {
    await deleteGroupDialog.confirm((group) =>
      groupsStore.deleteGroup(group.id)
    )
  } catch (error) {
    console.error("[SettingsGroups] Failed to delete group", error)
    toast.error(t("settings.groups.deleteError"))
    return false
  }
}

// ── Sorting (three-state cycle: asc → desc → off, mirrors the sibling tables) ──
// "off" falls back to the store's natural order, which is already name-ascending.
type SortDirection = "asc" | "desc" | null
type GroupSortKey = "name" | "members" | "usedIn" | "created"

const groupSortKey = ref<GroupSortKey | null>(null)
const groupSortDirection = ref<SortDirection>(null)

const toggleGroupSort = (key: GroupSortKey) => {
  if (groupSortKey.value === key) {
    if (groupSortDirection.value === "asc") {
      groupSortDirection.value = "desc"
    } else if (groupSortDirection.value === "desc") {
      groupSortKey.value = null
      groupSortDirection.value = null
    } else {
      groupSortDirection.value = "asc"
    }
  } else {
    groupSortKey.value = key
    groupSortDirection.value = "asc"
  }
}

const sortedGroups = computed(() => {
  if (!groupSortKey.value || !groupSortDirection.value) {
    return groups.value
  }

  const sorted = [...groups.value]
  const direction = groupSortDirection.value === "asc" ? 1 : -1

  sorted.sort((a, b) => {
    if (groupSortKey.value === "name") {
      return a.name.localeCompare(b.name) * direction
    } else if (groupSortKey.value === "members") {
      return (a.memberIds.length - b.memberIds.length) * direction
    } else if (groupSortKey.value === "usedIn") {
      return (usageForGroup.value(a.id) - usageForGroup.value(b.id)) * direction
    } else if (groupSortKey.value === "created") {
      const dateA = a.createdAt?.toDate?.()?.getTime() || 0
      const dateB = b.createdAt?.toDate?.()?.getTime() || 0
      return (dateA - dateB) * direction
    }
    return 0
  })

  return sorted
})

const formatCreatedAt = (value: IGroup["createdAt"] | null | undefined) => {
  const date = value?.toDate?.()
  return date ? useDateFormat(date, "MMM D, YYYY").value : "—"
}

onMounted(() => {
  if (canManageMembers.value) void groupsStore.refreshUsage()
})
</script>

<template>
  <div v-if="canManageMembers" class="p-6">
    <FieldGroup>
      <!-- min-w-0 (here and on the table's FieldContent) beats the fieldset
         UA `min-inline-size: min-content` floor so the Table shrinks with
         the dialog and scrolls inside its own overflow-x-auto container
         (same recipe as SettingsConnections' Manage tab). -->
      <FieldSet class="min-w-0">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.groups.title") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.groups.description") }}
            </FieldDescription>
          </FieldContent>
          <Button @click="openCreate">
            <IconPlus />
            {{ t("settings.groups.createGroup") }}
          </Button>
        </Field>
        <Field orientation="horizontal">
          <FieldContent class="min-w-0">
            <LoadingState v-if="isLoading" />
            <div
              v-else
              data-table-frame
              class="rounded-surface overflow-clip border"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="min-w-64">
                      <DataTableSortButton
                        :direction="
                          groupSortKey === 'name' ? groupSortDirection : null
                        "
                        @click="toggleGroupSort('name')"
                      >
                        {{ t("settings.groups.name") }}
                      </DataTableSortButton>
                    </TableHead>
                    <TableHead class="w-1/4">
                      <DataTableSortButton
                        :direction="
                          groupSortKey === 'members' ? groupSortDirection : null
                        "
                        @click="toggleGroupSort('members')"
                      >
                        {{ t("settings.groups.members") }}
                      </DataTableSortButton>
                    </TableHead>
                    <TableHead class="w-1/6">
                      <DataTableSortButton
                        :direction="
                          groupSortKey === 'usedIn' ? groupSortDirection : null
                        "
                        @click="toggleGroupSort('usedIn')"
                      >
                        {{ t("settings.groups.usedIn") }}
                      </DataTableSortButton>
                    </TableHead>
                    <TableHead class="w-1/6">
                      <DataTableSortButton
                        :direction="
                          groupSortKey === 'created' ? groupSortDirection : null
                        "
                        @click="toggleGroupSort('created')"
                      >
                        {{ t("settings.groups.created") }}
                      </DataTableSortButton>
                    </TableHead>
                    <TableHead
                      data-pinned="end"
                      class="w-px text-right"
                    ></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="group in sortedGroups" :key="group.id">
                    <!-- whitespace-normal resets TableCell's default nowrap so
                       the Item's line-clamp can wrap-and-ellipsize instead of
                       one long line setting the table's min-content width. -->
                    <TableCell class="whitespace-normal">
                      <Item class="group flex-nowrap p-0" size="xs">
                        <ItemMedia>
                          <PhotoUploadAvatar
                            :src="group.photoURL"
                            :name="group.name"
                            :loading="isPhotoBusy(group.id)"
                            @upload="handleGroupAvatarClick(group)"
                            @remove="removeGroupPhoto(group)"
                          />
                        </ItemMedia>
                        <SettingsIdentity
                          :title="group.name"
                          :description="
                            group.description ||
                            t('settings.groups.noDescription')
                          "
                        />
                      </Item>
                    </TableCell>
                    <TableCell>
                      <div class="flex items-center gap-2">
                        <AvatarGroup v-if="group.memberIds.length > 0">
                          <AppAvatar
                            v-for="member in groupMembers(group).slice(
                              0,
                              AVATAR_LIMIT
                            )"
                            :key="member.userId"
                            class="size-8"
                            :src="member.user?.photoURL"
                            :name="memberLabel(member)"
                          />
                          <AvatarGroupCount
                            v-if="group.memberIds.length > AVATAR_LIMIT"
                          >
                            +{{ group.memberIds.length - AVATAR_LIMIT }}
                          </AvatarGroupCount>
                        </AvatarGroup>
                        <span class="text-muted-foreground tabular-nums">
                          {{
                            t("settings.groups.memberCount", {
                              count: group.memberIds.length,
                            })
                          }}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell class="text-muted-foreground tabular-nums">
                      {{
                        t("settings.groups.usedInWorkspaces", {
                          count: usageForGroup(group.id),
                        })
                      }}
                    </TableCell>
                    <TableCell class="text-muted-foreground tabular-nums">
                      {{ formatCreatedAt(group.createdAt) }}
                    </TableCell>
                    <TableCell data-pinned="end" class="text-right">
                      <TooltipProvider>
                        <Tooltip>
                          <DropdownMenu>
                            <TooltipTrigger as-child>
                              <DropdownMenuTrigger as-child>
                                <DataTableRowActionsButton
                                  :label="t('actions.moreOptions')"
                                />
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                data-hotkey="e"
                                @click="openEdit(group)"
                              >
                                <IconPencil />
                                {{ t("settings.groups.edit") }}
                                <DropdownMenuShortcut>E</DropdownMenuShortcut>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                data-hotkey="backspace delete"
                                @click="deleteGroupDialog.open(group)"
                              >
                                <IconTrash />
                                {{ t("settings.groups.delete") }}
                                <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                            <TooltipContent>
                              {{ t("settings.groups.actions") }}
                            </TooltipContent>
                          </DropdownMenu>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="groups.length === 0">
                    <TableCell colspan="5">
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <IconUsers2 />
                          </EmptyMedia>
                          <EmptyTitle>
                            {{ t("settings.groups.empty") }}
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

  <ConfirmAction
    v-model:open="deleteGroupDialog.isOpen.value"
    :title="t('settings.groups.deleteGroup')"
    :action-label="t('actions.delete')"
    destructive
    :on-confirm="handleDelete"
  >
    <template #description>
      <i18n-t keypath="settings.groups.deleteConfirm" tag="span">
        <template #name>
          <span class="text-foreground font-medium">{{
            deleteGroupDialog.item.value?.name
          }}</span>
        </template>
      </i18n-t>
    </template>
  </ConfirmAction>

  <GroupDialog
    v-model:open="isDialogOpen"
    :mode="dialogMode"
    :group="editingGroup"
  />
</template>

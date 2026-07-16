<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowUpDown,
  IconMoreHorizontal,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers2,
  IconX,
} from "@/data/icons"
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

// ── Photo upload (immediate, straight from the table) ────────────────────────
const pendingPhotoGroupId = ref<string | null>(null)
const groupPhotoUpload = usePhotoUpload({
  canUpload: () => canManageMembers.value,
  onUpload: async (id, file) => {
    pendingPhotoGroupId.value = id
    try {
      await groupsStore.updateGroup(id, { photoFile: file })
    } catch (error) {
      console.error("[SettingsGroups] Failed to upload group photo", error)
      toast.error(t("settings.groups.updateError"))
    } finally {
      pendingPhotoGroupId.value = null
    }
  },
})

const handleGroupAvatarClick = (group: IGroup) => {
  if (!canManageMembers.value) return
  groupPhotoUpload.triggerUpload(group.id)
}

const isUploadingPhoto = (id: string) =>
  groupPhotoUpload.isUploading.value && pendingPhotoGroupId.value === id

const removeGroupPhoto = async (group: IGroup) => {
  try {
    await groupsStore.updateGroup(group.id, { photoFile: null })
  } catch (error) {
    console.error("[SettingsGroups] Failed to remove group photo", error)
    toast.error(t("settings.groups.updateError"))
  }
}

// ── Delete ──────────────────────────────────────────────────────────────────
const deletingIds = ref<Set<string>>(new Set())
const isDeleting = (id: string) => deletingIds.value.has(id)

const handleDelete = async (group: IGroup) => {
  deletingIds.value = new Set(deletingIds.value).add(group.id)
  try {
    await groupsStore.deleteGroup(group.id)
  } catch (error) {
    console.error("[SettingsGroups] Failed to delete group", error)
    toast.error(t("settings.groups.deleteError"))
  } finally {
    const next = new Set(deletingIds.value)
    next.delete(group.id)
    deletingIds.value = next
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
      <FieldSet>
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
          <FieldContent>
            <LoadingState v-if="isLoading" />
            <div v-else class="overflow-clip rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-1/4">
                      <Button variant="ghost" @click="toggleGroupSort('name')">
                        {{ t("settings.groups.name") }}
                        <IconArrowUp
                          v-if="
                            groupSortKey === 'name' &&
                            groupSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            groupSortKey === 'name' &&
                            groupSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/4">
                      <Button
                        variant="ghost"
                        @click="toggleGroupSort('members')"
                      >
                        {{ t("settings.groups.members") }}
                        <IconArrowUp
                          v-if="
                            groupSortKey === 'members' &&
                            groupSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            groupSortKey === 'members' &&
                            groupSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/6">
                      <Button
                        variant="ghost"
                        @click="toggleGroupSort('usedIn')"
                      >
                        {{ t("settings.groups.usedIn") }}
                        <IconArrowUp
                          v-if="
                            groupSortKey === 'usedIn' &&
                            groupSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            groupSortKey === 'usedIn' &&
                            groupSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/6">
                      <Button
                        variant="ghost"
                        @click="toggleGroupSort('created')"
                      >
                        {{ t("settings.groups.created") }}
                        <IconArrowUp
                          v-if="
                            groupSortKey === 'created' &&
                            groupSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            groupSortKey === 'created' &&
                            groupSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="group in sortedGroups" :key="group.id">
                    <TableCell>
                      <Item class="group p-0" size="xs">
                        <ItemMedia class="group relative">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <AppAvatar
                                  :class="{
                                    'cursor-pointer': canManageMembers,
                                  }"
                                  :loading="isUploadingPhoto(group.id)"
                                  :src="group.photoURL"
                                  :name="group.name"
                                  @click="handleGroupAvatarClick(group)"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {{
                                  isUploadingPhoto(group.id)
                                    ? t("settings.overview.teamPhoto.uploading")
                                    : t("settings.groups.uploadPhoto")
                                }}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip v-if="group.photoURL">
                              <TooltipTrigger as-child>
                                <Button
                                  variant="secondary"
                                  class="ring-background absolute -top-2 -right-2 size-4 opacity-0! ring-2 transition group-hover:enabled:opacity-100!"
                                  size="icon"
                                  @click.stop="removeGroupPhoto(group)"
                                >
                                  <IconX />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{ t("settings.groups.removePhoto") }}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>
                            {{ group.name }}
                          </ItemTitle>
                          <ItemDescription class="text-xs">
                            {{
                              group.description ||
                              t("settings.groups.noDescription")
                            }}
                          </ItemDescription>
                        </ItemContent>
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
                        <span class="text-muted-foreground text-xs">
                          {{
                            t("settings.groups.memberCount", {
                              count: group.memberIds.length,
                            })
                          }}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell class="text-muted-foreground text-sm">
                      {{
                        t("settings.groups.usedInWorkspaces", {
                          count: usageForGroup(group.id),
                        })
                      }}
                    </TableCell>
                    <TableCell class="text-muted-foreground text-sm">
                      {{ formatCreatedAt(group.createdAt) }}
                    </TableCell>
                    <TableCell class="text-right">
                      <DropdownMenu>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <DropdownMenuTrigger as-child>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  :disabled="isDeleting(group.id)"
                                >
                                  <Spinner v-if="isDeleting(group.id)" />
                                  <IconMoreHorizontal v-else />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                data-hotkey="e"
                                @click="openEdit(group)"
                              >
                                <IconPencil />
                                {{ t("settings.groups.edit") }}
                                <DropdownMenuShortcut>E</DropdownMenuShortcut>
                              </DropdownMenuItem>
                              <AlertDialog>
                                <AlertDialogTrigger as-child>
                                  <DropdownMenuItem
                                    data-hotkey="backspace delete"
                                    @select.prevent
                                  >
                                    <IconTrash />
                                    {{ t("settings.groups.delete") }}
                                    <DropdownMenuShortcut>
                                      ⌫
                                    </DropdownMenuShortcut>
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      {{ t("settings.groups.deleteGroup") }}
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {{
                                        t("settings.groups.deleteConfirm", {
                                          name: group.name,
                                        })
                                      }}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      {{ t("actions.cancel") }}
                                      <Kbd>Esc</Kbd>
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      :disabled="isDeleting(group.id)"
                                      @click="handleDelete(group)"
                                    >
                                      <Spinner v-if="isDeleting(group.id)" />
                                      {{ t("settings.groups.delete") }}
                                      <Kbd>↩</Kbd>
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </DropdownMenuContent>
                            <TooltipContent>
                              {{ t("settings.groups.actions") }}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </DropdownMenu>
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

  <GroupDialog
    v-model:open="isDialogOpen"
    :mode="dialogMode"
    :group="editingGroup"
  />
</template>

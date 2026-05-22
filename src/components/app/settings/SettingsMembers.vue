<script lang="ts" setup>
import SettingsRestricted from "@/components/app/settings/SettingsRestricted.vue"
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowUpDown,
  IconLogOut,
  IconMoreHorizontal,
  IconPlus,
  IconUsers,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import type { IMembershipRole } from "@/types/membership"
import { useCurrentUser } from "vuefire"

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()
const user = useCurrentUser()

// Use team actions composable - all logic is now self-contained
const {
  currentTeam,
  teamMembers,
  isLoading,
  canInviteMembers,
  getCannotInviteMembersReason,
  loading: teamLoading,
  getCannotChangeRoleReason,
  getCannotRemoveMemberReason,
  changeRole,
  removeMember,
} = useTeamActions()

// Team Dialog for inviting members
const isTeamDialogOpen = ref(false)

const openInviteDialog = () => {
  isTeamDialogOpen.value = true
}

// Sorting state
type SortDirection = "asc" | "desc" | null
type MemberSortKey = "name" | "joined"

const memberSortKey = ref<MemberSortKey | null>(null)
const memberSortDirection = ref<SortDirection>(null)

const toggleMemberSort = (key: MemberSortKey) => {
  if (memberSortKey.value === key) {
    if (memberSortDirection.value === "asc") {
      memberSortDirection.value = "desc"
    } else if (memberSortDirection.value === "desc") {
      memberSortKey.value = null
      memberSortDirection.value = null
    } else {
      memberSortDirection.value = "asc"
    }
  } else {
    memberSortKey.value = key
    memberSortDirection.value = "asc"
  }
}

const sortedTeamMembers = computed(() => {
  if (!memberSortKey.value || !memberSortDirection.value) {
    return teamMembers.value
  }

  const sorted = [...teamMembers.value]
  const direction = memberSortDirection.value === "asc" ? 1 : -1

  sorted.sort((a, b) => {
    if (memberSortKey.value === "name") {
      const nameA = (a.user?.displayName || a.user?.email || "").toLowerCase()
      const nameB = (b.user?.displayName || b.user?.email || "").toLowerCase()
      return nameA.localeCompare(nameB) * direction
    } else if (memberSortKey.value === "joined") {
      const dateA = a.createdAt?.toDate?.()?.getTime() || 0
      const dateB = b.createdAt?.toDate?.()?.getTime() || 0
      return (dateA - dateB) * direction
    }
    return 0
  })

  return sorted
})

const handleChangeRole = (userId: string, role: IMembershipRole) => {
  changeRole(userId, role)
}

const handleRemoveMember = (userId: string) => {
  removeMember(userId)
}

const formatCreatedAt = (
  value: (typeof teamMembers.value)[number]["createdAt"] | null | undefined
) => {
  const date = value?.toDate?.()
  return date ? useDateFormat(date, "MMM D, YYYY").value : "—"
}
</script>

<template>
  <div v-if="canViewTeamSettings" class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{ t("settings.members.title") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.members.description") }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Button
                    :disabled="!canInviteMembers"
                    @click="openInviteDialog"
                  >
                    <IconPlus />
                    {{ t("settings.members.inviteMember") }}
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canInviteMembers">
                {{ t(getCannotInviteMembersReason || "") }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <div v-if="isLoading" class="flex justify-center py-8">
              <Spinner />
            </div>
            <div v-else class="overflow-clip rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-1/4">
                      <Button variant="ghost" @click="toggleMemberSort('name')">
                        {{ t("settings.members.name") }}
                        <IconArrowUp
                          v-if="
                            memberSortKey === 'name' &&
                            memberSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            memberSortKey === 'name' &&
                            memberSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/4">
                      {{ t("settings.members.role") }}
                    </TableHead>
                    <TableHead class="w-1/4">
                      <Button
                        variant="ghost"
                        @click="toggleMemberSort('joined')"
                      >
                        {{ t("settings.members.joined") }}
                        <IconArrowUp
                          v-if="
                            memberSortKey === 'joined' &&
                            memberSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            memberSortKey === 'joined' &&
                            memberSortDirection === 'desc'
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
                    v-for="member in sortedTeamMembers"
                    :key="member.userId"
                  >
                    <TableCell>
                      <Item class="group p-0" size="xs">
                        <ItemMedia>
                          <Avatar>
                            <AvatarImage
                              :src="member.user?.photoURL!"
                              :alt="member.user?.displayName"
                              referrerpolicy="no-referrer"
                            />
                            <AvatarFallback>
                              {{ getInitials(member.user?.displayName!) }}
                            </AvatarFallback>
                          </Avatar>
                        </ItemMedia>
                        <ItemContent class="gap-0.5 truncate">
                          <ItemTitle class="truncate">
                            {{ member.user?.displayName }}
                          </ItemTitle>
                          <ItemDescription class="truncate text-xs">
                            {{ member.user?.email }}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    </TableCell>
                    <TableCell class="capitalize">
                      <TooltipProvider v-if="getCannotChangeRoleReason(member)">
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <span class="inline-block">
                              <Select :model-value="member.role" disabled>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectItem value="owner">
                                      {{ t("settings.members.roles.owner") }}
                                    </SelectItem>
                                    <SelectItem value="admin">
                                      {{ t("settings.members.roles.admin") }}
                                    </SelectItem>
                                    <SelectItem value="member">
                                      {{ t("settings.members.roles.member") }}
                                    </SelectItem>
                                    <SelectItem value="guest">
                                      {{ t("settings.members.roles.guest") }}
                                    </SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {{ t(getCannotChangeRoleReason(member)!) }}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Select
                        v-else
                        :model-value="member.role"
                        :disabled="teamLoading.role.isLoading(member.userId)"
                        @update:model-value="
                          (role) =>
                            handleChangeRole(
                              member.userId,
                              role as IMembershipRole
                            )
                        "
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="owner">
                              {{ t("settings.members.roles.owner") }}
                            </SelectItem>
                            <SelectItem value="admin">
                              {{ t("settings.members.roles.admin") }}
                            </SelectItem>
                            <SelectItem value="member">
                              {{ t("settings.members.roles.member") }}
                            </SelectItem>
                            <SelectItem value="guest">
                              {{ t("settings.members.roles.guest") }}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {{ formatCreatedAt(member.createdAt) }}
                    </TableCell>
                    <TableCell class="flex items-center justify-end text-right">
                      <ButtonGroup>
                        <TooltipProvider
                          v-if="getCannotRemoveMemberReason(member)"
                        >
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <span class="inline-block">
                                <Button variant="outline" size="icon" disabled>
                                  <IconMoreHorizontal />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {{ t(getCannotRemoveMemberReason(member)!) }}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <DropdownMenu v-else>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <DropdownMenuTrigger as-child>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    :disabled="
                                      teamLoading.member.isLoading(
                                        member.userId
                                      )
                                    "
                                  >
                                    <Spinner
                                      v-if="
                                        teamLoading.member.isLoading(
                                          member.userId
                                        )
                                      "
                                    />
                                    <IconMoreHorizontal v-else />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent class="w-50">
                                  <AlertDialog>
                                    <AlertDialogTrigger as-child>
                                      <DropdownMenuItem @select.prevent>
                                        <IconLogOut />
                                        {{
                                          member.userId === user?.uid
                                            ? t("settings.members.exit")
                                            : t("settings.members.remove")
                                        }}
                                      </DropdownMenuItem>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          {{
                                            member.userId === user?.uid
                                              ? t("settings.members.exitTeam")
                                              : t(
                                                  "settings.members.removeMember"
                                                )
                                          }}
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          {{
                                            member.userId === user?.uid
                                              ? t(
                                                  "settings.members.exitConfirm"
                                                )
                                              : t(
                                                  "settings.members.removeConfirm",
                                                  {
                                                    name:
                                                      member.user
                                                        ?.displayName ||
                                                      member.user?.email ||
                                                      "",
                                                  }
                                                )
                                          }}
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>
                                          {{ t("actions.cancel") }}
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                          :disabled="
                                            teamLoading.member.isLoading(
                                              member.userId
                                            )
                                          "
                                          @click="
                                            handleRemoveMember(member.userId)
                                          "
                                        >
                                          <Spinner
                                            v-if="
                                              teamLoading.member.isLoading(
                                                member.userId
                                              )
                                            "
                                          />
                                          {{
                                            member.userId === user?.uid
                                              ? t("settings.members.exit")
                                              : t("settings.members.remove")
                                          }}
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </DropdownMenuContent>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{ t("settings.members.actions") }}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </DropdownMenu>
                      </ButtonGroup>
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="teamMembers.length === 0">
                    <TableCell colspan="4">
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <IconUsers />
                          </EmptyMedia>
                          <EmptyTitle>
                            {{ t("settings.members.noMembers") }}
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

  <!-- Team Invite Dialog -->
  <TeamDialog
    v-model:open="isTeamDialogOpen"
    mode="invite"
    :team="currentTeam || undefined"
  />
</template>

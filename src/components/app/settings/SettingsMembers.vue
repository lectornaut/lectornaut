<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useTeamActions } from "@/composables/useTeamActions"
import { IconLogOut, IconPlus, IconTrash, IconUsers } from "@/data/icons"
import {
  isAgentMembership,
  type IAgentMembership,
  type IMembershipRole,
  type ITeamMember,
} from "@/types/membership"
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
  removeAgentMember,
} = useTeamActions()

// ── Member display helpers (users + agents share one table) ──────────────────
// Agents are role-locked "member" rows: no email, a boring-avatar instead of
// a photo, an "Agent" badge, a disabled role select, and a remove action menu.
const memberRowKey = (member: ITeamMember) =>
  isAgentMembership(member) ? `agent:${member.agentId}` : member.userId

const memberDisplayName = (member: ITeamMember): string =>
  isAgentMembership(member)
    ? member.agent.name
    : member.user?.displayName || member.user?.email || ""

const agentAvatarSeed = (member: IAgentMembership): string =>
  member.agent.avatarSeed?.trim() || member.agent.name?.trim() || "Agent"

const isAgentRemovalPending = (member: IAgentMembership): boolean =>
  teamLoading.member.isLoading(`agent:${member.agentId}`)

const handleRemoveAgent = (member: IAgentMembership) =>
  removeAgentMember(member.agentId)

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
      const nameA = memberDisplayName(a).toLowerCase()
      const nameB = memberDisplayName(b).toLowerCase()
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

const handleRemoveMember = (member: ITeamMember) => {
  if (!isAgentMembership(member)) removeMember(member.userId)
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
      <!-- min-w-0 (here and on the table's FieldContent) beats the fieldset
         UA `min-inline-size: min-content` floor so the Table shrinks with
         the dialog and scrolls inside its own overflow-x-auto container
         (same recipe as SettingsConnections' Manage tab). -->
      <FieldSet class="min-w-0">
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
          <FieldContent class="min-w-0">
            <LoadingState v-if="isLoading" />
            <div v-else class="overflow-clip rounded-4xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="min-w-64">
                      <DataTableSortButton
                        :direction="
                          memberSortKey === 'name' ? memberSortDirection : null
                        "
                        @click="toggleMemberSort('name')"
                      >
                        {{ t("settings.members.name") }}
                      </DataTableSortButton>
                    </TableHead>
                    <TableHead class="w-1/4">
                      {{ t("settings.members.role") }}
                    </TableHead>
                    <TableHead class="w-1/4">
                      <DataTableSortButton
                        :direction="
                          memberSortKey === 'joined'
                            ? memberSortDirection
                            : null
                        "
                        @click="toggleMemberSort('joined')"
                      >
                        {{ t("settings.members.joined") }}
                      </DataTableSortButton>
                    </TableHead>
                    <TableHead
                      data-pinned="end"
                      class="w-px text-right"
                    ></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="member in sortedTeamMembers"
                    :key="memberRowKey(member)"
                  >
                    <!-- whitespace-normal resets TableCell's default nowrap so
                       the Item's line-clamp can wrap-and-ellipsize instead of
                       one long line setting the table's min-content width. -->
                    <TableCell class="whitespace-normal">
                      <Item class="group flex-nowrap p-0" size="xs">
                        <ItemMedia v-if="isAgentMembership(member)">
                          <AppAvatar
                            variant="beam"
                            :name="agentAvatarSeed(member)"
                          />
                        </ItemMedia>
                        <ItemMedia v-else>
                          <AppAvatar
                            :src="member.user?.photoURL"
                            :name="member.user?.displayName"
                          />
                        </ItemMedia>
                        <SettingsIdentity
                          :title="memberDisplayName(member)"
                          :description="
                            isAgentMembership(member)
                              ? member.agent.description ||
                                t('settings.members.agentSubtitle')
                              : member.user?.email
                          "
                        >
                          <template #badges>
                            <Badge
                              v-if="isAgentMembership(member)"
                              variant="secondary"
                            >
                              {{ t("settings.members.agentBadge") }}
                            </Badge>
                          </template>
                        </SettingsIdentity>
                      </Item>
                    </TableCell>
                    <TableCell class="capitalize">
                      <Select
                        v-if="isAgentMembership(member)"
                        model-value="member"
                        disabled
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="member">
                              {{ t("settings.members.roles.member") }}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <template v-else>
                        <TooltipProvider
                          v-if="getCannotChangeRoleReason(member)"
                        >
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
                      </template>
                    </TableCell>
                    <TableCell class="text-muted-foreground tabular-nums">
                      {{ formatCreatedAt(member.createdAt) }}
                    </TableCell>
                    <TableCell data-pinned="end" class="text-right">
                      <ButtonGroup class="w-full justify-end">
                        <!-- Agent rows: remove-only dropdown (role is locked) -->
                        <template v-if="isAgentMembership(member)">
                          <TooltipProvider v-if="!canInviteMembers">
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <span class="inline-block">
                                  <DataTableRowActionsButton
                                    :label="t('settings.members.actions')"
                                    disabled
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{ t(getCannotInviteMembersReason || "") }}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <AlertDialog v-else>
                            <TooltipProvider>
                              <Tooltip>
                                <DropdownMenu>
                                  <TooltipTrigger as-child>
                                    <DropdownMenuTrigger as-child>
                                      <DataTableRowActionsButton
                                        :label="t('settings.members.actions')"
                                        :loading="isAgentRemovalPending(member)"
                                      />
                                    </DropdownMenuTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {{ t("settings.members.actions") }}
                                  </TooltipContent>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuGroup>
                                      <AlertDialogTrigger as-child>
                                        <DropdownMenuItem
                                          data-hotkey="x"
                                          :disabled="
                                            isAgentRemovalPending(member)
                                          "
                                          @select.prevent
                                        >
                                          <IconTrash />
                                          {{
                                            t("settings.members.removeAgent")
                                          }}
                                          <DropdownMenuShortcut>
                                            X
                                          </DropdownMenuShortcut>
                                        </DropdownMenuItem>
                                      </AlertDialogTrigger>
                                    </DropdownMenuGroup>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </Tooltip>
                            </TooltipProvider>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  {{ t("settings.members.removeAgent") }}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {{
                                    t("settings.members.removeAgentConfirm", {
                                      name: member.agent.name,
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
                                  :disabled="isAgentRemovalPending(member)"
                                  @click="handleRemoveAgent(member)"
                                >
                                  <Spinner
                                    v-if="isAgentRemovalPending(member)"
                                  />
                                  {{ t("settings.members.remove") }}
                                  <Kbd>↩</Kbd>
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </template>
                        <!-- User rows: role/remove/exit dropdown -->
                        <TooltipProvider
                          v-else-if="getCannotRemoveMemberReason(member)"
                        >
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <span class="inline-block">
                                <DataTableRowActionsButton
                                  :label="t('settings.members.actions')"
                                  disabled
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {{ t(getCannotRemoveMemberReason(member)!) }}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider v-else>
                          <Tooltip>
                            <DropdownMenu>
                              <TooltipTrigger as-child>
                                <DropdownMenuTrigger as-child>
                                  <DataTableRowActionsButton
                                    :label="t('settings.members.actions')"
                                    :loading="
                                      teamLoading.member.isLoading(
                                        member.userId
                                      )
                                    "
                                  />
                                </DropdownMenuTrigger>
                              </TooltipTrigger>
                              <DropdownMenuContent align="end">
                                <AlertDialog>
                                  <AlertDialogTrigger as-child>
                                    <DropdownMenuItem
                                      data-hotkey="x"
                                      @select.prevent
                                    >
                                      <IconLogOut />
                                      {{
                                        member.userId === user?.uid
                                          ? t("settings.members.exit")
                                          : t("settings.members.remove")
                                      }}
                                      <DropdownMenuShortcut>
                                        X
                                      </DropdownMenuShortcut>
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        {{
                                          member.userId === user?.uid
                                            ? t("settings.members.exitTeam")
                                            : t("settings.members.removeMember")
                                        }}
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        {{
                                          member.userId === user?.uid
                                            ? t("settings.members.exitConfirm")
                                            : t(
                                                "settings.members.removeConfirm",
                                                {
                                                  name:
                                                    member.user?.displayName ||
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
                                        <Kbd>Esc</Kbd>
                                      </AlertDialogCancel>
                                      <AlertDialogAction
                                        :disabled="
                                          teamLoading.member.isLoading(
                                            member.userId
                                          )
                                        "
                                        @click="handleRemoveMember(member)"
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
                                        <Kbd>↩</Kbd>
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                              <TooltipContent>
                                {{ t("settings.members.actions") }}
                              </TooltipContent>
                            </DropdownMenu>
                          </Tooltip>
                        </TooltipProvider>
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

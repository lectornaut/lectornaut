<script lang="ts" setup>
import SettingsRestricted from "@/components/app/settings/SettingsRestricted.vue"
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowUpDown,
  IconCheck,
  IconLogOut,
  IconMoreHorizontal,
  IconPencil,
  IconPlus,
  IconSwitchHorizontal,
  IconTrash,
  IconUsersRound,
  IconX,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import type { ITeam } from "@/types/domain"
import type { IMembership } from "@/types/membership"

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

// Use team actions composable - all logic is now self-contained
const {
  currentTeam,
  memberships,
  isLoading,
  loading: teamLoading,
  canCreateTeam,
  canExitTeam,
  canDeleteTeam,
  getCannotExitTeamReason,
  getCannotDeleteTeamReason,
  getTeamMemberCount,
  canEditTeam,
  getCannotCreateTeamReason,
  getCannotEditTeamReason,
  switchTeam,
  exitTeam,
  deleteTeam,
  updateTeamPhoto,
  removeTeamPhoto,
} = useTeamActions()

// Team Dialog State
const isTeamDialogOpen = ref(false)
const teamDialogMode = ref<"create" | "edit" | "invite">("create")
const teamDialogTeam = ref<ITeam | undefined>(undefined)

const openTeamDialog = (mode: "create" | "edit" | "invite", team?: ITeam) => {
  teamDialogMode.value = mode
  teamDialogTeam.value = team
  isTeamDialogOpen.value = true
}

// Confirmation dialogs
const exitTeamDialog = useConfirmationDialog<ITeam>()
const deleteTeamDialog = useConfirmationDialog<ITeam>()

const handleExitTeam = () => exitTeamDialog.confirm((team) => exitTeam(team.id))
const handleDeleteTeam = () =>
  deleteTeamDialog.confirm((team) => deleteTeam(team.id))

// Photo upload
const teamPhotoUpload = usePhotoUpload({
  onUpload: updateTeamPhoto,
})

const handleTeamAvatarClick = (membership: IMembership) => {
  if (!canEditTeam(membership)) return
  teamPhotoUpload.triggerUpload(membership.teamId)
}

// Sorting state
type SortDirection = "asc" | "desc" | null
type TeamSortKey = "name" | "created"

const teamSortKey = ref<TeamSortKey | null>(null)
const teamSortDirection = ref<SortDirection>(null)

const toggleTeamSort = (key: TeamSortKey) => {
  if (teamSortKey.value === key) {
    if (teamSortDirection.value === "asc") {
      teamSortDirection.value = "desc"
    } else if (teamSortDirection.value === "desc") {
      teamSortKey.value = null
      teamSortDirection.value = null
    } else {
      teamSortDirection.value = "asc"
    }
  } else {
    teamSortKey.value = key
    teamSortDirection.value = "asc"
  }
}

const sortedMemberships = computed(() => {
  if (!teamSortKey.value || !teamSortDirection.value) {
    return memberships.value
  }

  const sorted = [...memberships.value]
  const direction = teamSortDirection.value === "asc" ? 1 : -1

  sorted.sort((a, b) => {
    if (teamSortKey.value === "name") {
      const nameA = (a.team?.name || "").toLowerCase()
      const nameB = (b.team?.name || "").toLowerCase()
      return nameA.localeCompare(nameB) * direction
    } else if (teamSortKey.value === "created") {
      const dateA = a.createdAt?.toDate?.()?.getTime() || 0
      const dateB = b.createdAt?.toDate?.()?.getTime() || 0
      return (dateA - dateB) * direction
    }
    return 0
  })

  return sorted
})

const formatCreatedAt = (
  value: IMembership["createdAt"] | null | undefined
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
            <FieldLabel>{{ t("settings.teamsList.label") }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.teamsList.description") }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Button
                    :disabled="!canCreateTeam"
                    @click="openTeamDialog('create')"
                  >
                    <IconPlus />
                    {{ t("settings.teamsList.createTeam") }}
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canCreateTeam">
                {{ t(getCannotCreateTeamReason || "") }}
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
                      <Button variant="ghost" @click="toggleTeamSort('name')">
                        {{ t("settings.teamsList.columnName") }}
                        <IconArrowUp
                          v-if="
                            teamSortKey === 'name' &&
                            teamSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            teamSortKey === 'name' &&
                            teamSortDirection === 'desc'
                          "
                        />
                        <IconArrowUpDown v-else />
                      </Button>
                    </TableHead>
                    <TableHead class="w-1/4">{{
                      t("settings.teamsList.columnRole")
                    }}</TableHead>
                    <TableHead class="w-1/4">
                      <Button
                        variant="ghost"
                        @click="toggleTeamSort('created')"
                      >
                        {{ t("settings.teamsList.columnCreated") }}
                        <IconArrowUp
                          v-if="
                            teamSortKey === 'created' &&
                            teamSortDirection === 'asc'
                          "
                        />
                        <IconArrowDown
                          v-else-if="
                            teamSortKey === 'created' &&
                            teamSortDirection === 'desc'
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
                    v-for="membership in sortedMemberships"
                    :key="membership.teamId"
                  >
                    <TableCell>
                      <Item class="group p-0" size="xs">
                        <ItemMedia class="group relative">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <Avatar
                                  class="flex items-center justify-center"
                                  :class="{
                                    'cursor-pointer': canEditTeam(membership),
                                    'cursor-not-allowed opacity-60':
                                      !canEditTeam(membership),
                                  }"
                                  @click="handleTeamAvatarClick(membership)"
                                >
                                  <template
                                    v-if="
                                      teamLoading.team.isLoading(
                                        `photo-${membership.teamId}`
                                      )
                                    "
                                  >
                                    <Spinner />
                                  </template>
                                  <template v-else>
                                    <AvatarImage
                                      :src="membership.team?.photoURL!"
                                      :alt="membership.team?.name"
                                    />
                                    <AvatarFallback>
                                      {{ getInitials(membership.team?.name) }}
                                    </AvatarFallback>
                                  </template>
                                </Avatar>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{
                                  canEditTeam(membership)
                                    ? teamLoading.team.isLoading(
                                        `photo-${membership.teamId}`
                                      )
                                      ? t(
                                          "settings.overview.teamPhoto.uploading"
                                        )
                                      : t("settings.teamsList.uploadPhoto")
                                    : getCannotEditTeamReason(membership)
                                }}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip v-if="membership.team?.photoURL">
                              <TooltipTrigger as-child>
                                <Button
                                  variant="secondary"
                                  class="ring-background absolute -top-2 -right-2 size-4 opacity-0! ring-2 transition group-hover:enabled:opacity-100!"
                                  size="icon"
                                  :disabled="!canEditTeam(membership)"
                                  @click.stop="
                                    removeTeamPhoto(membership.teamId)
                                  "
                                >
                                  <IconX />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{
                                  canEditTeam(membership)
                                    ? t("settings.teamsList.removePhoto")
                                    : getCannotEditTeamReason(membership)
                                }}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </ItemMedia>
                        <ItemContent class="gap-0.5 truncate">
                          <ItemTitle class="truncate">
                            {{ membership.team?.name }}
                          </ItemTitle>
                          <ItemDescription class="truncate text-xs">
                            {{
                              t("settings.teams.memberCount", {
                                count: getTeamMemberCount(membership.teamId),
                              })
                            }}
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                    </TableCell>
                    <TableCell class="capitalize">
                      {{ membership.role }}
                    </TableCell>
                    <TableCell>
                      {{ formatCreatedAt(membership.createdAt) }}
                    </TableCell>
                    <TableCell class="flex items-center justify-end text-right">
                      <ButtonGroup>
                        <ButtonGroup>
                          <Button
                            v-if="currentTeam?.id !== membership.team?.id"
                            variant="outline"
                            :disabled="
                              teamLoading.team.isLoading(membership.team?.id)
                            "
                            @click="switchTeam(membership.team?.id!)"
                          >
                            <Spinner
                              v-if="
                                teamLoading.team.isLoading(membership.team?.id)
                              "
                            />
                            <template v-else>
                              <IconSwitchHorizontal />
                              {{ t("actions.switch") }}
                            </template>
                          </Button>
                          <Button v-else variant="outline" disabled>
                            <IconCheck />
                            {{ t("settings.teamsList.current") }}
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
                                  <DropdownMenuContent class="w-50">
                                    <Tooltip>
                                      <TooltipTrigger as-child>
                                        <div>
                                          <DropdownMenuItem
                                            :disabled="!canExitTeam(membership)"
                                            @click="
                                              exitTeamDialog.open(
                                                membership.team!
                                              )
                                            "
                                          >
                                            <IconLogOut />
                                            {{ t("settings.members.exit") }}
                                          </DropdownMenuItem>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        v-if="!canExitTeam(membership)"
                                      >
                                        {{
                                          getCannotExitTeamReason(membership)
                                        }}
                                      </TooltipContent>
                                    </Tooltip>
                                    <DropdownMenuSeparator />
                                    <Tooltip>
                                      <TooltipTrigger as-child>
                                        <div>
                                          <DropdownMenuItem
                                            :disabled="!canEditTeam(membership)"
                                            @click="
                                              openTeamDialog(
                                                'edit',
                                                membership.team!
                                              )
                                            "
                                          >
                                            <IconPencil />
                                            {{ t("actions.edit") }}
                                          </DropdownMenuItem>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        v-if="!canEditTeam(membership)"
                                      >
                                        {{
                                          getCannotEditTeamReason(membership)
                                        }}
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger as-child>
                                        <div>
                                          <DropdownMenuItem
                                            :disabled="
                                              !canDeleteTeam(membership)
                                            "
                                            @click="
                                              deleteTeamDialog.open(
                                                membership.team!
                                              )
                                            "
                                          >
                                            <IconTrash />
                                            {{ t("actions.delete") }}
                                          </DropdownMenuItem>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        v-if="!canDeleteTeam(membership)"
                                      >
                                        {{
                                          getCannotDeleteTeamReason(membership)
                                        }}
                                      </TooltipContent>
                                    </Tooltip>
                                  </DropdownMenuContent>
                                </TooltipTrigger>
                                <TooltipContent>{{
                                  t("settings.teamsList.actionsTooltip")
                                }}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </DropdownMenu>
                        </ButtonGroup>
                      </ButtonGroup>
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="memberships.length === 0">
                    <TableCell colspan="4">
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <IconUsersRound />
                          </EmptyMedia>
                          <EmptyTitle>
                            {{ t("settings.teamsList.noTeams") }}
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

  <!-- Exit Team Dialog -->
  <AlertDialog v-model:open="exitTeamDialog.isOpen.value">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          t("settings.teamsList.exitTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          <i18n-t keypath="settings.teamsList.exitConfirm" tag="span">
            <template #name>
              <span class="text-foreground font-medium">{{
                exitTeamDialog.item.value?.name
              }}</span>
            </template>
          </i18n-t>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("actions.cancel") }}</AlertDialogCancel>
        <AlertDialogAction
          :disabled="
            exitTeamDialog.item.value &&
            teamLoading.team.isLoading(`exit-${exitTeamDialog.item.value.id}`)
          "
          @click.prevent="handleExitTeam"
        >
          <Spinner
            v-if="
              exitTeamDialog.item.value &&
              teamLoading.team.isLoading(`exit-${exitTeamDialog.item.value.id}`)
            "
          />
          {{ t("settings.teamsList.exitTitle") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Delete Team Dialog -->
  <AlertDialog v-model:open="deleteTeamDialog.isOpen.value">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          t("settings.teamsList.deleteTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          <i18n-t keypath="settings.teamsList.deleteConfirm" tag="span">
            <template #name>
              <span class="text-foreground font-medium">{{
                deleteTeamDialog.item.value?.name
              }}</span>
            </template>
          </i18n-t>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("actions.cancel") }}</AlertDialogCancel>
        <AlertDialogAction
          :disabled="
            deleteTeamDialog.item.value &&
            teamLoading.team.isLoading(
              `delete-${deleteTeamDialog.item.value.id}`
            )
          "
          @click.prevent="handleDeleteTeam"
        >
          <Spinner
            v-if="
              deleteTeamDialog.item.value &&
              teamLoading.team.isLoading(
                `delete-${deleteTeamDialog.item.value.id}`
              )
            "
          />
          {{ t("settings.teamsList.deleteTitle") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Team Create/Edit/Invite Dialog -->
  <TeamDialog
    v-model:open="isTeamDialogOpen"
    :mode="teamDialogMode"
    :team="teamDialogTeam"
  />
</template>

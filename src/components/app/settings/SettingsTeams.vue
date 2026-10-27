<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconCheck,
  IconLogOut,
  IconPencil,
  IconPlus,
  IconSwitchHorizontal,
  IconTrash,
  IconUsersRound,
  IconX,
} from "@/data/icons"
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
      <!-- min-w-0 (here and on the table's FieldContent) beats the fieldset
         UA `min-inline-size: min-content` floor so the Table shrinks with
         the dialog and scrolls inside its own overflow-x-auto container
         (same recipe as SettingsConnections' Manage tab). -->
      <FieldSet class="min-w-0">
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
          <FieldContent class="min-w-0">
            <LoadingState v-if="isLoading" />
            <div
              v-else
              data-table-frame
              class="overflow-clip rounded-4xl border"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="min-w-64">
                      <DataTableSortButton
                        :direction="
                          teamSortKey === 'name' ? teamSortDirection : null
                        "
                        @click="toggleTeamSort('name')"
                      >
                        {{ t("settings.teamsList.columnName") }}
                      </DataTableSortButton>
                    </TableHead>
                    <TableHead class="w-1/4">{{
                      t("settings.teamsList.columnRole")
                    }}</TableHead>
                    <TableHead class="w-1/4">
                      <DataTableSortButton
                        :direction="
                          teamSortKey === 'created' ? teamSortDirection : null
                        "
                        @click="toggleTeamSort('created')"
                      >
                        {{ t("settings.teamsList.columnCreated") }}
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
                    v-for="membership in sortedMemberships"
                    :key="membership.teamId"
                  >
                    <!-- whitespace-normal resets TableCell's default nowrap so
                       the Item's line-clamp can wrap-and-ellipsize instead of
                       one long line setting the table's min-content width. -->
                    <TableCell class="whitespace-normal">
                      <Item class="group flex-nowrap p-0" size="xs">
                        <ItemMedia class="group relative">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <AppAvatar
                                  :class="{
                                    'cursor-pointer': canEditTeam(membership),
                                    'cursor-not-allowed opacity-60':
                                      !canEditTeam(membership),
                                  }"
                                  :loading="
                                    teamLoading.team.isLoading(
                                      `photo-${membership.teamId}`
                                    )
                                  "
                                  :src="membership.team?.photoURL"
                                  :name="membership.team?.name"
                                  @click="handleTeamAvatarClick(membership)"
                                />
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
                        <SettingsIdentity
                          :title="membership.team?.name ?? ''"
                          :description="
                            t('settings.teams.memberCount', {
                              count: getTeamMemberCount(membership.teamId),
                            })
                          "
                        />
                      </Item>
                    </TableCell>
                    <TableCell class="capitalize">
                      {{ membership.role }}
                    </TableCell>
                    <TableCell class="text-muted-foreground tabular-nums">
                      {{ formatCreatedAt(membership.createdAt) }}
                    </TableCell>
                    <TableCell data-pinned="end" class="text-right">
                      <ButtonGroup class="w-full justify-end">
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
                          <TooltipProvider>
                            <Tooltip>
                              <DropdownMenu>
                                <TooltipTrigger as-child>
                                  <DropdownMenuTrigger as-child>
                                    <DataTableRowActionsButton
                                      :label="
                                        t('settings.teamsList.actionsTooltip')
                                      "
                                    />
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <DropdownMenuContent align="end">
                                  <Tooltip>
                                    <TooltipTrigger as-child>
                                      <div>
                                        <DropdownMenuItem
                                          :disabled="!canExitTeam(membership)"
                                          data-hotkey="x"
                                          @click="
                                            exitTeamDialog.open(
                                              membership.team!
                                            )
                                          "
                                        >
                                          <IconLogOut />
                                          {{ t("settings.members.exit") }}
                                          <DropdownMenuShortcut>
                                            X
                                          </DropdownMenuShortcut>
                                        </DropdownMenuItem>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      v-if="!canExitTeam(membership)"
                                    >
                                      {{ getCannotExitTeamReason(membership) }}
                                    </TooltipContent>
                                  </Tooltip>
                                  <DropdownMenuSeparator />
                                  <Tooltip>
                                    <TooltipTrigger as-child>
                                      <div>
                                        <DropdownMenuItem
                                          :disabled="!canEditTeam(membership)"
                                          data-hotkey="e"
                                          @click="
                                            openTeamDialog(
                                              'edit',
                                              membership.team!
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
                                      v-if="!canEditTeam(membership)"
                                    >
                                      {{ getCannotEditTeamReason(membership) }}
                                    </TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger as-child>
                                      <div>
                                        <DropdownMenuItem
                                          :disabled="!canDeleteTeam(membership)"
                                          data-hotkey="backspace delete"
                                          @click="
                                            deleteTeamDialog.open(
                                              membership.team!
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
                                      v-if="!canDeleteTeam(membership)"
                                    >
                                      {{
                                        getCannotDeleteTeamReason(membership)
                                      }}
                                    </TooltipContent>
                                  </Tooltip>
                                </DropdownMenuContent>
                                <TooltipContent>{{
                                  t("settings.teamsList.actionsTooltip")
                                }}</TooltipContent>
                              </DropdownMenu>
                            </Tooltip>
                          </TooltipProvider>
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
        <AlertDialogCancel
          >{{ t("actions.cancel") }}<Kbd>Esc</Kbd>
        </AlertDialogCancel>
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
          <Kbd>↩</Kbd>
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
        <AlertDialogCancel
          >{{ t("actions.cancel") }}<Kbd>Esc</Kbd>
        </AlertDialogCancel>
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
          <Kbd>↩</Kbd>
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

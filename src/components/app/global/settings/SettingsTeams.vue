<script lang="ts" setup>
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
  IconX,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import type { IMembership, ITeam } from "@/types"
import { DateFormatter } from "@internationalized/date"

const { t } = useI18n()

const df = new DateFormatter("en-US", {
  dateStyle: "medium",
})

// Use team actions composable - all logic is now self-contained
const {
  currentTeam,
  memberships,
  isLoading,
  loading: teamLoading,
  canExitTeam,
  canDeleteTeam,
  getTeamMemberCount,
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
  if (membership.role !== "owner") return
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
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Teams</FieldLabel>
            <FieldDescription>
              Manage your teams and switch between them.
            </FieldDescription>
          </FieldContent>
          <Button @click="openTeamDialog('create')">
            <IconPlus />
            Create Team
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
                        @click="toggleTeamSort('name')"
                      >
                        Name
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
                    <TableHead class="w-1/4">Role</TableHead>
                    <TableHead class="w-1/4">
                      <Button
                        variant="ghost"
                        size="sm"
                        @click="toggleTeamSort('created')"
                      >
                        Created
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
                      <Item size="sm" class="group w-full gap-2 p-0">
                        <ItemMedia class="group relative">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <Avatar
                                  class="flex items-center justify-center rounded-md"
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
                                      class="rounded-md"
                                      :src="membership.team?.photoURL!"
                                      :alt="membership.team?.name"
                                    />
                                    <AvatarFallback class="rounded-md">
                                      {{ getInitials(membership.team?.name) }}
                                    </AvatarFallback>
                                  </template>
                                </Avatar>
                              </TooltipTrigger>
                              <TooltipContent
                                v-if="membership.role === 'owner'"
                              >
                                {{
                                  teamLoading.team.isLoading(
                                    `photo-${membership.teamId}`
                                  )
                                    ? "Uploading..."
                                    : "Upload team photo"
                                }}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip
                              v-if="
                                membership.role === 'owner' &&
                                membership.team?.photoURL
                              "
                            >
                              <TooltipTrigger as-child>
                                <Button
                                  variant="secondary"
                                  class="ring-background absolute -top-2 -right-2 size-5 rounded-full opacity-0 ring-2 transition group-hover:opacity-100"
                                  size="icon-sm"
                                  @click.stop="
                                    removeTeamPhoto(membership.teamId)
                                  "
                                >
                                  <IconX />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Remove team photo</TooltipContent>
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
                      {{ df.format(membership.createdAt.toDate()) }}
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
                              Switch
                            </template>
                          </Button>
                          <Button v-else variant="outline" disabled>
                            <IconCheck />
                            Current
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
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      :disabled="!canExitTeam(membership)"
                                      @click="
                                        exitTeamDialog.open(membership.team!)
                                      "
                                    >
                                      <IconLogOut />
                                      Exit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator
                                      v-if="membership.role === 'owner'"
                                    />
                                    <DropdownMenuItem
                                      v-if="canDeleteTeam(membership)"
                                      @click="
                                        openTeamDialog('edit', membership.team!)
                                      "
                                    >
                                      <IconPencil />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      v-if="canDeleteTeam(membership)"
                                      @click="
                                        deleteTeamDialog.open(membership.team!)
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
                  <TableRow v-if="memberships.length === 0">
                    <TableCell
                      colspan="4"
                      class="text-muted-foreground h-24 text-center"
                    >
                      No teams found.
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

  <!-- Exit Team Dialog -->
  <AlertDialog v-model:open="exitTeamDialog.isOpen.value">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Exit Team</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to leave
          <span class="text-foreground font-medium">{{
            exitTeamDialog.item.value?.name
          }}</span
          >? You will lose access to all team resources.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
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
          Exit Team
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Delete Team Dialog -->
  <AlertDialog v-model:open="deleteTeamDialog.isOpen.value">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete Team</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete
          <span class="text-foreground font-medium">{{
            deleteTeamDialog.item.value?.name
          }}</span
          >? This action cannot be undone and will permanently delete the team
          and all its workspaces.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
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
          Delete Team
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

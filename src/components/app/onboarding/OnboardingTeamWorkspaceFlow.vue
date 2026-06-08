<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconBriefcase,
  IconCheck,
  IconPlus,
  IconSwitchHorizontal,
  IconUsers,
} from "@/data/icons"

const { t } = useI18n()

const {
  currentTeam,
  memberships,
  isLoading: isTeamLoading,
  loading: teamLoading,
  canCreateTeam,
  getCannotCreateTeamReason,
  switchTeam,
  createTeam,
} = useTeamActions()

const {
  currentWorkspace,
  workspaces,
  isLoading: isWorkspaceLoading,
  loading: workspaceLoading,
  canCreateWorkspace,
  getCannotCreateWorkspaceReason,
  switchWorkspace,
  createWorkspace,
} = useWorkspaceActions()

const newTeamName = ref("")
const newWorkspaceName = ref("")
const newWorkspaceDescription = ref("")

const isCreatingTeam = computed(() => teamLoading.team.isLoading("create"))
const isCreatingWorkspace = computed(() => workspaceLoading.isLoading("create"))

const createTeamDisabled = computed(
  () =>
    !canCreateTeam.value || !newTeamName.value.trim() || isCreatingTeam.value
)
const createWorkspaceDisabled = computed(
  () =>
    !canCreateWorkspace.value ||
    !newWorkspaceName.value.trim() ||
    isCreatingWorkspace.value
)

const handleCreateTeam = async () => {
  const name = newTeamName.value.trim()
  if (!name || !canCreateTeam.value) return

  await createTeam(name)
  newTeamName.value = ""
}

const handleCreateWorkspace = async () => {
  const name = newWorkspaceName.value.trim()
  if (!name || !canCreateWorkspace.value) return

  await createWorkspace(name, newWorkspaceDescription.value.trim() || undefined)
  newWorkspaceName.value = ""
  newWorkspaceDescription.value = ""
}
</script>

<template>
  <div class="p-4">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="onboarding-team-name">{{
              t("pages.welcome.onboarding.teamWorkspaceFlow.createTeam")
            }}</FieldLabel>
            <FieldDescription>
              {{
                t(
                  "pages.welcome.onboarding.teamWorkspaceFlow.createTeamDescription"
                )
              }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div class="flex w-full max-w-md gap-2">
                  <Input
                    id="onboarding-team-name"
                    v-model="newTeamName"
                    :placeholder="
                      t(
                        'pages.welcome.onboarding.teamWorkspaceFlow.teamNamePlaceholder'
                      )
                    "
                    :disabled="!canCreateTeam"
                    @keyup.enter="handleCreateTeam"
                  />
                  <Button
                    :disabled="createTeamDisabled"
                    @click="handleCreateTeam"
                  >
                    <Spinner v-if="isCreatingTeam" />
                    <template v-else>
                      <IconPlus />
                      {{
                        t("pages.welcome.onboarding.teamWorkspaceFlow.create")
                      }}
                    </template>
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canCreateTeam">
                {{ getCannotCreateTeamReason }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{{
              t("pages.welcome.onboarding.teamWorkspaceFlow.switchTeam")
            }}</FieldLabel>
            <FieldDescription>
              {{
                t(
                  "pages.welcome.onboarding.teamWorkspaceFlow.switchTeamDescription"
                )
              }}
            </FieldDescription>

            <LoadingState v-if="isTeamLoading" />
            <div v-else class="mt-3 space-y-2">
              <div
                v-for="membership in memberships"
                :key="membership.teamId"
                class="flex items-center justify-between border px-3 py-2"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">
                    {{
                      membership.team?.name ||
                      t(
                        "pages.welcome.onboarding.teamWorkspaceFlow.untitledTeam"
                      )
                    }}
                  </p>
                  <p class="text-muted-foreground text-xs capitalize">
                    {{ membership.role }}
                  </p>
                </div>
                <Button
                  v-if="currentTeam?.id !== membership.team?.id"
                  variant="outline"
                  :disabled="
                    !membership.team?.id ||
                    teamLoading.team.isLoading(membership.team.id)
                  "
                  @click="membership.team?.id && switchTeam(membership.team.id)"
                >
                  <Spinner
                    v-if="teamLoading.team.isLoading(membership.team?.id)"
                  />
                  <template v-else>
                    <IconSwitchHorizontal />
                    {{ t("pages.welcome.onboarding.teamWorkspaceFlow.switch") }}
                  </template>
                </Button>
                <Button v-else variant="outline" disabled>
                  <IconCheck />
                  {{ t("pages.welcome.onboarding.teamWorkspaceFlow.current") }}
                </Button>
              </div>
              <Empty
                v-if="memberships.length === 0"
                class="rounded-md border p-6"
              >
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconUsers />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{
                      t("pages.welcome.onboarding.teamWorkspaceFlow.noTeams")
                    }}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            </div>
          </FieldContent>
        </Field>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="onboarding-workspace-name">
              {{
                t("pages.welcome.onboarding.teamWorkspaceFlow.createWorkspace")
              }}
            </FieldLabel>
            <FieldDescription>
              {{
                t(
                  "pages.welcome.onboarding.teamWorkspaceFlow.createWorkspaceDescription"
                )
              }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div class="flex w-full max-w-md flex-col gap-2">
                  <Input
                    id="onboarding-workspace-name"
                    v-model="newWorkspaceName"
                    :placeholder="
                      t(
                        'pages.welcome.onboarding.teamWorkspaceFlow.workspaceNamePlaceholder'
                      )
                    "
                    :disabled="!canCreateWorkspace"
                    @keyup.enter="handleCreateWorkspace"
                  />
                  <Input
                    id="onboarding-workspace-description"
                    v-model="newWorkspaceDescription"
                    :placeholder="
                      t(
                        'pages.welcome.onboarding.teamWorkspaceFlow.workspaceDescriptionPlaceholder'
                      )
                    "
                    :disabled="!canCreateWorkspace"
                    @keyup.enter="handleCreateWorkspace"
                  />
                  <Button
                    :disabled="createWorkspaceDisabled"
                    @click="handleCreateWorkspace"
                  >
                    <Spinner v-if="isCreatingWorkspace" />
                    <template v-else>
                      <IconPlus />
                      {{
                        t("pages.welcome.onboarding.teamWorkspaceFlow.create")
                      }}
                    </template>
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
          <FieldContent>
            <FieldLabel>{{
              t("pages.welcome.onboarding.teamWorkspaceFlow.switchWorkspace")
            }}</FieldLabel>
            <FieldDescription>
              {{
                t(
                  "pages.welcome.onboarding.teamWorkspaceFlow.switchWorkspaceDescription"
                )
              }}
            </FieldDescription>

            <LoadingState v-if="isWorkspaceLoading" />
            <div v-else class="mt-3 space-y-2">
              <div
                v-for="workspace in workspaces"
                :key="workspace.id"
                class="flex items-center justify-between border px-3 py-2"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">
                    {{ workspace.name }}
                  </p>
                  <p class="text-muted-foreground truncate text-xs">
                    {{
                      workspace.description ||
                      t(
                        "pages.welcome.onboarding.teamWorkspaceFlow.noDescription"
                      )
                    }}
                  </p>
                </div>
                <Button
                  v-if="currentWorkspace?.id !== workspace.id"
                  variant="outline"
                  :disabled="workspaceLoading.isLoading(workspace.id)"
                  @click="switchWorkspace(workspace.id)"
                >
                  <Spinner v-if="workspaceLoading.isLoading(workspace.id)" />
                  <template v-else>
                    <IconSwitchHorizontal />
                    {{ t("pages.welcome.onboarding.teamWorkspaceFlow.switch") }}
                  </template>
                </Button>
                <Button v-else variant="outline" disabled>
                  <IconCheck />
                  {{ t("pages.welcome.onboarding.teamWorkspaceFlow.current") }}
                </Button>
              </div>
              <Empty
                v-if="workspaces.length === 0"
                class="rounded-md border p-6"
              >
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconBriefcase />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{
                      t(
                        "pages.welcome.onboarding.teamWorkspaceFlow.noWorkspaces"
                      )
                    }}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            </div>
          </FieldContent>
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>

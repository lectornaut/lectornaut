<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { IconCirclePlus, IconUsers } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Teams",
    breadcrumb: "Teams",
  },
})

useHead({
  title: "Teams",
})

const { t } = useI18n()

const {
  memberships,
  currentTeam,
  isLoading,
  getTeamMemberCount,
  canCreateTeam,
  getCannotCreateTeamReason,
} = useTeamActions()

const isCreatingTeamDialogOpen = ref(false)
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none scroll-smooth">
    <div class="mx-auto flex w-full max-w-md flex-col gap-2 p-2">
      <!-- Header -->
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Logo class="text-muted-foreground size-6" />
          </EmptyMedia>
          <EmptyTitle>
            {{ t("pages.teams.title") }}
          </EmptyTitle>
          <EmptyDescription>
            {{ t("pages.teams.description") }}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Button
                    :disabled="!canCreateTeam"
                    @click="canCreateTeam && (isCreatingTeamDialogOpen = true)"
                  >
                    <IconCirclePlus />
                    {{ t("pages.teams.createTeam") }}
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent v-if="!canCreateTeam">
                {{ t(getCannotCreateTeamReason || "") }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </EmptyContent>
      </Empty>

      <!-- Loading State -->
      <div v-if="isLoading" class="flex justify-center p-12">
        <Spinner />
      </div>

      <!-- Empty State -->
      <Empty v-else-if="memberships.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconUsers class="text-muted-foreground size-12" />
          </EmptyMedia>
          <EmptyTitle>{{ t("pages.teams.empty.title") }}</EmptyTitle>
          <EmptyDescription>
            {{ t("pages.teams.empty.description") }}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button @click="isCreatingTeamDialogOpen = true">
            <IconCirclePlus />
            {{ t("pages.teams.createTeam") }}
          </Button>
        </EmptyContent>
      </Empty>

      <!-- Teams Grid -->
      <ItemGroup v-else class="grid grid-cols-1 gap-2">
        <Item
          v-for="membership in memberships"
          :key="membership.teamId"
          as-child
        >
          <RouterLink :to="`/teams/${membership.teamId}`">
            <ItemMedia>
              <Avatar class="rounded-md">
                <AvatarImage
                  class="rounded-md"
                  :src="membership.team.photoURL!"
                  :alt="membership.team.name"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback class="rounded-md">
                  {{ getInitials(membership.team.name) }}
                </AvatarFallback>
              </Avatar>
            </ItemMedia>
            <ItemContent class="gap-0.5 truncate">
              <ItemTitle class="truncate">
                {{ membership.team.name }}
              </ItemTitle>
              <ItemDescription class="truncate text-xs">
                {{
                  t("pages.teams.memberCount", {
                    count: getTeamMemberCount(membership.teamId),
                  })
                }}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge
                v-if="currentTeam?.id === membership.teamId"
                variant="secondary"
              >
                {{ t("pages.teams.active") }}
              </Badge>
              <Badge variant="outline">
                {{ t(`components.teamDialog.roles.${membership.role}`) }}
              </Badge>
            </ItemActions>
          </RouterLink>
        </Item>
      </ItemGroup>
    </div>
  </div>

  <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
</template>

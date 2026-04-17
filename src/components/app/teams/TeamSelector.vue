<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { IconCirclePlus, IconLogOut, IconUsers } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import type { AcceptableValue } from "reka-ui"

const { t } = useI18n()

const {
  currentTeam,
  memberships,
  isLoading,
  canCreateTeam,
  getCannotCreateTeamReason,
  switchTeam,
} = useTeamActions()

const isCreatingTeamDialogOpen = ref(false)

const computedTeams = computed(() =>
  memberships.value.map((m) => ({
    label: m.team.name,
    value: m.team.id,
    original: m.team,
  }))
)

const handleSwitchTeam = async (teamId: AcceptableValue) => {
  if (typeof teamId !== "string") return
  await switchTeam(teamId)
}
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <IconUsers />
      </EmptyMedia>
      <EmptyTitle>{{ t("components.teamSelector.title") }}</EmptyTitle>
      <EmptyDescription>
        {{ t("components.teamSelector.description") }}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent
      class="bg-background flex max-w-xs flex-col items-stretch gap-2 rounded-xl border p-2"
    >
      <div v-if="isLoading" class="flex justify-center p-4">
        <Spinner />
      </div>
      <Select
        v-else
        :model-value="currentTeam?.id"
        @update:model-value="handleSwitchTeam"
      >
        <SelectTrigger class="w-full">
          <SelectValue
            :placeholder="t('components.teamSelector.placeholder')"
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel v-if="computedTeams.length === 0">
              {{ t("components.teamSelector.noTeams") }}
            </SelectLabel>
            <SelectItem
              v-for="team in computedTeams"
              :key="team.value"
              :value="team.value"
            >
              <div class="flex items-center gap-2">
                <Avatar class="size-4">
                  <AvatarImage
                    :src="team.original?.photoURL!"
                    :alt="team.label"
                    class="size-4"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback class="size-4">
                    {{ getInitials(team.label) }}
                  </AvatarFallback>
                </Avatar>
                {{ team.label }}
              </div>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <div class="grid">
              <Button
                variant="secondary"
                class="justify-start"
                :disabled="!canCreateTeam"
                @click="isCreatingTeamDialogOpen = true"
              >
                <IconCirclePlus />
                {{ t("components.teamSelector.createTeam") }}
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent v-if="!canCreateTeam">
            {{ getCannotCreateTeamReason }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </EmptyContent>
    <Button variant="outline" @click="emitter.emit('Dialog.Exit.Open')">
      <IconLogOut />
      {{ t("components.teamSelector.logout") }}
    </Button>
    <TeamDialog v-model:open="isCreatingTeamDialogOpen" mode="create" />
  </Empty>
</template>

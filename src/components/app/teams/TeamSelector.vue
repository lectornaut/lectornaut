<script lang="ts" setup>
import { useTeamActions } from "@/composables/useTeamActions"
import { IconCirclePlus, IconLogOut, IconUsers } from "@/data/icons"
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

const isCreateTeamDialogOpen = ref(false)

// Flatten the user's memberships into select options.
const teamOptions = computed(() =>
  memberships.value.map((m) => ({
    label: m.team.name,
    value: m.team.id,
    original: m.team,
  }))
)

const onSelectTeam = (value: AcceptableValue) => {
  if (typeof value === "string") void switchTeam(value)
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
      <LoadingState v-if="isLoading" />
      <Select
        v-else
        :model-value="currentTeam?.id"
        @update:model-value="onSelectTeam"
      >
        <SelectTrigger class="w-full">
          <SelectValue
            :placeholder="t('components.teamSelector.placeholder')"
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel v-if="teamOptions.length === 0">
              {{ t("components.teamSelector.noTeams") }}
            </SelectLabel>
            <SelectItem
              v-for="team in teamOptions"
              :key="team.value"
              :value="team.value"
            >
              <div class="flex items-center gap-2">
                <AppAvatar
                  class="size-4"
                  :src="team.original?.photoURL"
                  :name="team.label"
                />
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
                @click="isCreateTeamDialogOpen = true"
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
    <TeamDialog v-model:open="isCreateTeamDialogOpen" mode="create" />
  </Empty>
</template>

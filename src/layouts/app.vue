<script lang="ts" setup>
import { isTauri } from "@/composables/usePlatform"
import { useTeamActions } from "@/composables/useTeamActions"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import { emitter } from "@/modules/mitt"
import { useBillingStore } from "@/stores/billingStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { listen } from "@tauri-apps/api/event"
import { storeToRefs } from "pinia"

const { currentTeam, isLoading: isTeamLoading } = useTeamActions()

const { currentWorkspace, isBootstrapping: isWorkspaceBootstrapping } =
  useWorkspaceActions()
const layoutStore = useLayoutStore()
const { sidebarOpen } = storeToRefs(layoutStore)

const billingStore = useBillingStore()
const { canUseFeature } = billingStore

const hasPaidPlan = computed(() => canUseFeature("paid"))

const teamPlanGateSkipMap = useLocalStorage<Record<string, true>>(
  "team-plan-gate-skip-map",
  {}
)

const isPlanGateSkippedForCurrentTeam = computed(() => {
  const teamId = currentTeam.value?.id
  if (!teamId) return false
  return Boolean(teamPlanGateSkipMap.value[teamId])
})

const showTeamPlanSelector = computed(() => {
  if (!currentTeam.value?.id || !currentWorkspace.value?.id) return false
  return !hasPaidPlan.value && !isPlanGateSkippedForCurrentTeam.value
})

const skipTeamPlanGateForCurrentTeam = () => {
  const teamId = currentTeam.value?.id
  if (!teamId) return

  teamPlanGateSkipMap.value = {
    ...teamPlanGateSkipMap.value,
    [teamId]: true,
  }
}

watch(
  [() => currentTeam.value?.id, hasPaidPlan],
  ([teamId, hasActive]) => {
    if (!teamId || !hasActive || !teamPlanGateSkipMap.value[teamId]) {
      return
    }

    const nextSkippedMap = { ...teamPlanGateSkipMap.value }
    delete nextSkippedMap[teamId]
    teamPlanGateSkipMap.value = nextSkippedMap
  },
  { immediate: true }
)

onMounted(async () => {
  if (isTauri.value) {
    await listen("tray-action", (event) => {
      console.log("Tray action received:", event.payload)
      if (event.payload === "settings") {
        emitter.emit("Dialog.Settings.Open", "preferences")
      }
    })
  }
})
</script>

<template>
  <SidebarProvider v-model:open="sidebarOpen">
    <div class="flex size-full min-h-0 min-w-0 grow flex-col overflow-clip">
      <div class="flex min-h-0 min-w-0 grow">
        <Spinner
          v-if="isTeamLoading || isWorkspaceBootstrapping"
          class="m-auto"
        />
        <TeamSelector v-else-if="!currentTeam" />
        <WorkspaceSelector v-else-if="!currentWorkspace" />
        <TeamPlanSelector
          v-else-if="showTeamPlanSelector"
          @skip="skipTeamPlanGateForCurrentTeam"
        />
        <MainLayout v-else />
      </div>
    </div>
    <CommandK />
    <Changelog />
    <Shortcuts />
    <Settings />
  </SidebarProvider>
</template>

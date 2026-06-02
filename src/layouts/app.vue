<script lang="ts" setup>
import { isTauri } from "@/composables/usePlatform"
import { useTeamActions } from "@/composables/useTeamActions"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import { emitter } from "@/modules/mitt"
import { useBillingStore } from "@/stores/billingStore"
import { useLayoutStore } from "@/stores/layoutStore"
import { useSettingsStore } from "@/stores/settingsStore"
import type { IWorkflow } from "@/types/domain"
import { listen } from "@tauri-apps/api/event"
import { storeToRefs } from "pinia"

const { currentTeam, isLoading: isTeamLoading } = useTeamActions()

const { currentWorkspace, isBootstrapping: isWorkspaceBootstrapping } =
  useWorkspaceActions()
const layoutStore = useLayoutStore()
const { sidebarOpen } = storeToRefs(layoutStore)

const settingsStore = useSettingsStore()
const { themeSettings } = storeToRefs(settingsStore)

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

// Global custom-workflow editor — the sibling of the agents/tools dialogs
// below, opened via `Dialog.CustomWorkflow.Open` (no payload = create, an
// IWorkflow = edit). Mounted lazily on first open so the workflows store isn't
// instantiated until a surface (e.g. the sidebar "Create New" menu) needs it.
const workflowEditorMounted = ref(false)
const workflowEditorOpen = ref(false)
const editingWorkflow = ref<IWorkflow | null>(null)
const openWorkflowEditor = async (payload: unknown) => {
  editingWorkflow.value =
    payload && typeof payload === "object" ? (payload as IWorkflow) : null
  // Mount closed first, then open on the next tick: the editor seeds its form
  // on the dialog's false→true transition, which wouldn't fire if it mounted
  // already-open.
  if (!workflowEditorMounted.value) {
    workflowEditorMounted.value = true
    await nextTick()
  }
  workflowEditorOpen.value = true
}
emitter.on("Dialog.CustomWorkflow.Open", openWorkflowEditor)
onBeforeUnmount(() =>
  emitter.off("Dialog.CustomWorkflow.Open", openWorkflowEditor)
)
</script>

<template>
  <SidebarProvider
    v-model:open="sidebarOpen"
    :class="{ 'bg-transparent!': themeSettings.translucentSidebar }"
  >
    <div class="flex size-full min-h-0 min-w-0 grow flex-col overflow-clip">
      <div class="flex min-h-0 min-w-0 grow" data-tauri-drag-region>
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
    <!--
      Global custom agents management dialog. Mounted at the app
      layout level so any surface (Settings → Tools cog, Agents
      sidebar "New agent" button) can open it via the
      `Dialog.CustomAgents.Open` mitt event without needing the
      Settings dialog to be open first.
    -->
    <SettingsCustomAgents />
    <!--
      Custom tools editor dialog — sibling of the custom agents
      dialog. Listens for `Dialog.CustomTools.Open` so settings rows
      (and, in the future, the composer's tool drawer) can open it
      from anywhere without depending on the Settings shell.
    -->
    <SettingsCustomTools />
    <!--
      Custom workflow editor dialog — same global-dialog pattern as the
      agents/tools dialogs above, but mounted lazily (the workflows store is
      heavier) once `Dialog.CustomWorkflow.Open` first fires.
    -->
    <SettingsCustomWorkflow
      v-if="workflowEditorMounted"
      v-model:open="workflowEditorOpen"
      :workflow="editingWorkflow"
    />
  </SidebarProvider>
</template>

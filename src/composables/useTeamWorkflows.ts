/**
 * useTeamWorkflows — admin-facing wrapper over `teamWorkflowsStore`. Adds the
 * owner/admin permission gate (`canManage`) and toasts on every mutation,
 * mirroring `useTeamAgents`. The store owns the live reads; this owns the UX.
 */

import type {
  CreateWorkflowDraft,
  UpdateWorkflowPatch,
  WorkflowReviewDecision,
} from "@/composables/useFunctions"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamWorkflowsStore } from "@/stores/teamWorkflowsStore"
import { storeToRefs } from "pinia"
import { computed } from "vue"
import { toast } from "vue-sonner"

export function useTeamWorkflows() {
  const { t } = useI18n()
  const store = useTeamWorkflowsStore()
  const {
    workflows,
    activeWorkflows,
    archivedWorkflows,
    wsActiveWorkflows,
    wsArchivedWorkflows,
    wsDeployedPresetKeys,
    availablePresetKeys,
    recentRuns,
    awaitingReviewRuns,
    isLoading,
    isSaving,
    loadError,
  } = storeToRefs(store)

  const membershipStore = useMembershipStore()
  const { isOwner, isAdmin } = storeToRefs(membershipStore)
  const canManage = computed(() => isOwner.value || isAdmin.value)

  /**
   * Defense-in-depth gate. The UI's action buttons are `:disabled` for
   * non-admins, so reaching here means a programmatic call slipped through.
   */
  const guardManage = (): boolean => {
    if (canManage.value) return true
    toast.error(t("settings.workflows.permissionRequired"))
    return false
  }

  const create = async (draft: CreateWorkflowDraft): Promise<string | null> => {
    if (!guardManage()) return null
    try {
      const id = await store.create(draft)
      toast.success(t("settings.workflows.createSuccess"))
      return id
    } catch (error) {
      console.error("[useTeamWorkflows] create failed:", error)
      toast.error(messageOf(error, t("settings.workflows.createError")))
      throw error
    }
  }

  const update = async (
    workflowId: string,
    patch: UpdateWorkflowPatch
  ): Promise<boolean> => {
    if (!guardManage()) return false
    try {
      await store.update(workflowId, patch)
      toast.success(t("settings.workflows.updateSuccess"))
      return true
    } catch (error) {
      console.error("[useTeamWorkflows] update failed:", error)
      toast.error(messageOf(error, t("settings.workflows.updateError")))
      throw error
    }
  }

  const setEnabled = async (
    workflowId: string,
    enabled: boolean
  ): Promise<void> => {
    if (!guardManage()) return
    try {
      await store.setEnabled(workflowId, enabled)
      toast.success(
        enabled
          ? t("settings.workflows.enableSuccess")
          : t("settings.workflows.disableSuccess")
      )
    } catch (error) {
      console.error("[useTeamWorkflows] setEnabled failed:", error)
      toast.error(t("settings.workflows.updateError"))
      throw error
    }
  }

  const archive = async (
    workflowId: string,
    archived: boolean
  ): Promise<void> => {
    if (!guardManage()) return
    try {
      await store.archive(workflowId, archived)
      toast.success(
        archived
          ? t("settings.workflows.archiveSuccess")
          : t("settings.workflows.restoreSuccess")
      )
    } catch (error) {
      console.error("[useTeamWorkflows] archive failed:", error)
      toast.error(t("settings.workflows.updateError"))
      throw error
    }
  }

  const remove = async (workflowId: string): Promise<void> => {
    if (!guardManage()) return
    try {
      await store.remove(workflowId)
      toast.success(t("settings.workflows.deleteSuccess"))
    } catch (error) {
      console.error("[useTeamWorkflows] remove failed:", error)
      toast.error(t("settings.workflows.deleteError"))
      throw error
    }
  }

  const runNow = async (workflowId: string): Promise<void> => {
    if (!guardManage()) return
    try {
      await store.runNow(workflowId)
      toast.success(t("settings.workflows.runQueued"))
    } catch (error) {
      console.error("[useTeamWorkflows] runNow failed:", error)
      toast.error(messageOf(error, t("settings.workflows.runError")))
      throw error
    }
  }

  const reviewRun = async (
    runId: string,
    decision: WorkflowReviewDecision
  ): Promise<void> => {
    if (!guardManage()) return
    try {
      await store.reviewRun(runId, decision)
      toast.success(
        decision === "approve"
          ? t("settings.workflows.reviewApproved")
          : t("settings.workflows.reviewRejected")
      )
    } catch (error) {
      console.error("[useTeamWorkflows] reviewRun failed:", error)
      toast.error(messageOf(error, t("settings.workflows.reviewError")))
      throw error
    }
  }

  const removeRun = async (runId: string): Promise<void> => {
    if (!guardManage()) return
    try {
      await store.removeRun(runId)
      toast.success(t("settings.workflows.deleteRunSuccess"))
    } catch (error) {
      console.error("[useTeamWorkflows] removeRun failed:", error)
      toast.error(messageOf(error, t("settings.workflows.deleteRunError")))
      throw error
    }
  }

  const enablePreset = async (
    presetKey: string,
    binding: { workspaceId: string; agentId: string }
  ): Promise<string | null> => {
    if (!guardManage()) return null
    try {
      const id = await store.enablePreset(presetKey, binding)
      toast.success(t("settings.workflows.presetEnabled"))
      return id
    } catch (error) {
      console.error("[useTeamWorkflows] enablePreset failed:", error)
      toast.error(messageOf(error, t("settings.workflows.createError")))
      throw error
    }
  }

  return {
    workflows,
    activeWorkflows,
    archivedWorkflows,
    wsActiveWorkflows,
    wsArchivedWorkflows,
    wsDeployedPresetKeys,
    availablePresetKeys,
    recentRuns,
    awaitingReviewRuns,
    runsForWorkflow: store.runsForWorkflow,
    isLoading,
    isSaving,
    loadError,
    canManage,
    create,
    update,
    setEnabled,
    archive,
    remove,
    runNow,
    reviewRun,
    removeRun,
    enablePreset,
  }
}

/** Surface a server HttpsError message (e.g. budget/precondition) when present. */
function messageOf(error: unknown, fallback: string): string {
  const msg = (error as { message?: unknown })?.message
  return typeof msg === "string" && msg.length > 0 ? msg : fallback
}

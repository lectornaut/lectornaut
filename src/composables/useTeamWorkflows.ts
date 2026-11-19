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
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import {
  useTeamWorkflowsStore,
  workflowSubscriberRef,
} from "@/stores/teamWorkflowsStore"
import type { IWorkflow } from "@/types/domain"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { storeToRefs } from "pinia"
import { computed, toValue, type MaybeRefOrGetter } from "vue"
import { toast } from "vue-sonner"

/**
 * The current user's standing on a workflow, from their own opt-in doc (the
 * only one a member may read):
 *   `none`    a shared workflow, nothing to opt in to
 *   `off`     not opted in
 *   `on`      opted in to the current instructions, agent and connected apps
 *   `stale`   opted in before the instructions were edited
 *   `changed` opted in before the agent or its connected apps changed
 *   `failed`  paused by the server after repeated failed runs
 * Everything but `on` means no runs; the last three need the member to turn
 * "Run for me" on again.
 */
export type WorkflowSubscriptionState =
  "none" | "off" | "on" | "stale" | "changed" | "failed"

export function useWorkflowSubscription(
  workflow: MaybeRefOrGetter<IWorkflow | null | undefined>
) {
  const authStore = useAuthStore()
  const { isOwner, isAdmin } = storeToRefs(useMembershipStore())
  const personal = computed(() => {
    const wf = toValue(workflow)
    return wf?.audience === "personal" ? wf : null
  })
  const { data: subscription } = useDocumentQuery(() => {
    const uid = authStore.currentUser?.uid
    return personal.value && uid
      ? workflowSubscriberRef(personal.value, uid)
      : null
  })
  const state = computed<WorkflowSubscriptionState>(() => {
    const wf = personal.value
    if (!wf) return "none"
    const sub = subscription.value
    if (!sub) return "off"
    if (sub.paused === "failures") return "failed"
    if (sub.approvedRev !== wf.consentRev) return "stale"
    return sub.paused === "tools" ? "changed" : "on"
  })
  /** A per-member workflow runs for whoever opted in; a shared one is admin-run. */
  const canRun = computed(() =>
    personal.value ? state.value === "on" : isOwner.value || isAdmin.value
  )
  return {
    state,
    canRun,
    /** The member's own opt-in (their last run + "Notify me"), if any. */
    subscription: computed(() => (personal.value ? subscription.value : null)),
  }
}

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

  const setSubscribed = async (
    workflowId: string,
    subscribed: boolean
  ): Promise<void> => {
    try {
      await store.setSubscribed(workflowId, subscribed)
      toast.success(
        subscribed
          ? t("settings.workflows.subscribeOn")
          : t("settings.workflows.subscribeOff")
      )
    } catch (error) {
      console.error("[useTeamWorkflows] setSubscribed failed:", error)
      toast.error(messageOf(error, t("settings.workflows.subscribeError")))
    }
  }

  const setNotify = async (
    workflowId: string,
    notify: boolean
  ): Promise<void> => {
    try {
      await store.setNotify(workflowId, notify)
    } catch (error) {
      console.error("[useTeamWorkflows] setNotify failed:", error)
      toast.error(messageOf(error, t("settings.workflows.notifyError")))
    }
  }

  const runNow = async (workflowId: string): Promise<void> => {
    // A per-member workflow runs for the caller (the server checks their
    // opt-in); a shared one is an admin action.
    const wf = workflows.value.find((w) => w.id === workflowId)
    if (wf?.audience !== "personal" && !guardManage()) return
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
    // Staged under instructions the workflow no longer has: approving is
    // still allowed, but only as an explicit choice (the server enforces it).
    const stale = decision === "approve" && store.isRunPromptStale(runId)
    if (
      stale &&
      typeof window !== "undefined" &&
      !window.confirm(t("settings.workflows.reviewStaleConfirm"))
    )
      return
    try {
      await store.reviewRun(runId, decision, stale)
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
    setSubscribed,
    setNotify,
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

/**
 * useIntegrations — owner/admin actions for the unified Integrations surface:
 * install / uninstall / enable / create / edit / delete across the three
 * integration types, all backed by the single `teams/{teamId}/integrations`
 * collection.
 *
 *   - **Agents / Tools** — the unified `integration*` callables
 *     (`installIntegration` / `uninstallIntegration` / `setIntegrationEnabled`
 *     / `createIntegration` / `updateIntegration` / `deleteIntegration`).
 *     Install = an active doc/overlay exists; a built-in with no divergence doc
 *     is installed-by-default (catalog overlay in `integrationsStore`).
 *   - **Workflows** — keep their dedicated store/callables for now
 *     (`teamWorkflowsStore.addPreset` / `removePreset` materialize/soft-archive
 *     a `type: "workflow"` doc in the same collection). The client registry
 *     routes per type so the page treats all three uniformly.
 *
 * Reads of installed/enabled state live in `integrationsStore` (agents+tools,
 * with the same catalog overlay as the server) and `teamWorkflowsStore`
 * (workflows). This composable owns the write actions + their permission gate
 * and Integrations-specific toasts.
 */

import {
  createIntegration as createIntegrationFn,
  deleteIntegration as deleteIntegrationFn,
  installIntegration as installIntegrationFn,
  setIntegrationEnabled as setIntegrationEnabledFn,
  uninstallIntegration as uninstallIntegrationFn,
  updateIntegration as updateIntegrationFn,
} from "@/composables/useFunctions"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamWorkflowsStore } from "@/stores/teamWorkflowsStore"
import type {
  IAgentIntegrationDraft,
  IAgentIntegrationPatch,
  IToolIntegrationDraft,
  IToolIntegrationPatch,
} from "@/types/domain"
import { storeToRefs } from "pinia"
import { computed } from "vue"
import { toast } from "vue-sonner"

type AgentOrTool = "agent" | "tool"

export function useIntegrations() {
  const { t } = useI18n()

  const membershipStore = useMembershipStore()
  // Mirrors the server's `isAdminRole` gate (owner ∨ admin). The page hides the
  // action surface behind an admin wall, so this is mainly defense in depth —
  // the callables reject non-admins regardless.
  const { isOwner, isAdmin } = storeToRefs(membershipStore)
  const canManage = computed(() => isOwner.value || isAdmin.value)

  const workflowsStore = useTeamWorkflowsStore()

  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  const guardManage = (): boolean => {
    if (canManage.value) return true
    toast.error(t("settings.integrations.permissionRequired"))
    return false
  }

  const requireTeam = (): string | null => {
    const teamId = currentTeamId.value
    if (!teamId) {
      toast.error(t("settings.integrations.permissionRequired"))
      return null
    }
    return teamId
  }

  /** Run a mutation with the admin gate + success/error toasts. */
  const run = async (
    action: (teamId: string) => Promise<unknown>,
    messages: { success?: string; error: string }
  ): Promise<void> => {
    if (!guardManage()) return
    const teamId = requireTeam()
    if (!teamId) return
    try {
      await action(teamId)
      if (messages.success) toast.success(messages.success)
    } catch (error) {
      console.error("[useIntegrations] action failed:", error)
      toast.error(messageOf(error, messages.error))
      throw error
    }
  }

  // ── Built-in agents (install/uninstall = catalog membership) ─────────────
  const addBuiltInAgent = (sourceKey: string): Promise<void> =>
    run(
      (teamId) => installIntegrationFn({ teamId, type: "agent", sourceKey }),
      {
        success: t("settings.integrations.agents.addSuccess"),
        error: t("settings.integrations.agents.addError"),
      }
    )
  const removeBuiltInAgent = (sourceKey: string): Promise<void> =>
    run(
      (teamId) => uninstallIntegrationFn({ teamId, type: "agent", sourceKey }),
      {
        success: t("settings.integrations.agents.removeSuccess"),
        error: t("settings.integrations.agents.removeError"),
      }
    )

  // ── Built-in tools ───────────────────────────────────────────────────────
  const addBuiltInTool = (sourceKey: string): Promise<void> =>
    run((teamId) => installIntegrationFn({ teamId, type: "tool", sourceKey }), {
      success: t("settings.integrations.tools.addSuccess"),
      error: t("settings.integrations.tools.addError"),
    })
  const removeBuiltInTool = (sourceKey: string): Promise<void> =>
    run(
      (teamId) => uninstallIntegrationFn({ teamId, type: "tool", sourceKey }),
      {
        success: t("settings.integrations.tools.removeSuccess"),
        error: t("settings.integrations.tools.removeError"),
      }
    )

  // ── Workflows (team availability — the Integrations tier) ─────────────────
  // Toggling here records WHICH presets the team offers (workspace-agnostic).
  // Per-workspace deployment (enable + configure) lives on each workspace's
  // Workflows settings page, not here.
  const addWorkflowPreset = async (sourceKey: string): Promise<void> => {
    if (!guardManage()) return
    try {
      await workflowsStore.setAvailability(sourceKey, true)
      toast.success(t("settings.integrations.workflows.addSuccess"))
    } catch (error) {
      console.error("[useIntegrations] addWorkflowPreset failed:", error)
      toast.error(
        messageOf(error, t("settings.integrations.workflows.addError"))
      )
      throw error
    }
  }
  const removeWorkflowPreset = async (sourceKey: string): Promise<void> => {
    if (!guardManage()) return
    try {
      await workflowsStore.setAvailability(sourceKey, false)
      toast.success(t("settings.integrations.workflows.removeSuccess"))
    } catch (error) {
      console.error("[useIntegrations] removeWorkflowPreset failed:", error)
      toast.error(
        messageOf(error, t("settings.integrations.workflows.removeError"))
      )
      throw error
    }
  }

  // ── Generic CRUD + enable (agent | tool) for the unified management UI ───

  const createCustom = (
    type: AgentOrTool,
    draft: IAgentIntegrationDraft | IToolIntegrationDraft
  ): Promise<void> =>
    run((teamId) => createIntegrationFn({ teamId, type, draft }), {
      success: t(`settings.integrations.${type}s.addSuccess`),
      error: t(`settings.integrations.${type}s.addError`),
    })

  const update = (
    integrationId: string,
    patch: IAgentIntegrationPatch | IToolIntegrationPatch
  ): Promise<void> =>
    run((teamId) => updateIntegrationFn({ teamId, integrationId, patch }), {
      error: t("settings.integrations.permissionRequired"),
    })

  /** Enable/disable. Built-in with no doc yet: pass type + sourceKey. */
  const setEnabled = (
    target: { integrationId?: string; type?: AgentOrTool; sourceKey?: string },
    enabled: boolean
  ): Promise<void> =>
    run((teamId) => setIntegrationEnabledFn({ teamId, ...target, enabled }), {
      error: t("settings.integrations.permissionRequired"),
    })

  /** Re-install (un-archive) a custom integration by id. */
  const restore = (integrationId: string): Promise<void> =>
    run((teamId) => installIntegrationFn({ teamId, integrationId }), {
      error: t("settings.integrations.permissionRequired"),
    })

  /** Soft-archive (uninstall) any integration by id. */
  const uninstall = (integrationId: string): Promise<void> =>
    run((teamId) => uninstallIntegrationFn({ teamId, integrationId }), {
      error: t("settings.integrations.permissionRequired"),
    })

  /** Hard-delete a custom integration. */
  const remove = (integrationId: string): Promise<void> =>
    run((teamId) => deleteIntegrationFn({ teamId, integrationId }), {
      error: t("settings.integrations.permissionRequired"),
    })

  return {
    canManage,
    // Catalog membership (install/uninstall)
    addBuiltInAgent,
    removeBuiltInAgent,
    addBuiltInTool,
    removeBuiltInTool,
    addWorkflowPreset,
    removeWorkflowPreset,
    // Unified CRUD + enable
    createCustom,
    update,
    setEnabled,
    restore,
    uninstall,
    remove,
  }
}

/** Surface a server HttpsError message (e.g. precondition) when present. */
function messageOf(error: unknown, fallback: string): string {
  const msg = (error as { message?: unknown })?.message
  return typeof msg === "string" && msg.length > 0 ? msg : fallback
}

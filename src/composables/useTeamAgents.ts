/**
 * useTeamAgents — i18n-aware composable wrapper around
 * `useTeamAgentsStore`.
 *
 * The store owns the data plane (Firestore subscription, race-safe
 * team-switch handling, callable invocations). This wrapper adds two
 * UI-shaped concerns:
 *
 *   - **`canManage` / `cannotManageReason`** — admin-only writes,
 *     mirroring the server's `assertAdminRole` gate. Disables write
 *     UI for non-admins and surfaces a tooltip explaining why.
 *
 *   - **Toast handling** — i18n-keyed success/error messages for
 *     create / update / archive / restore. Takes an optional
 *     `messagesRef` getter so locale changes flow through without
 *     remounting consumers.
 *
 * Silent consumers (e.g. the composer reading `activeAgents` to render
 * badges) should bind to `useTeamAgentsStore()` directly and skip the
 * i18n / toast machinery — mirrors the `useAgentConfig` /
 * `useAgentConfigStore` split.
 */

import type {
  CreateTeamAgentDraft,
  UpdateTeamAgentPatch,
} from "@/composables/useFunctions"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import type { ITeamAgent } from "@/types/domain"
import { storeToRefs } from "pinia"
import { computed } from "vue"
import { toast } from "vue-sonner"

/**
 * Every key is optional so callers can opt out of individual toasts
 * without resorting to empty-string sentinels. Two real-world shapes:
 *
 *   - The inline list (`SettingsAgents`) provides every key — it owns
 *     lifecycle toasts (archive / restore / setEnabled / remove) AND
 *     CRUD echoes for actions admins trigger from rows.
 *
 *   - The editor dialog (`SettingsCustomAgents`) provides only the
 *     CRUD keys it owns (create / update). Lifecycle actions are
 *     dispatched here too (the dialog still wraps `useTeamAgents`),
 *     but their toasts are *already* surfaced by the inline list when
 *     the row fires them — re-emitting from the dialog would double-
 *     toast. Omitting the keys suppresses the duplicates cleanly.
 *
 * Implementation note: every handler in this composable reads its
 * message via `messagesRef?.().<key> ?? ""` and short-circuits with
 * `if (msg)`, so a missing/undefined key is a no-op toast.
 */
interface UseTeamAgentsI18n {
  permissionRequired?: string
  createSuccess?: string
  createError?: string
  updateSuccess?: string
  updateError?: string
  archiveSuccess?: string
  archiveError?: string
  restoreSuccess?: string
  restoreError?: string
  enableSuccess?: string
  disableSuccess?: string
  setEnabledError?: string
  deleteSuccess?: string
  deleteError?: string
}

/**
 * @param messagesRef Optional reactive getter for the i18n strings.
 *                    Passed as a function (not a snapshot object) so
 *                    locale changes flow through into toasts and the
 *                    `cannotManageReason` tooltip without remounting.
 *                    Omit for fully silent consumers; omit individual
 *                    keys to suppress just those toasts (no need for
 *                    empty-string sentinels).
 */
export function useTeamAgents(messagesRef?: () => UseTeamAgentsI18n) {
  const store = useTeamAgentsStore()
  const {
    agents,
    activeAgents,
    selectableAgents,
    disabledAgents,
    archivedAgents,
    isLoading,
    isSaving,
    loadError,
  } = storeToRefs(store)

  const membershipStore = useMembershipStore()
  // Mirrors the server's `assertAdminRole` gate. UI gating here is
  // affordance-only (disabled buttons + tooltips); writes that slip
  // through anyway are rejected by the callable with `permission-denied`.
  const { isOwner, isAdmin } = storeToRefs(membershipStore)

  const canManage = computed(() => isOwner.value || isAdmin.value)

  const cannotManageReason = computed(() => {
    if (canManage.value) return null
    const msg = messagesRef?.().permissionRequired ?? ""
    return msg.length > 0 ? msg : null
  })

  /**
   * Defense-in-depth gate. The UI's Save buttons are `:disabled`, so
   * reaching here means a programmatic call slipped through. Toast and
   * abort rather than letting the callable reject — keeps the UX
   * snappier than a server round-trip for a known-bad request.
   */
  const guardManage = (): boolean => {
    if (canManage.value) return true
    const msg = messagesRef?.().permissionRequired ?? ""
    if (msg) toast.error(msg)
    return false
  }

  const create = async (
    draft: CreateTeamAgentDraft
  ): Promise<ITeamAgent | null> => {
    if (!guardManage()) return null
    try {
      const agent = await store.create(draft)
      const okMsg = messagesRef?.().createSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return agent
    } catch (error) {
      console.error("[useTeamAgents] failed to create agent:", error)
      const errMsg = messagesRef?.().createError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  const update = async (
    agentId: string,
    patch: UpdateTeamAgentPatch
  ): Promise<ITeamAgent | null> => {
    if (!guardManage()) return null
    try {
      const agent = await store.update(agentId, patch)
      const okMsg = messagesRef?.().updateSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return agent
    } catch (error) {
      console.error("[useTeamAgents] failed to update agent:", error)
      const errMsg = messagesRef?.().updateError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  const archive = async (agentId: string): Promise<ITeamAgent | null> => {
    if (!guardManage()) return null
    try {
      const agent = await store.archive(agentId)
      const okMsg = messagesRef?.().archiveSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return agent
    } catch (error) {
      console.error("[useTeamAgents] failed to archive agent:", error)
      const errMsg = messagesRef?.().archiveError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  const restore = async (agentId: string): Promise<ITeamAgent | null> => {
    if (!guardManage()) return null
    try {
      const agent = await store.restore(agentId)
      const okMsg = messagesRef?.().restoreSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return agent
    } catch (error) {
      console.error("[useTeamAgents] failed to restore agent:", error)
      const errMsg = messagesRef?.().restoreError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  /**
   * Toggle an agent on/off (the row-level Switch). Different toast
   * copy per direction so the user sees a precise confirmation —
   * "Agent enabled" vs "Agent disabled" — rather than a generic
   * "Saved".
   */
  const setEnabled = async (
    agentId: string,
    enabled: boolean
  ): Promise<ITeamAgent | null> => {
    if (!guardManage()) return null
    try {
      const agent = await store.setEnabled(agentId, enabled)
      const okMsg = enabled
        ? (messagesRef?.().enableSuccess ?? "")
        : (messagesRef?.().disableSuccess ?? "")
      if (okMsg) toast.success(okMsg)
      return agent
    } catch (error) {
      console.error("[useTeamAgents] failed to toggle agent:", error)
      const errMsg = messagesRef?.().setEnabledError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  /**
   * Hard-delete an agent. The store returns `void` because the doc
   * is gone; callers that need the agent's record after the call
   * should snapshot it before. Surfaces a destructive toast on
   * success — the action is irreversible, so explicit feedback is
   * worth the extra noise.
   */
  const remove = async (agentId: string): Promise<boolean> => {
    if (!guardManage()) return false
    try {
      await store.remove(agentId)
      const okMsg = messagesRef?.().deleteSuccess ?? ""
      if (okMsg) toast.success(okMsg)
      return true
    } catch (error) {
      console.error("[useTeamAgents] failed to delete agent:", error)
      const errMsg = messagesRef?.().deleteError ?? ""
      if (errMsg) toast.error(errMsg)
      throw error
    }
  }

  return {
    agents,
    activeAgents,
    selectableAgents,
    disabledAgents,
    archivedAgents,
    isLoading,
    isSaving,
    loadError,
    canManage,
    cannotManageReason,
    create,
    update,
    archive,
    restore,
    setEnabled,
    remove,
  }
}

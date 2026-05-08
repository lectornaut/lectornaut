/**
 * useAgentConfig — load + persist the bot agent settings for the active
 * team. The agent config is a team-level resource; all workspaces in a
 * team share the same model, prompt, tools, and generation knobs.
 *
 * Backed by two callables in `functions/src/bot.ts`:
 *   - `getTeamAgentConfig` — open to all team members.
 *   - `updateTeamAgentConfig` — owner/admin only.
 *
 * The composable fetches on mount and again whenever the active team
 * changes.
 *
 * Exposed shape mirrors the other `*Actions` composables: `state`
 * + `loading` flags + `canEdit` permission gate + `save(patch)` action.
 * Consumers should not mutate `config.value` directly — keep a local
 * draft and call `save` once the user confirms.
 */

import {
  getTeamAgentConfig as getTeamAgentConfigFn,
  updateTeamAgentConfig as updateTeamAgentConfigFn,
  type UpdateTeamAgentConfigPatch,
} from "@/composables/useFunctions"
import { defaultBotAgentConfig } from "@/helpers/defaults"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IBotAgentConfig } from "@/types/domain"
import { storeToRefs } from "pinia"
import { computed, ref, watch } from "vue"
import { toast } from "vue-sonner"

interface UseAgentConfigI18n {
  permissionRequired: string
  saveSuccess: string
  saveError: string
  loadError: string
}

/**
 * @param messagesRef Reactive getter for the i18n strings. Passed as a
 *                    function (rather than a snapshot object) so that
 *                    locale changes flow through into toasts and the
 *                    `cannotEditReason` tooltip without remounting.
 *                    The composable stays i18n-agnostic — the caller
 *                    owns the `useI18n` binding.
 */
export function useAgentConfig(messagesRef: () => UseAgentConfigI18n) {
  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  const membershipStore = useMembershipStore()
  // Edit permission must mirror the server's `isAdminRole` gate
  // (owner ∨ admin). Using `canManageWorkspaces` would be wrong because
  // it also includes plain members (they have CREATE_WORKSPACE), and
  // the server rejects their writes with `permission-denied`.
  const { isOwner, isAdmin } = storeToRefs(membershipStore)

  // Effective config — always fully populated. Initialized to the client
  // defaults so the form has something to render before the first
  // callable response arrives. Reassigned wholesale on each fetch /
  // successful save so reactive bindings observe a single transition.
  const config = ref<IBotAgentConfig>({ ...defaultBotAgentConfig })
  const hasOverrides = ref(false)
  const isLoading = ref(false)
  const isSaving = ref(false)
  const loadError = ref<string | null>(null)

  /**
   * Reflects the server's `isAdminRole` gate (owner ∨ admin). UI gating
   * here is purely for affordance (disabled inputs + tooltip); the
   * server's `updateTeamAgentConfig` rejects non-admins anyway.
   */
  const canEdit = computed(() => isOwner.value || isAdmin.value)

  const cannotEditReason = computed(() =>
    canEdit.value ? null : messagesRef().permissionRequired
  )

  const refresh = async () => {
    const teamId = currentTeamId.value
    if (!teamId) {
      // Reset to defaults so the form doesn't show a stale team's
      // values while a new team is being loaded.
      config.value = { ...defaultBotAgentConfig }
      hasOverrides.value = false
      return
    }
    isLoading.value = true
    loadError.value = null
    try {
      const { data } = await getTeamAgentConfigFn({ teamId })
      config.value = data.config
      hasOverrides.value = data.hasOverrides
    } catch (error) {
      console.error("[useAgentConfig] failed to load config:", error)
      const msg = messagesRef().loadError
      loadError.value = msg
      toast.error(msg)
    } finally {
      isLoading.value = false
    }
  }

  const save = async (patch: UpdateTeamAgentConfigPatch) => {
    const teamId = currentTeamId.value
    if (!teamId) return
    if (!canEdit.value) {
      // Defense in depth — the form's Save button is `:disabled`, so
      // reaching here means a programmatic call slipped through. Toast
      // anyway since the user clearly intended to save.
      toast.error(messagesRef().permissionRequired)
      return
    }
    if (isSaving.value) return

    isSaving.value = true
    try {
      const { data } = await updateTeamAgentConfigFn({
        teamId,
        updates: patch,
      })
      // Server returns the fully-merged effective config — replace
      // wholesale so the form snaps to the canonical state.
      config.value = data.config
      hasOverrides.value = true
      toast.success(messagesRef().saveSuccess)
    } catch (error) {
      console.error("[useAgentConfig] failed to save config:", error)
      toast.error(messagesRef().saveError)
      // Re-throw so callers (e.g. the SettingsAgents form) can keep
      // their dirty draft visible — silent swallow would falsely
      // suggest the patch landed.
      throw error
    } finally {
      isSaving.value = false
    }
  }

  // Refetch whenever the active team flips. Immediate so the very first
  // mount triggers a load too.
  watch(
    currentTeamId,
    () => {
      refresh()
    },
    { immediate: true }
  )

  return {
    config,
    hasOverrides,
    isLoading,
    isSaving,
    loadError,
    canEdit,
    cannotEditReason,
    refresh,
    save,
  }
}

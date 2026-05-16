/**
 * Agent Config Store — single source of truth for the team's bot agent
 * configuration (model, prompts, tools, generation knobs, etc.).
 *
 * Two consumer surfaces share this store:
 *
 *   1. `useAgentConfig` (composable) — wraps the store with i18n toast
 *      bindings and a permission-aware `cannotEditReason` for the form
 *      in `SettingsAgents.vue`. The form is the canonical *writer*.
 *
 *   2. `useBotChat` (composable) — reads only, to seed the composer's
 *      mode from `config.defaultMode`. No writes.
 *
 * Storing the config here means an admin saving a new default in the
 * settings dialog instantly propagates to the open chat composer (no
 * navigate-away-and-back required, no stale-state window).
 *
 * Backed by two callables in `functions/src/bot.ts`:
 *   - `getTeamAgentConfig` — open to all team members.
 *   - `updateTeamAgentConfig` — owner/admin only.
 *
 * The store fetches on first mount and on `currentTeamId` change.
 * Concurrent fetches for different teams are race-safe: a response
 * tagged with a no-longer-current `teamId` is dropped instead of
 * clobbering newer state.
 */

import {
  getTeamAgentConfig as getTeamAgentConfigFn,
  updateTeamAgentConfig as updateTeamAgentConfigFn,
  type UpdateTeamAgentConfigPatch,
} from "@/composables/useFunctions"
import { defaultBotAgentConfig } from "@/helpers/defaults"
import { useAuthStore } from "@/stores/authStore"
import type { IBotAgentConfig } from "@/types/domain"
import { defineStore, storeToRefs } from "pinia"
import { ref, watch } from "vue"

export const useAgentConfigStore = defineStore("agentConfig", () => {
  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  /**
   * Effective config — always fully populated. Initialized to the
   * bundled defaults so consumers reading synchronously (e.g.
   * `useBotChat` seeding its `mode` ref at composable construction
   * time) get sensible values before the first callable response
   * lands. Reassigned wholesale on each fetch / successful save so
   * reactive bindings observe a single transition.
   */
  const config = ref<IBotAgentConfig>({ ...defaultBotAgentConfig })
  const hasOverrides = ref(false)
  const isLoading = ref(false)
  const isSaving = ref(false)
  const loadError = ref<string | null>(null)

  /**
   * The teamId that `config` currently reflects. Used as a race guard:
   * if the user switches teams while a fetch is in flight, we drop the
   * stale response instead of overwriting whatever the newer fetch
   * already wrote. `null` means "no team loaded yet" (initial state or
   * after a team change while the new fetch is still pending).
   */
  const loadedTeamId = ref<string | null>(null)

  /**
   * Fetch the active team's effective config and update state. Idempotent
   * for back-to-back calls — the in-flight fetch's `isLoading` already
   * blocks the UI, and the race guard handles late responses. Throws on
   * error so wrappers can surface a toast; clears `config` to defaults
   * when there's no active team.
   */
  const refresh = async (): Promise<void> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      // No team selected — reset to bundled defaults so the form (and
      // any other consumer) doesn't show a stale team's values.
      config.value = { ...defaultBotAgentConfig }
      hasOverrides.value = false
      loadedTeamId.value = null
      loadError.value = null
      return
    }
    isLoading.value = true
    loadError.value = null
    try {
      const { data } = await getTeamAgentConfigFn({ teamId })
      // Race guard: if the user switched teams during the fetch, the
      // response is for the wrong team — discard rather than clobber.
      if (currentTeamId.value !== teamId) return
      config.value = data.config
      hasOverrides.value = data.hasOverrides
      loadedTeamId.value = teamId
    } catch (error) {
      console.error("[agentConfigStore] failed to load config:", error)
      loadError.value =
        error instanceof Error ? error.message : "Failed to load agent config."
      // Re-throw so wrappers can surface a toast with their own i18n.
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Save a partial update for the active team. Server returns the
   * fully-merged effective config — store it as the new `config` so
   * every reactive consumer (form, composer, etc.) snaps to the same
   * canonical state in one tick. Throws on error so wrappers can keep
   * a dirty draft visible to the user.
   */
  const save = async (
    patch: UpdateTeamAgentConfigPatch
  ): Promise<IBotAgentConfig> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      throw new Error("Cannot save agent config without an active team.")
    }
    if (isSaving.value) {
      throw new Error("Agent config save already in progress.")
    }
    isSaving.value = true
    try {
      const { data } = await updateTeamAgentConfigFn({
        teamId,
        updates: patch,
      })
      // Race guard mirrors `refresh()`: if the user switched teams
      // mid-save (rare but possible), don't overwrite the new team's
      // freshly-loaded config with the prior team's update result.
      if (currentTeamId.value === teamId) {
        config.value = data.config
        hasOverrides.value = true
        loadedTeamId.value = teamId
      }
      return data.config
    } finally {
      isSaving.value = false
    }
  }

  // Refetch whenever the active team flips. `immediate: true` so the
  // very first mount kicks off a load (the bundled-defaults `config` is
  // visible to consumers in the meantime). Errors are swallowed here
  // because the watcher has no UI surface to toast from — wrappers
  // (`useAgentConfig`) call `refresh()` themselves and handle errors
  // with their own i18n.
  watch(
    currentTeamId,
    () => {
      refresh().catch(() => {
        // Already logged + recorded on `loadError`. Don't crash the
        // watcher — subsequent team changes should still trigger
        // refetches.
      })
    },
    { immediate: true }
  )

  return {
    config,
    hasOverrides,
    isLoading,
    isSaving,
    loadError,
    loadedTeamId,
    refresh,
    save,
  }
})

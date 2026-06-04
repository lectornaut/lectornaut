/**
 * useAgentConfig — i18n-aware composable wrapper around
 * `useAgentConfigStore`.
 *
 * The store owns the data plane (fetch, cache, save, race-safe
 * `currentTeamId` watcher). This wrapper adds two UI-shaped concerns
 * on top:
 *
 *   - **`canEdit` / `cannotEditReason`** — derived from
 *     `membershipStore` so the form can grey out inputs when the
 *     caller doesn't have admin rights. Mirrors the server's
 *     `isAdminRole` gate; reaching the actual `save()` callable as a
 *     non-admin is rejected anyway.
 *
 *   - **Toast handling** — i18n-keyed messages for save / load
 *     outcomes. The composable takes an optional `messagesRef` getter
 *     so locale changes flow through without remounting the form.
 *
 * Silent consumers (e.g. `useBotChat` reading only `config.defaultMode`)
 * should NOT use this composable — they should bind to
 * `useAgentConfigStore()` directly, which is read-only by convention
 * and skips the i18n / toast machinery.
 *
 * The composable's return shape is preserved from the pre-store
 * version so `SettingsAgents.vue` keeps working with no changes.
 */

import type { UpdateTeamAgentConfigPatch } from "@/composables/useFunctions"
import {
  defaultBotModelProviderToggles,
  defaultBotModelToggles,
} from "@/helpers/defaults"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IBotAgentConfig } from "@/types/domain"
import { storeToRefs } from "pinia"
import { computed } from "vue"
import { toast } from "vue-sonner"

/**
 * Every top-level `IBotAgentConfig` key *except* `tools` (the feature/tool
 * gates owned by the Agents + Tools settings tabs). The AI settings tab owns
 * everything else. Centralizing the split here keeps `SettingsAi` and
 * `SettingsAgents` from drifting when a new field is added — adding it to the
 * AI side is now a one-touch edit (this list) instead of a three-touch edit
 * (dirty-comparison subset + save-patch payload + reset fallthrough).
 *
 * `satisfies` keeps the array literal narrow (the tuple types each key
 * exactly) AND enforces the type — any key here that isn't on
 * `IBotAgentConfig` is a compile error.
 */
export const AI_CONFIG_KEYS = [
  "providers",
  "models",
  "model",
  "temperature",
  "topP",
  "topK",
  "maxOutputTokens",
  "thinking",
  "autoContext",
  "defaultMode",
  "systemPromptBase",
  "promptSuffixes",
  "titleMaxLength",
  "previewMaxLength",
] as const satisfies readonly Exclude<keyof IBotAgentConfig, "tools">[]

export type AiConfigKey = (typeof AI_CONFIG_KEYS)[number]

/**
 * Pick just the AI subset of a config — used for dirty comparison on
 * the AI tab (so a `tools` save from the Agents tab doesn't appear
 * dirty here) AND for the AI tab's save payload (so a save here
 * doesn't clobber an in-flight tools edit on the Agents tab).
 *
 * Returns a *shallow* copy. That's enough for `JSON.stringify` dirty
 * checks; the nested objects on the AI subset (`providers`, `models`,
 * `promptSuffixes`) are stable references when nothing changed, and
 * the watcher in the consumer re-clones via `cloneAgentConfig` when
 * the upstream config truly mutates.
 */
export function pickAiAgentConfig(
  source: IBotAgentConfig
): Pick<IBotAgentConfig, AiConfigKey> {
  const out = {} as Pick<IBotAgentConfig, AiConfigKey>
  for (const key of AI_CONFIG_KEYS) {
    ;(out as Record<string, unknown>)[key] = source[key]
  }
  return out
}

/**
 * Shape-stable clone of an agent config used for the settings drafts.
 * Two non-trivial bits:
 *
 *   1. Layers `defaultBotModelProviderToggles` / `defaultBotModelToggles`
 *      under the source values so a brand-new provider/model id (the
 *      catalog has shipped a new entry the team hasn't saved yet) has
 *      a sane default on the form before any save round-trips.
 *
 *   2. Spreads the nested objects (`providers`, `models`,
 *      `promptSuffixes`, `tools`) so mutations to the draft don't leak
 *      back into the upstream store via shared references.
 */
export function cloneAgentConfig(source: IBotAgentConfig): IBotAgentConfig {
  return {
    ...source,
    providers: {
      ...defaultBotModelProviderToggles,
      ...source.providers,
    },
    models: {
      ...defaultBotModelToggles,
      ...source.models,
    },
    promptSuffixes: { ...source.promptSuffixes },
    tools: { ...source.tools },
  }
}

interface UseAgentConfigI18n {
  permissionRequired: string
  saveSuccess: string
  saveError: string
  loadError: string
}

/**
 * @param messagesRef Optional reactive getter for the i18n strings.
 *                    Passed as a function (rather than a snapshot
 *                    object) so locale changes flow through into
 *                    toasts and the `cannotEditReason` tooltip
 *                    without remounting. Omit it for fully silent
 *                    consumers — empty strings suppress toasts.
 */
export function useAgentConfig(messagesRef?: () => UseAgentConfigI18n) {
  const store = useAgentConfigStore()
  // `storeToRefs` preserves reactivity when destructuring — direct
  // destructure would snapshot the values at call time.
  const { config, hasOverrides, isLoading, isSaving, loadError } =
    storeToRefs(store)

  const membershipStore = useMembershipStore()
  // Edit permission must mirror the server's `isAdminRole` gate
  // (owner ∨ admin). Using `canManageWorkspaces` would be wrong because
  // it also includes plain members (they have CREATE_WORKSPACE), and
  // the server rejects their writes with `permission-denied`.
  const { isOwner, isAdmin } = storeToRefs(membershipStore)

  /**
   * Reflects the server's `isAdminRole` gate (owner ∨ admin). UI
   * gating here is purely for affordance (disabled inputs + tooltip);
   * the server's `updateTeamAgentConfig` rejects non-admins anyway.
   */
  const canEdit = computed(() => isOwner.value || isAdmin.value)

  const cannotEditReason = computed(() => {
    if (canEdit.value) return null
    const msg = messagesRef?.().permissionRequired ?? ""
    return msg.length > 0 ? msg : null
  })

  const refresh = async (): Promise<void> => {
    try {
      await store.refresh()
    } catch {
      // Store already logged + recorded `loadError`. Surface a toast
      // here if the caller wired one up.
      const msg = messagesRef?.().loadError ?? ""
      if (msg) toast.error(msg)
    }
  }

  const save = async (patch: UpdateTeamAgentConfigPatch): Promise<void> => {
    if (!canEdit.value) {
      // Defense in depth — the form's Save button is `:disabled`, so
      // reaching here means a programmatic call slipped through. Toast
      // anyway since the user clearly intended to save.
      const msg = messagesRef?.().permissionRequired ?? ""
      if (msg) toast.error(msg)
      return
    }
    try {
      await store.save(patch)
      const okMsg = messagesRef?.().saveSuccess ?? ""
      if (okMsg) toast.success(okMsg)
    } catch (error) {
      console.error("[useAgentConfig] failed to save config:", error)
      const errMsg = messagesRef?.().saveError ?? ""
      if (errMsg) toast.error(errMsg)
      // Re-throw so callers (e.g. the SettingsAgents form) can keep
      // their dirty draft visible — silent swallow would falsely
      // suggest the patch landed.
      throw error
    }
  }

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

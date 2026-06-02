/**
 * useIntegrationsRegistry — the unified read-model + verbs for the Integrations
 * surface. It is the BEHAVIOR half of the unification (the taxonomy half is the
 * catalog in `data/integrationCatalog.ts`): it composes the two physically
 * separate read-models — `integrationsStore` (agents + tools, catalog overlay)
 * and `teamWorkflowsStore` (workflows, materialized) — plus the install/enable
 * write-actions in `useIntegrations`, into ONE list of `RegistryItem`s and ONE
 * set of verbs.
 *
 * This is the seam that lets the page treat all three building blocks
 * uniformly WITHOUT their docs sharing a collection: the facade routes each
 * verb to the right backing store/callable by `type`. Swap a building block's
 * storage and only this file changes — the page never learns where anything
 * lives.
 */

import { useIntegrations } from "@/composables/useIntegrations"
import {
  INTEGRATION_CATALOG,
  type CatalogEntry,
  type CatalogEntryType,
} from "@/data/integrationCatalog"
import { useIntegrationsStore } from "@/stores/integrationsStore"
import { useTeamWorkflowsStore } from "@/stores/teamWorkflowsStore"
import { storeToRefs } from "pinia"
import { computed, type ComputedRef } from "vue"

/** A catalog entry resolved against the team's live install state. */
export interface RegistryItem extends CatalogEntry {
  /** An active (non-archived) doc/overlay exists for this team. */
  installed: boolean
}

export function useIntegrationsRegistry() {
  const { t } = useI18n()

  const actions = useIntegrations()

  const integrationsStore = useIntegrationsStore()
  const { agentIntegrations, toolIntegrations } = storeToRefs(integrationsStore)

  const workflowsStore = useTeamWorkflowsStore()
  const { availablePresetKeys } = storeToRefs(workflowsStore)

  // ── Per-type installed-state resolution ──────────────────────────────────
  // Agents/tools use the catalog overlay (a built-in with no divergence doc
  // reads as installed — the opt-out default). Workflows are opt-in: "installed"
  // means the team has made the preset AVAILABLE (the team tier); per-workspace
  // deployment is a separate toggle on the Workflows settings page.
  const agentInstalled = (key: string): boolean =>
    agentIntegrations.value.find((i) => i.sourceKey === key)?.installed ?? true
  const toolInstalled = (key: string): boolean =>
    toolIntegrations.value.find((i) => i.sourceKey === key)?.installed ?? true
  const workflowInstalled = (key: string): boolean =>
    availablePresetKeys.value.has(key)

  const isInstalled = (entry: CatalogEntry): boolean => {
    if (entry.type === "agent") return agentInstalled(entry.key)
    if (entry.type === "tool") return toolInstalled(entry.key)
    return workflowInstalled(entry.key)
  }

  // ── Display resolution ────────────────────────────────────────────────────
  // Agents reuse the Agents-settings i18n keys (with catalog fallback) so the
  // two surfaces read identically; tools + workflows use their catalog copy.
  const displayName = (entry: CatalogEntry): string =>
    entry.type === "agent"
      ? t(`settings.agents.builtInAgents.${entry.key}.label`, entry.name)
      : entry.name
  const displayDescription = (entry: CatalogEntry): string =>
    entry.type === "agent"
      ? t(
          `settings.agents.builtInAgents.${entry.key}.description`,
          entry.description
        )
      : entry.description

  const toItem = (entry: CatalogEntry): RegistryItem => ({
    ...entry,
    name: displayName(entry),
    description: displayDescription(entry),
    installed: isInstalled(entry),
  })

  const itemsOfType = (type: CatalogEntryType): ComputedRef<RegistryItem[]> =>
    computed(() =>
      INTEGRATION_CATALOG.filter((e) => e.type === type).map(toItem)
    )

  const agents = itemsOfType("agent")
  const tools = itemsOfType("tool")
  const workflows = itemsOfType("workflow")

  // ── Uniform verbs — routed per type to the right backing layer ────────────
  const install = (item: RegistryItem): Promise<void> => {
    if (item.type === "agent") return actions.addBuiltInAgent(item.key)
    if (item.type === "tool") return actions.addBuiltInTool(item.key)
    return actions.addWorkflowPreset(item.key)
  }
  const uninstall = (item: RegistryItem): Promise<void> => {
    if (item.type === "agent") return actions.removeBuiltInAgent(item.key)
    if (item.type === "tool") return actions.removeBuiltInTool(item.key)
    return actions.removeWorkflowPreset(item.key)
  }
  /** Install if absent, uninstall if present. */
  const toggleInstalled = (item: RegistryItem): Promise<void> =>
    item.installed ? uninstall(item) : install(item)

  return {
    canManage: actions.canManage,
    agents,
    tools,
    workflows,
    install,
    uninstall,
    toggleInstalled,
  }
}

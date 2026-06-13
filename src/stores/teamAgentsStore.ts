/**
 * Team Agents Store — the agent-facing view over the unified integrations
 * collection (`teams/{teamId}/integrations`, `type == "agent"`).
 *
 * Reads derive from `integrationsStore` (the single source of truth + catalog
 * overlay) mapped back into the `ITeamAgent` shape every consumer already
 * speaks — the chat composer's agent picker, `useBotChat`'s active-agent
 * resolution, the transfer roster, and the admin CRUD UI. Writes route through
 * the unified `integration*` callables (built-in agents are thin docs; custom
 * agents carry a full `spec`), translating the editor's flat draft shape
 * to/from the nested `spec`.
 *
 * The team-wide `customAgents` feature gate still lives on the agent-config doc
 * (it's a team capability flag, not an integration), read here to gate the
 * picker/selectable surfaces exactly as before.
 */

import {
  createIntegration as createIntegrationFn,
  setIntegrationEnabled as setIntegrationEnabledFn,
  updateIntegration as updateIntegrationFn,
  type CreateTeamAgentDraft,
  type UpdateTeamAgentPatch,
} from "@/composables/useFunctions"
import { BUILT_IN_AGENTS } from "@/data/builtInAgents"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import {
  useIntegrationsStore,
  type ResolvedIntegration,
} from "@/stores/integrationsStore"
import type {
  IAgentIntegrationDraft,
  IAgentIntegrationPatch,
  IAgentIntegrationSpec,
  IIntegration,
  ITeamAgent,
} from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref } from "vue"

// ─── Defaults + mapping helpers ──────────────────────────────────────────────

const DEFAULT_PROMPT_SUFFIXES: ITeamAgent["promptSuffixes"] = {
  auto: "",
  agent: "",
  manual: "",
}

const DEFAULT_TOOL_TOGGLES: ITeamAgent["tools"] = {
  rollDice: true,
  browseInternet: true,
  askQuestion: true,
  searchWorkspaceNodes: true,
  listWorkspaceNodes: true,
  summarizeNode: true,
  compareNodes: true,
  findRelatedNodes: true,
  manageContent: true,
  readContent: true,
  customAgents: true,
  customWorkflows: true,
  customTools: true,
}

const byName = (a: ITeamAgent, b: ITeamAgent): number =>
  a.name.localeCompare(b.name)

/** Map a resolved agent integration into the legacy `ITeamAgent` shape. */
function toTeamAgent(i: ResolvedIntegration): ITeamAgent {
  const spec = (i.spec as IAgentIntegrationSpec | null) ?? null
  return {
    id: i.id,
    teamId: i.teamId,
    name: i.name,
    description: i.description,
    avatarSeed: i.avatarSeed,
    systemPromptBase: spec?.systemPromptBase ?? "",
    promptSuffixes: spec?.promptSuffixes ?? { ...DEFAULT_PROMPT_SUFFIXES },
    tools: spec?.tools ?? { ...DEFAULT_TOOL_TOGGLES },
    customTools: spec?.customTools ?? {},
    enabled: i.enabled,
    isPublic: i.isPublic,
    archivedAt: i.archivedAt,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    createdByUid: i.createdByUid,
  }
}

/** Map a mutation response (full `IIntegration`) to `ITeamAgent`. */
function integrationToTeamAgent(i: IIntegration | null): ITeamAgent {
  const spec =
    i && i.type === "agent" ? (i.spec as IAgentIntegrationSpec | null) : null
  const now = Timestamp.now()
  return {
    id: i?.id ?? "",
    teamId: i?.teamId ?? "",
    name: i?.name ?? "",
    description: i?.description ?? "",
    avatarSeed: i?.avatarSeed ?? "",
    systemPromptBase: spec?.systemPromptBase ?? "",
    promptSuffixes: spec?.promptSuffixes ?? { ...DEFAULT_PROMPT_SUFFIXES },
    tools: spec?.tools ?? { ...DEFAULT_TOOL_TOGGLES },
    customTools: spec?.customTools ?? {},
    enabled: i?.enabled ?? true,
    isPublic: i?.isPublic ?? true,
    archivedAt: i?.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
    createdByUid: i?.createdByUid ?? "",
  }
}

/** Editor's flat create draft → the nested integration draft. */
function toAgentDraft(d: CreateTeamAgentDraft): IAgentIntegrationDraft {
  return {
    name: d.name,
    description: d.description ?? "",
    avatarSeed: d.avatarSeed ?? "",
    isPublic: d.isPublic ?? true,
    spec: {
      systemPromptBase: d.systemPromptBase,
      promptSuffixes: {
        ...DEFAULT_PROMPT_SUFFIXES,
        ...(d.promptSuffixes ?? {}),
      },
      tools: { ...DEFAULT_TOOL_TOGGLES, ...(d.tools ?? {}) },
      customTools: d.customTools ?? {},
    },
  }
}

/** Editor's flat update patch → the nested integration patch. */
function toAgentPatch(p: UpdateTeamAgentPatch): IAgentIntegrationPatch {
  const spec: NonNullable<IAgentIntegrationPatch["spec"]> = {}
  if (p.systemPromptBase !== undefined)
    spec.systemPromptBase = p.systemPromptBase
  if (p.promptSuffixes !== undefined)
    spec.promptSuffixes = { ...DEFAULT_PROMPT_SUFFIXES, ...p.promptSuffixes }
  if (p.tools !== undefined)
    spec.tools = { ...DEFAULT_TOOL_TOGGLES, ...p.tools }
  if (p.customTools !== undefined) spec.customTools = p.customTools
  const patch: IAgentIntegrationPatch = {}
  if (p.name !== undefined) patch.name = p.name
  if (p.description !== undefined) patch.description = p.description
  if (p.avatarSeed !== undefined) patch.avatarSeed = p.avatarSeed
  if (p.isPublic !== undefined) patch.isPublic = p.isPublic
  if (Object.keys(spec).length > 0) patch.spec = spec
  return patch
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTeamAgentsStore = defineStore("teamAgents", () => {
  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  const integrationsStore = useIntegrationsStore()
  const { agentIntegrations, isLoading, loadError } =
    storeToRefs(integrationsStore)

  // Team-wide feature gates (still on the agent-config doc — capability flags,
  // not integrations). Drive the picker/selectable surfaces as before.
  const agentConfigStore = useAgentConfigStore()
  const { config: teamAgentConfig } = storeToRefs(agentConfigStore)
  const customAgentsEnabled = computed<boolean>(
    () => teamAgentConfig.value.tools.customAgents !== false
  )
  const customWorkflowsEnabled = computed<boolean>(
    () => teamAgentConfig.value.tools.customWorkflows !== false
  )

  const isSaving = ref(false)

  // ── Derived views (mirror the previous semantics) ────────────────────────

  /** Every custom agent (all lifecycle states). */
  const agents = computed<ITeamAgent[]>(() =>
    agentIntegrations.value
      .filter((i) => i.source === "custom")
      .map(toTeamAgent)
  )

  /**
   * Hydrated built-in presets that are installed AND enabled — the same
   * two-gate check the server applies, now reading the integration's resolved
   * state instead of the old config maps. Gated by the team-wide customAgents
   * feature flag (hides built-ins + customs uniformly, as before).
   */
  const builtInAgents = computed<ITeamAgent[]>(() => {
    if (!customAgentsEnabled.value) return []
    return agentIntegrations.value
      .filter((i) => i.source !== "custom" && i.installed && i.enabled)
      .map(toTeamAgent)
  })

  /** Custom agents the admin can manage — enabled AND non-archived. */
  const selectableAgents = computed<ITeamAgent[]>(() => {
    if (!customAgentsEnabled.value) return []
    return agents.value
      .filter((agent) => agent.enabled !== false && !agent.archivedAt)
      .slice()
      .sort(byName)
  })

  /** Picker surface: built-ins first (declaration order), then custom. */
  const pickerAgents = computed<ITeamAgent[]>(() => [
    ...builtInAgents.value,
    ...selectableAgents.value,
  ])

  /** Built-ins + every custom (incl. disabled/archived) — badge resolution. */
  const allAgents = computed<ITeamAgent[]>(() => [
    ...builtInAgents.value,
    ...agents.value,
  ])

  /** Backwards-compat alias for `pickerAgents`. */
  const activeAgents = pickerAgents

  const disabledAgents = computed<ITeamAgent[]>(() =>
    agents.value
      .filter((agent) => agent.enabled === false && !agent.archivedAt)
      .slice()
      .sort(byName)
  )

  const archivedAgents = computed<ITeamAgent[]>(() =>
    agents.value
      .filter((agent) => !!agent.archivedAt)
      .slice()
      .sort((a, b) => {
        const aTime = a.archivedAt?.toMillis() ?? 0
        const bTime = b.archivedAt?.toMillis() ?? 0
        return bTime - aTime
      })
  )

  const loadedTeamId = computed<string | null>(() =>
    isLoading.value ? null : currentTeamId.value
  )

  /** Lookup by id among custom agents (matches prior behavior). */
  const getById = (agentId: string): ITeamAgent | null =>
    agents.value.find((agent) => agent.id === agentId) ?? null

  /**
   * Lookup for the EDITOR: any agent integration — custom or built-in, in
   * any lifecycle state (disabled/archived built-ins stay editable). For a
   * built-in this is the EFFECTIVE persona: the team's customization
   * override when one exists, the shipped catalog default otherwise — so
   * the editor always opens pre-filled with what actually dispatches.
   */
  const getEditableById = (agentId: string): ITeamAgent | null => {
    const integration = agentIntegrations.value.find((i) => i.id === agentId)
    return integration ? toTeamAgent(integration) : null
  }

  /** True when the id resolves to a non-custom (built-in) agent integration. */
  const isBuiltIn = (agentId: string): boolean => {
    const integration = agentIntegrations.value.find((i) => i.id === agentId)
    return integration !== undefined && integration.source !== "custom"
  }

  /** Built-in agent has diverged from the shipped persona (badge + reset). */
  const isCustomized = (agentId: string): boolean =>
    agentIntegrations.value.find((i) => i.id === agentId)?.customized === true

  // ── Mutations (admin only — server enforces; routed to unified callables) ─

  const withSave = async <T>(
    fn: (teamId: string) => Promise<T>
  ): Promise<T> => {
    const teamId = currentTeamId.value
    if (!teamId) throw new Error("No active team.")
    if (isSaving.value) throw new Error("Agent save already in progress.")
    isSaving.value = true
    try {
      return await fn(teamId)
    } finally {
      isSaving.value = false
    }
  }

  const create = (draft: CreateTeamAgentDraft): Promise<ITeamAgent> =>
    withSave(async (teamId) => {
      const { data } = await createIntegrationFn({
        teamId,
        type: "agent",
        draft: toAgentDraft(draft),
      })
      return integrationToTeamAgent(data.integration)
    })

  const update = (
    agentId: string,
    patch: UpdateTeamAgentPatch
  ): Promise<ITeamAgent> =>
    withSave(async (teamId) => {
      // Built-ins are addressed by catalog key so the server can materialize
      // the divergence doc on a first-time customization (a built-in with no
      // doc has nothing to patch by id). Diverged built-ins live at
      // id == sourceKey, so this addressing also works once the doc exists.
      const target = isBuiltIn(agentId)
        ? { type: "agent" as const, sourceKey: agentId }
        : { integrationId: agentId }
      // `enabled` has a dedicated callable; everything else is a doc patch.
      if (patch.enabled !== undefined) {
        await setIntegrationEnabledFn({
          teamId,
          ...target,
          enabled: patch.enabled,
        })
      }
      const { data } = await updateIntegrationFn({
        teamId,
        ...target,
        patch: toAgentPatch(patch),
      })
      return integrationToTeamAgent(data.integration)
    })

  /**
   * Reset a built-in agent to its shipped catalog persona: clears the
   * stored spec override (`spec: null`) and restores the catalog envelope.
   * The doc keeps tracking future catalog updates afterwards — unlike
   * saving a spec identical to today's defaults, which would pin it.
   */
  const resetBuiltIn = (agentId: string): Promise<ITeamAgent> =>
    withSave(async (teamId) => {
      const def = BUILT_IN_AGENTS.find((a) => a.id === agentId)
      if (!def) throw new Error(`Unknown built-in agent "${agentId}".`)
      const { data } = await updateIntegrationFn({
        teamId,
        type: "agent",
        sourceKey: agentId,
        patch: {
          name: def.name,
          description: def.description,
          avatarSeed: def.avatarSeed,
          spec: null,
        },
      })
      return integrationToTeamAgent(data.integration)
    })

  // Lifecycle toggles are OPTIMISTIC: they delegate to the integrations store,
  // which patches the shared cache + rolls back on failure. They deliberately
  // skip `withSave`/`isSaving` so the row Switch flips instantly and toggles on
  // different agents don't block each other (the editor's create/update keep
  // `withSave` — a brief save spinner is fine for a form dialog).
  const archive = async (agentId: string): Promise<ITeamAgent> => {
    const { integration } = await integrationsStore.uninstall({
      integrationId: agentId,
    })
    return integrationToTeamAgent(integration)
  }

  const restore = async (agentId: string): Promise<ITeamAgent> => {
    const { integration } = await integrationsStore.install({
      integrationId: agentId,
    })
    return integrationToTeamAgent(integration)
  }

  const setEnabled = async (
    agentId: string,
    enabled: boolean
  ): Promise<ITeamAgent> => {
    const { integration } = await integrationsStore.setEnabled(
      { integrationId: agentId },
      enabled
    )
    return integrationToTeamAgent(integration)
  }

  const remove = async (agentId: string): Promise<void> => {
    await integrationsStore.remove(agentId)
  }

  return {
    agents,
    builtInAgents,
    allAgents,
    pickerAgents,
    activeAgents,
    selectableAgents,
    disabledAgents,
    archivedAgents,
    customAgentsEnabled,
    customWorkflowsEnabled,
    isLoading,
    isSaving,
    loadError,
    loadedTeamId,
    getById,
    getEditableById,
    isBuiltIn,
    isCustomized,
    create,
    update,
    resetBuiltIn,
    archive,
    restore,
    setEnabled,
    remove,
  }
})

/**
 * Team Custom Tools Store — the tool-facing view over the unified integrations
 * collection (`teams/{teamId}/integrations`, `type == "tool"`, `source ==
 * "custom"`). Mirrors `teamAgentsStore`: reads derive from `integrationsStore`
 * mapped back into the `ITeamCustomTool` shape the settings UI speaks; writes
 * route through the unified `integration*` callables.
 *
 * The envelope/spec split: a custom tool's wire-name (the identifier the model
 * invokes) lives at `spec.wireName`, and the friendly label is the envelope
 * `name`. We translate so `ITeamCustomTool.name` stays the wire-name and
 * `.displayName` the label, exactly as the editor expects.
 *
 * The team-wide `customTools` feature gate stays on the agent-config doc
 * (a capability flag) and short-circuits `selectableTools` as before.
 */

import {
  createIntegration as createIntegrationFn,
  setIntegrationEnabled as setIntegrationEnabledFn,
  updateIntegration as updateIntegrationFn,
  type CreateTeamCustomToolDraft,
  type UpdateTeamCustomToolPatch,
} from "@/composables/useFunctions"
import { botAgentModelSchema } from "@/schemas/domain"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import {
  useIntegrationsStore,
  type ResolvedIntegration,
} from "@/stores/integrationsStore"
import type {
  ICustomToolAction,
  IIntegration,
  ITeamCustomTool,
  IToolIntegrationDraft,
  IToolIntegrationPatch,
  IToolIntegrationSpec,
} from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref } from "vue"

// ─── Defaults + normalization (defensive — client reads raw docs) ────────────

const DEFAULT_ACTION: ICustomToolAction = {
  kind: "constant",
  value: '{ "ok": true }',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeFields(
  raw: unknown
): ITeamCustomTool["inputSchema"]["fields"] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((f) => {
      if (!isRecord(f)) return null
      const name = typeof f.name === "string" ? f.name : null
      const type =
        f.type === "string" || f.type === "number" || f.type === "boolean"
          ? f.type
          : null
      if (!name || !type) return null
      return {
        name,
        type,
        description: typeof f.description === "string" ? f.description : "",
        required: f.required === true,
      }
    })
    .filter((f): f is ITeamCustomTool["inputSchema"]["fields"][number] => !!f)
}

function normalizeAction(raw: unknown): ICustomToolAction {
  if (!isRecord(raw)) return { ...DEFAULT_ACTION }
  switch (raw.kind) {
    case "httpWebhook":
      return {
        kind: "httpWebhook",
        url: typeof raw.url === "string" ? raw.url : "",
        method:
          raw.method === "GET" ||
          raw.method === "POST" ||
          raw.method === "PUT" ||
          raw.method === "PATCH" ||
          raw.method === "DELETE"
            ? raw.method
            : "POST",
        headers: Array.isArray(raw.headers)
          ? raw.headers
              .map((h: unknown) =>
                isRecord(h) &&
                typeof h.name === "string" &&
                typeof h.value === "string"
                  ? { name: h.name, value: h.value }
                  : null
              )
              .filter((h): h is { name: string; value: string } => !!h)
          : [],
        bodyTemplate:
          typeof raw.bodyTemplate === "string" ? raw.bodyTemplate : "",
        maxResponseBytes:
          typeof raw.maxResponseBytes === "number"
            ? raw.maxResponseBytes
            : 16384,
        timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : 10_000,
      }
    case "constant":
      return {
        kind: "constant",
        value: typeof raw.value === "string" ? raw.value : "",
      }
    case "promptTemplate":
      return {
        kind: "promptTemplate",
        prompt: typeof raw.prompt === "string" ? raw.prompt : "",
        model: botAgentModelSchema.safeParse(raw.model).data ?? null,
      }
    case "workspaceSearch":
      return {
        kind: "workspaceSearch",
        scope: raw.scope === "code" || raw.scope === "write" ? raw.scope : null,
        defaultLimit:
          typeof raw.defaultLimit === "number" ? raw.defaultLimit : 5,
        filterHint: typeof raw.filterHint === "string" ? raw.filterHint : "",
      }
    default:
      return { ...DEFAULT_ACTION }
  }
}

// ─── Mapping helpers ─────────────────────────────────────────────────────────

function specToTool(
  spec: IToolIntegrationSpec | null,
  base: {
    id: string
    teamId: string
    displayName: string
    description: string
    avatarSeed: string
    enabled: boolean
    archivedAt: Timestamp | null
    createdAt: Timestamp
    updatedAt: Timestamp
    createdByUid: string
  }
): ITeamCustomTool {
  return {
    id: base.id,
    teamId: base.teamId,
    name: spec?.wireName ?? "",
    displayName: base.displayName,
    description: base.description,
    avatarSeed: base.avatarSeed,
    inputSchema: { fields: normalizeFields(spec?.inputSchema?.fields) },
    outputSchema: { fields: normalizeFields(spec?.outputSchema?.fields) },
    action: normalizeAction(spec?.action),
    enabled: base.enabled,
    archivedAt: base.archivedAt,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    createdByUid: base.createdByUid,
  }
}

/** Map a resolved tool integration into the legacy `ITeamCustomTool` shape. */
function toCustomTool(i: ResolvedIntegration): ITeamCustomTool {
  return specToTool(i.spec as IToolIntegrationSpec | null, {
    id: i.id,
    teamId: i.teamId,
    displayName: i.name,
    description: i.description,
    avatarSeed: i.avatarSeed,
    enabled: i.enabled,
    archivedAt: i.archivedAt,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    createdByUid: i.createdByUid,
  })
}

/** Map a mutation response (full `IIntegration`) to `ITeamCustomTool`. */
function integrationToTool(i: IIntegration | null): ITeamCustomTool {
  const spec =
    i && i.type === "tool" ? (i.spec as IToolIntegrationSpec | null) : null
  const now = Timestamp.now()
  return specToTool(spec, {
    id: i?.id ?? "",
    teamId: i?.teamId ?? "",
    displayName: i?.name ?? "",
    description: i?.description ?? "",
    avatarSeed: i?.avatarSeed ?? "",
    enabled: i?.enabled ?? true,
    archivedAt: i?.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
    createdByUid: i?.createdByUid ?? "",
  })
}

/** Editor's flat draft (name == wire-name) → the nested integration draft. */
function toToolDraft(d: CreateTeamCustomToolDraft): IToolIntegrationDraft {
  return {
    name: d.displayName ?? "",
    description: d.description,
    avatarSeed: d.avatarSeed ?? "",
    spec: {
      wireName: d.name,
      inputSchema: d.inputSchema,
      outputSchema: d.outputSchema,
      action: d.action,
    },
  }
}

function toToolPatch(p: UpdateTeamCustomToolPatch): IToolIntegrationPatch {
  const spec: NonNullable<IToolIntegrationPatch["spec"]> = {}
  if (p.name !== undefined) spec.wireName = p.name
  if (p.inputSchema !== undefined) spec.inputSchema = p.inputSchema
  if (p.outputSchema !== undefined) spec.outputSchema = p.outputSchema
  if (p.action !== undefined) spec.action = p.action
  const patch: IToolIntegrationPatch = {}
  if (p.displayName !== undefined) patch.name = p.displayName
  if (p.description !== undefined) patch.description = p.description
  if (p.avatarSeed !== undefined) patch.avatarSeed = p.avatarSeed
  if (Object.keys(spec).length > 0) patch.spec = spec
  return patch
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const useTeamCustomToolsStore = defineStore("teamCustomTools", () => {
  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  const integrationsStore = useIntegrationsStore()
  const { toolIntegrations, isLoading, loadError } =
    storeToRefs(integrationsStore)

  const agentConfigStore = useAgentConfigStore()
  const { config: teamAgentConfig } = storeToRefs(agentConfigStore)
  const customToolsEnabled = computed<boolean>(
    () => teamAgentConfig.value.tools.customTools !== false
  )

  const isSaving = ref(false)

  /** Every custom tool (all lifecycle states). */
  const tools = computed<ITeamCustomTool[]>(() =>
    toolIntegrations.value
      .filter((i) => i.source === "custom")
      .map(toCustomTool)
  )

  const loadedTeamId = computed<string | null>(() =>
    isLoading.value ? null : currentTeamId.value
  )

  // ── Derived views ──────────────────────────────────────────────────────

  const selectableTools = computed<ITeamCustomTool[]>(() => {
    if (!customToolsEnabled.value) return []
    return tools.value
      .filter((t) => t.enabled !== false && !t.archivedAt)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const disabledTools = computed<ITeamCustomTool[]>(() =>
    tools.value
      .filter((t) => t.enabled === false && !t.archivedAt)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  const archivedTools = computed<ITeamCustomTool[]>(() =>
    tools.value
      .filter((t) => !!t.archivedAt)
      .slice()
      .sort((a, b) => {
        const aTime = a.archivedAt?.toMillis() ?? 0
        const bTime = b.archivedAt?.toMillis() ?? 0
        return bTime - aTime
      })
  )

  const getById = (toolId: string): ITeamCustomTool | null =>
    tools.value.find((t) => t.id === toolId) ?? null

  // ── Mutations (admin only — server enforces; routed to unified callables) ─

  const withSave = async <T>(
    fn: (teamId: string) => Promise<T>
  ): Promise<T> => {
    const teamId = currentTeamId.value
    if (!teamId) throw new Error("No active team.")
    if (isSaving.value) throw new Error("Tool save already in progress.")
    isSaving.value = true
    try {
      return await fn(teamId)
    } finally {
      isSaving.value = false
    }
  }

  const create = (draft: CreateTeamCustomToolDraft): Promise<ITeamCustomTool> =>
    withSave(async (teamId) => {
      const { data } = await createIntegrationFn({
        teamId,
        type: "tool",
        draft: toToolDraft(draft),
      })
      return integrationToTool(data.integration)
    })

  const update = (
    toolId: string,
    patch: UpdateTeamCustomToolPatch
  ): Promise<ITeamCustomTool> =>
    withSave(async (teamId) => {
      if (patch.enabled !== undefined) {
        await setIntegrationEnabledFn({
          teamId,
          integrationId: toolId,
          enabled: patch.enabled,
        })
      }
      const { data } = await updateIntegrationFn({
        teamId,
        integrationId: toolId,
        patch: toToolPatch(patch),
      })
      return integrationToTool(data.integration)
    })

  // Lifecycle toggles are OPTIMISTIC — delegate to the integrations store
  // (shared cache patch + rollback), skipping `withSave`/`isSaving` so the row
  // Switch flips instantly. Create/update keep `withSave` (form-dialog save).
  const archive = async (toolId: string): Promise<ITeamCustomTool> => {
    const { integration } = await integrationsStore.uninstall({
      integrationId: toolId,
    })
    return integrationToTool(integration)
  }

  const restore = async (toolId: string): Promise<ITeamCustomTool> => {
    const { integration } = await integrationsStore.install({
      integrationId: toolId,
    })
    return integrationToTool(integration)
  }

  const setEnabled = async (
    toolId: string,
    enabled: boolean
  ): Promise<ITeamCustomTool> => {
    const { integration } = await integrationsStore.setEnabled(
      { integrationId: toolId },
      enabled
    )
    return integrationToTool(integration)
  }

  const remove = async (toolId: string): Promise<void> => {
    await integrationsStore.remove(toolId)
  }

  return {
    tools,
    selectableTools,
    disabledTools,
    archivedTools,
    customToolsEnabled,
    isLoading,
    isSaving,
    loadError,
    loadedTeamId,
    getById,
    create,
    update,
    archive,
    restore,
    setEnabled,
    remove,
  }
})

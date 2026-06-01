/**
 * Team Custom Tools Store — Firestore-backed catalog of admin-authored
 * Genkit tools. Mirrors `teamAgentsStore.ts` in shape and intent:
 *
 *   - Reads via the shared TanStack query cache (`useCollectionQuery`),
 *     one ref-counted `onSnapshot` per `teams/{teamId}/tools` for any
 *     team member (reads are open by the Firestore rule; writes are
 *     callable-only and gated server-side).
 *   - Race-safe team-switching: the query key embeds the teamId, so a
 *     late snapshot for the previous team lands under its own unobserved
 *     key and can't clobber the active team's state — no manual guard.
 *   - Derived views (`selectableTools` / `disabledTools` /
 *     `archivedTools`) mirror the agent lifecycle so the settings UI
 *     can reuse the same active/disabled/archived collapsible pattern.
 *   - The team-wide `customTools` feature gate (from
 *     `agentConfigStore.config.tools.customTools`) short-circuits
 *     `selectableTools` to an empty array — the chat dispatcher
 *     enforces the same gate server-side.
 */

import {
  archiveTeamCustomTool as archiveTeamCustomToolFn,
  createTeamCustomTool as createTeamCustomToolFn,
  deleteTeamCustomTool as deleteTeamCustomToolFn,
  restoreTeamCustomTool as restoreTeamCustomToolFn,
  setTeamCustomToolEnabled as setTeamCustomToolEnabledFn,
  updateTeamCustomTool as updateTeamCustomToolFn,
  type CreateTeamCustomToolDraft,
  type UpdateTeamCustomToolPatch,
} from "@/composables/useFunctions"
import { firestore } from "@/modules/firebase"
import { botAgentModelSchema } from "@/schemas/domain"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import type { ICustomToolAction, ITeamCustomTool } from "@/types/domain"
import {
  useCollectionQuery,
  type CollectionQuerySource,
} from "@/utils/firebase/firebase-query"
import {
  collection,
  Timestamp,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref } from "vue"

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_ACTION: ICustomToolAction = {
  kind: "constant",
  value: '{ "ok": true }',
}

// ─── Helpers ───────────────────────────────────────────────────────────────

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
        // Validate against the known model enum instead of `as never`-casting
        // an arbitrary string. An unrecognized/legacy model id falls back to
        // `null`, which the schema permits ("use the chat's current model").
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

function snapshotToTool(
  teamId: string,
  snap: QueryDocumentSnapshot
): ITeamCustomTool {
  const data = snap.data() ?? {}
  const inputSchemaRaw = isRecord(data.inputSchema) ? data.inputSchema : {}
  const outputSchemaRaw = isRecord(data.outputSchema) ? data.outputSchema : {}
  return {
    id: snap.id,
    teamId,
    name: typeof data.name === "string" ? data.name : "",
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    description: typeof data.description === "string" ? data.description : "",
    avatarSeed: typeof data.avatarSeed === "string" ? data.avatarSeed : "",
    inputSchema: {
      fields: normalizeFields(
        (inputSchemaRaw as Record<string, unknown>).fields
      ),
    },
    outputSchema: {
      fields: normalizeFields(
        (outputSchemaRaw as Record<string, unknown>).fields
      ),
    },
    action: normalizeAction(data.action),
    enabled: typeof data.enabled === "boolean" ? data.enabled : true,
    archivedAt: data.archivedAt instanceof Timestamp ? data.archivedAt : null,
    createdAt:
      data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    updatedAt:
      data.updatedAt instanceof Timestamp ? data.updatedAt : Timestamp.now(),
    createdByUid:
      typeof data.createdByUid === "string" ? data.createdByUid : "",
  }
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const useTeamCustomToolsStore = defineStore("teamCustomTools", () => {
  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  const agentConfigStore = useAgentConfigStore()
  const { config: teamAgentConfig } = storeToRefs(agentConfigStore)

  // Team-wide gate — sibling of `customAgentsEnabled`. When false:
  //   - `selectableTools` returns [] so pickers and tool-row displays
  //     show "feature disabled" hints rather than the catalog.
  //   - The server's dispatcher skips the Firestore read entirely.
  //
  // Admins still see disabled + archived buckets in settings so they
  // can edit existing tools while the gate is flipped off.
  const customToolsEnabled = computed<boolean>(
    () => teamAgentConfig.value.tools.customTools !== false
  )

  const isSaving = ref(false)

  /**
   * Firestore converter that funnels every read through `snapshotToTool`, so
   * cached docs are normalized exactly as the old manual mapping did. `teamId`
   * is recovered from the doc path (`teams/{teamId}/tools/{id}`). `toFirestore`
   * is never exercised — writes go through the Cloud Functions above.
   */
  const toolConverter: FirestoreDataConverter<ITeamCustomTool> = {
    toFirestore: () => ({}),
    fromFirestore: (snapshot) =>
      snapshotToTool(snapshot.ref.parent.parent?.id ?? "", snapshot),
  }

  /**
   * Every custom tool for the active team — read through the shared TanStack
   * cache (one live `onSnapshot` per `teams/{teamId}/tools`, ref-counted and
   * gc-torn-down by `useCollectionQuery`). The query key embeds the teamId, so
   * switching teams releases the old listener and renders the new team's cached
   * data immediately while its listener reconnects — the per-team race guard
   * the old manual subscription needed is now structural. Writes still flow
   * through the Cloud Functions above; the listener reflects them within ms.
   */
  const toolsQuery = useCollectionQuery<ITeamCustomTool>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      if (!teamId) return null
      const path = `teams/${teamId}/tools`
      return {
        query: collection(firestore, path).withConverter(toolConverter),
        path,
      }
    }
  )

  const tools = computed<ITeamCustomTool[]>(() => toolsQuery.data.value ?? [])
  const isLoading = computed<boolean>(() => toolsQuery.isLoading.value)
  const loadError = computed<string | null>(
    () => toolsQuery.error.value?.message ?? null
  )

  /**
   * The teamId whose `tools` are currently loaded, or `null` while pending /
   * teamless. Retained for API compatibility; with per-team query keys it is a
   * thin derivation of the active team once the first snapshot has landed.
   */
  const loadedTeamId = computed<string | null>(() =>
    toolsQuery.data.value !== undefined ? currentTeamId.value : null
  )

  // ── Derived views ──────────────────────────────────────────────────────

  /** Enabled + non-archived + team-gate on. Empty when the gate is off. */
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

  // ── Mutations (admin only — server enforces) ──────────────────────────

  const create = async (
    draft: CreateTeamCustomToolDraft
  ): Promise<ITeamCustomTool> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      throw new Error("Cannot create a tool without an active team.")
    }
    if (isSaving.value) throw new Error("Tool save already in progress.")
    isSaving.value = true
    try {
      const { data } = await createTeamCustomToolFn({ teamId, draft })
      return data.tool
    } finally {
      isSaving.value = false
    }
  }

  const update = async (
    toolId: string,
    patch: UpdateTeamCustomToolPatch
  ): Promise<ITeamCustomTool> => {
    const teamId = currentTeamId.value
    if (!teamId) throw new Error("Cannot update a tool without an active team.")
    if (isSaving.value) throw new Error("Tool save already in progress.")
    isSaving.value = true
    try {
      const { data } = await updateTeamCustomToolFn({ teamId, toolId, patch })
      return data.tool
    } finally {
      isSaving.value = false
    }
  }

  const archive = async (toolId: string): Promise<ITeamCustomTool> => {
    const teamId = currentTeamId.value
    if (!teamId)
      throw new Error("Cannot archive a tool without an active team.")
    if (isSaving.value) throw new Error("Tool save already in progress.")
    isSaving.value = true
    try {
      const { data } = await archiveTeamCustomToolFn({ teamId, toolId })
      return data.tool
    } finally {
      isSaving.value = false
    }
  }

  const restore = async (toolId: string): Promise<ITeamCustomTool> => {
    const teamId = currentTeamId.value
    if (!teamId)
      throw new Error("Cannot restore a tool without an active team.")
    if (isSaving.value) throw new Error("Tool save already in progress.")
    isSaving.value = true
    try {
      const { data } = await restoreTeamCustomToolFn({ teamId, toolId })
      return data.tool
    } finally {
      isSaving.value = false
    }
  }

  const setEnabled = async (
    toolId: string,
    enabled: boolean
  ): Promise<ITeamCustomTool> => {
    const teamId = currentTeamId.value
    if (!teamId) throw new Error("Cannot toggle a tool without an active team.")
    if (isSaving.value) throw new Error("Tool save already in progress.")
    isSaving.value = true
    try {
      const { data } = await setTeamCustomToolEnabledFn({
        teamId,
        toolId,
        enabled,
      })
      return data.tool
    } finally {
      isSaving.value = false
    }
  }

  const remove = async (toolId: string): Promise<void> => {
    const teamId = currentTeamId.value
    if (!teamId) throw new Error("Cannot delete a tool without an active team.")
    if (isSaving.value) throw new Error("Tool save already in progress.")
    isSaving.value = true
    try {
      await deleteTeamCustomToolFn({ teamId, toolId })
    } finally {
      isSaving.value = false
    }
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

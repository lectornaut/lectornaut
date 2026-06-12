/**
 * Integrations Store — unified read-model for the team's AGENT and TOOL
 * integrations, backed by the single `teams/{teamId}/integrations` collection.
 *
 * This is the client mirror of `functions/src/integrations.ts`'s resolver:
 *   - Reads the collection via the shared TanStack cache (`useCollectionQuery`,
 *     one ref-counted `onSnapshot` per team; Firestore rule allows member
 *     reads). Writes are callable-applied, but the store owns their OPTIMISTIC
 *     layer (`setEnabled` / `install` / `uninstall` / `remove`): it patches
 *     this same cache + holds the key against the listener, so every facade
 *     reading through it (`teamAgentsStore`, `teamCustomToolsStore`,
 *     `useIntegrations`) reflects the change instantly with one rollback path.
 *   - CATALOG OVERLAY: a built-in agent/tool resolves as installed+enabled
 *     UNLESS the team has a divergence doc (uninstalled → `archivedAt`, or
 *     disabled → `enabled:false`). A built-in with no doc has no row in the
 *     collection — it's synthesized from the code catalog here, preserving the
 *     old opt-out default with no migration. Built-in doc id == its catalog
 *     `sourceKey` (`_researcher`, `rollDice`); custom = Firestore auto-id.
 *
 * Workflows are the third building block but are NOT in this collection — they
 * live per-workspace in `teams/{teamId}/workspaces/{workspaceId}/workflows` with
 * their own store (`teamWorkflowsStore`).
 * The unified Integrations page composes both via `useIntegrationsRegistry`.
 * This store covers agents + tools only.
 */

import {
  deleteIntegration as deleteIntegrationFn,
  installIntegration as installIntegrationFn,
  setIntegrationEnabled as setIntegrationEnabledFn,
  uninstallIntegration as uninstallIntegrationFn,
  type DeleteIntegrationResponse,
  type IntegrationMutationResponse,
} from "@/composables/useFunctions"
import { BOT_TOOL_CATALOG } from "@/data/botTools"
import { BUILT_IN_AGENTS } from "@/data/builtInAgents"
import { firestore } from "@/modules/firebase"
import { queryClient } from "@/modules/queryClient"
import { useAuthStore } from "@/stores/authStore"
import type {
  IAgentIntegrationSpec,
  IToolIntegrationSpec,
} from "@/types/domain"
import {
  holdOptimistic,
  useCollectionQuery,
  type CollectionQuerySource,
} from "@/utils/firebase/firebase-query"
import { queryKeys } from "@/utils/firebase/firebase-query-keys"
import {
  collection,
  Timestamp,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed } from "vue"

// ─── Types ─────────────────────────────────────────────────────────────────

type AgentOrTool = "agent" | "tool"
type IntegrationSource = "builtin" | "custom" | "published"

/** A normalized stored doc (agent/tool only; spec null for built-ins). */
interface StoredIntegration {
  id: string
  teamId: string
  type: AgentOrTool
  source: IntegrationSource
  sourceKey: string | null
  name: string
  description: string
  avatarSeed: string
  enabled: boolean
  archivedAt: Timestamp | null
  spec: IAgentIntegrationSpec | IToolIntegrationSpec | null
  createdAt: Timestamp
  updatedAt: Timestamp
  createdByUid: string
}

/**
 * Effective integration after catalog overlay — what the UI renders.
 * `installed` = an active (non-archived) doc/overlay exists. `spec` is the
 * resolved persona for agents (catalog for built-ins, stored for custom) and
 * null for built-in tools (handler is server code, keyed by `sourceKey`).
 */
export interface ResolvedIntegration {
  id: string
  teamId: string
  type: AgentOrTool
  source: IntegrationSource
  sourceKey: string | null
  name: string
  description: string
  avatarSeed: string
  enabled: boolean
  installed: boolean
  archivedAt: Timestamp | null
  spec: IAgentIntegrationSpec | IToolIntegrationSpec | null
  createdAt: Timestamp
  updatedAt: Timestamp
  createdByUid: string
}

// ─── Normalization ───────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function builtInAgentSpec(id: string): IAgentIntegrationSpec | null {
  const def = BUILT_IN_AGENTS.find((a) => a.id === id)
  if (!def) return null
  return {
    systemPromptBase: def.systemPromptBase,
    promptSuffixes: { ...def.promptSuffixes },
    tools: { ...def.tools },
    customTools: {},
  }
}

/** Normalize a raw integration doc; returns null for non-agent/tool docs. */
function snapshotToStored(
  snap: QueryDocumentSnapshot
): StoredIntegration | null {
  const data = snap.data() ?? {}
  const type =
    data.type === "agent" ? "agent" : data.type === "tool" ? "tool" : null
  if (!type) return null // defensive — this collection holds only agent|tool
  const source: IntegrationSource =
    data.source === "custom" || data.source === "published"
      ? data.source
      : "builtin"
  // Built-ins are thin references — spec resolves from the catalog (overlay).
  const spec =
    source === "custom" && isRecord(data.spec)
      ? (data.spec as IAgentIntegrationSpec | IToolIntegrationSpec)
      : null
  return {
    id: snap.id,
    teamId: snap.ref.parent.parent?.id ?? "",
    type,
    source,
    sourceKey: typeof data.sourceKey === "string" ? data.sourceKey : null,
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    avatarSeed: typeof data.avatarSeed === "string" ? data.avatarSeed : "",
    enabled: typeof data.enabled === "boolean" ? data.enabled : true,
    archivedAt: data.archivedAt instanceof Timestamp ? data.archivedAt : null,
    spec,
    createdAt:
      data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    updatedAt:
      data.updatedAt instanceof Timestamp ? data.updatedAt : Timestamp.now(),
    createdByUid:
      typeof data.createdByUid === "string" ? data.createdByUid : "",
  }
}

function resolveStored(doc: StoredIntegration): ResolvedIntegration {
  let spec = doc.spec
  if (doc.source !== "custom" && doc.type === "agent" && doc.sourceKey) {
    spec = builtInAgentSpec(doc.sourceKey)
  } else if (doc.source !== "custom" && doc.type === "tool") {
    spec = null
  }
  return {
    id: doc.id,
    teamId: doc.teamId,
    type: doc.type,
    source: doc.source,
    sourceKey: doc.sourceKey,
    name: doc.name,
    description: doc.description,
    avatarSeed: doc.avatarSeed,
    enabled: doc.enabled,
    installed: doc.archivedAt === null,
    archivedAt: doc.archivedAt,
    spec,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdByUid: doc.createdByUid,
  }
}

// ─── Optimistic write helpers ────────────────────────────────────────────────

/** Addresses an integration: custom by `integrationId`, built-in by key. */
type IntegrationTarget = {
  integrationId?: string
  type?: AgentOrTool
  sourceKey?: string
}

const integrationsCacheKey = (teamId: string) =>
  queryKeys.list(`teams/${teamId}/integrations`)

/** Resolve a target to the stored doc the cache already holds, if any. */
function findStoredForTarget(
  docs: StoredIntegration[],
  target: IntegrationTarget
): StoredIntegration | null {
  if (target.integrationId) {
    return docs.find((d) => d.id === target.integrationId) ?? null
  }
  if (target.type && target.sourceKey) {
    return (
      docs.find(
        (d) =>
          d.source !== "custom" &&
          d.type === target.type &&
          d.sourceKey === target.sourceKey
      ) ?? null
    )
  }
  return null
}

/**
 * Build a synthetic divergence doc for a built-in that has no stored doc yet,
 * so an optimistic disable/uninstall has a row to render. The built-in doc id
 * IS its catalog `sourceKey`, so the server's real doc replaces this on the
 * next snapshot. Returns null for an unknown key (skip the optimistic insert).
 */
function synthesizeBuiltinDoc(
  teamId: string,
  type: AgentOrTool,
  sourceKey: string,
  flags: { enabled: boolean; archivedAt: Timestamp | null }
): StoredIntegration | null {
  const now = Timestamp.now()
  const base = {
    id: sourceKey,
    teamId,
    source: "builtin" as const,
    sourceKey,
    enabled: flags.enabled,
    archivedAt: flags.archivedAt,
    spec: null,
    createdAt: now,
    updatedAt: now,
    createdByUid: "",
  }
  if (type === "agent") {
    const def = BUILT_IN_AGENTS.find((a) => a.id === sourceKey)
    if (!def) return null
    return {
      ...base,
      type: "agent",
      name: def.name,
      description: def.description,
      avatarSeed: def.avatarSeed,
    }
  }
  const tool = BOT_TOOL_CATALOG.find((entry) => entry.name === sourceKey)
  if (!tool) return null
  return {
    ...base,
    type: "tool",
    name: tool.label,
    description: tool.description,
    avatarSeed: tool.name,
  }
}

/**
 * Patch the target's stored doc (enabled / archivedAt), synthesizing a built-in
 * divergence row when the target is a catalog key with no doc yet. Pure — the
 * store wraps it with the cache hold/rollback.
 */
function applyOptimisticIntegrationPatch(
  current: StoredIntegration[],
  teamId: string,
  target: IntegrationTarget,
  patch: Partial<Pick<StoredIntegration, "enabled" | "archivedAt">>
): StoredIntegration[] {
  const now = Timestamp.now()
  const existing = findStoredForTarget(current, target)
  if (existing) {
    return current.map((d) =>
      d === existing ? { ...d, ...patch, updatedAt: now } : d
    )
  }
  if (target.type && target.sourceKey) {
    const synth = synthesizeBuiltinDoc(teamId, target.type, target.sourceKey, {
      enabled: patch.enabled ?? true,
      archivedAt: patch.archivedAt ?? null,
    })
    if (synth) return [...current, synth]
  }
  return current
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useIntegrationsStore = defineStore("integrations", () => {
  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  const converter: FirestoreDataConverter<StoredIntegration | null> = {
    toFirestore: () => ({}),
    fromFirestore: (snapshot) => snapshotToStored(snapshot),
  }

  const query = useCollectionQuery<StoredIntegration | null>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      if (!teamId) return null
      const path = `teams/${teamId}/integrations`
      return {
        query: collection(firestore, path).withConverter(converter),
        path,
      }
    }
  )

  const isLoading = computed<boolean>(() => query.isLoading.value)
  const loadError = computed<string | null>(
    () => query.error.value?.message ?? null
  )

  /** Stored agent/tool docs (custom + diverged built-ins). */
  const docs = computed<StoredIntegration[]>(() =>
    (query.data.value ?? []).filter((d): d is StoredIntegration => !!d)
  )

  /**
   * Effective agent + tool integrations: every catalog built-in overlaid with
   * its divergence doc (or synthesized installed+enabled when none), plus all
   * custom docs. Mirrors `listIntegrations` server-side.
   */
  const integrations = computed<ResolvedIntegration[]>(() => {
    const byTypeKey = new Map<string, StoredIntegration>()
    const customs: StoredIntegration[] = []
    for (const d of docs.value) {
      if (d.source === "custom") customs.push(d)
      else if (d.sourceKey) byTypeKey.set(`${d.type}:${d.sourceKey}`, d)
    }

    const out: ResolvedIntegration[] = []
    // Built-in agents.
    for (const def of BUILT_IN_AGENTS) {
      const doc = byTypeKey.get(`agent:${def.id}`)
      out.push(
        doc
          ? resolveStored(doc)
          : {
              id: def.id,
              teamId: currentTeamId.value ?? "",
              type: "agent",
              source: "builtin",
              sourceKey: def.id,
              name: def.name,
              description: def.description,
              avatarSeed: def.avatarSeed,
              enabled: true,
              installed: true,
              archivedAt: null,
              spec: builtInAgentSpec(def.id),
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
              createdByUid: "",
            }
      )
    }
    // Built-in tools.
    for (const tool of BOT_TOOL_CATALOG) {
      const doc = byTypeKey.get(`tool:${tool.name}`)
      out.push(
        doc
          ? resolveStored(doc)
          : {
              id: tool.name,
              teamId: currentTeamId.value ?? "",
              type: "tool",
              source: "builtin",
              sourceKey: tool.name,
              name: tool.label,
              description: tool.description,
              avatarSeed: tool.name,
              enabled: true,
              installed: true,
              archivedAt: null,
              spec: null,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
              createdByUid: "",
            }
      )
    }
    // Published (connection-contributed) integrations are doc-backed — opt-in
    // by construction: no virtual synthesis, a row exists only after
    // `installConnection` writes it. Mirrors the server's `listIntegrations`
    // walk; without it these docs land in `byTypeKey` and never render.
    for (const d of docs.value) {
      if (d.source === "published") out.push(resolveStored(d))
    }
    // Custom agents + tools (always a doc).
    for (const d of customs) out.push(resolveStored(d))
    return out
  })

  const agentIntegrations = computed<ResolvedIntegration[]>(() =>
    integrations.value.filter((i) => i.type === "agent")
  )
  const toolIntegrations = computed<ResolvedIntegration[]>(() =>
    integrations.value.filter((i) => i.type === "tool")
  )

  /** O(1)-ish lookup by id (built-in id == sourceKey; custom == auto-id). */
  const getById = (id: string): ResolvedIntegration | null =>
    integrations.value.find((i) => i.id === id) ?? null

  /** Installed + enabled — the dispatch-eligible set (mirrors listDispatchable). */
  const dispatchable = computed<ResolvedIntegration[]>(() =>
    integrations.value.filter((i) => i.installed && i.enabled)
  )

  // ── Optimistic writes (cache patch + hold + rollback; callable-applied) ───
  //
  // These wrap the unified `integration*` callables with the same hold-the-key
  // pattern the attachment composables use: apply the change to THIS store's
  // `teams/{teamId}/integrations` cache synchronously, hold the key so the live
  // listener can't echo pre-apply state, run the callable, then reconcile on
  // the held snapshot's release (or roll back on failure). The `integrations`
  // overlay re-derives downstream, so every facade reflects the change at once.

  const runIntegrationWrite = async <T>(
    teamId: string,
    applyOptimistic: (current: StoredIntegration[]) => StoredIntegration[],
    run: () => Promise<T>
  ): Promise<T> => {
    const key = integrationsCacheKey(teamId)
    const previous = queryClient.getQueryData<(StoredIntegration | null)[]>(key)
    const release = holdOptimistic(key)
    queryClient.setQueryData<(StoredIntegration | null)[]>(
      key,
      applyOptimistic(
        (previous ?? []).filter((d): d is StoredIntegration => !!d)
      )
    )
    try {
      return await run()
    } catch (error) {
      queryClient.setQueryData(key, previous)
      throw error
    } finally {
      setTimeout(() => release(), 120)
    }
  }

  const requireTeamId = (): string => {
    const teamId = currentTeamId.value
    if (!teamId) throw new Error("No active team.")
    return teamId
  }

  /** Enable/disable. Custom via `integrationId`; built-in via `type`+`sourceKey`. */
  const setEnabled = (
    target: IntegrationTarget,
    enabled: boolean
  ): Promise<IntegrationMutationResponse> => {
    const teamId = requireTeamId()
    return runIntegrationWrite(
      teamId,
      (current) =>
        applyOptimisticIntegrationPatch(current, teamId, target, { enabled }),
      () =>
        setIntegrationEnabledFn({ teamId, ...target, enabled }).then(
          (r) => r.data
        )
    )
  }

  /** Install / restore (un-archive). Built-in via key, custom via id. */
  const install = (
    target: IntegrationTarget
  ): Promise<IntegrationMutationResponse> => {
    const teamId = requireTeamId()
    return runIntegrationWrite(
      teamId,
      (current) =>
        applyOptimisticIntegrationPatch(current, teamId, target, {
          archivedAt: null,
        }),
      () => installIntegrationFn({ teamId, ...target }).then((r) => r.data)
    )
  }

  /** Uninstall / archive (soft). Built-in via key, custom via id. */
  const uninstall = (
    target: IntegrationTarget
  ): Promise<IntegrationMutationResponse> => {
    const teamId = requireTeamId()
    return runIntegrationWrite(
      teamId,
      (current) =>
        applyOptimisticIntegrationPatch(current, teamId, target, {
          archivedAt: Timestamp.now(),
        }),
      () => uninstallIntegrationFn({ teamId, ...target }).then((r) => r.data)
    )
  }

  /** Hard-delete a custom integration (drops the row). */
  const remove = (
    integrationId: string
  ): Promise<DeleteIntegrationResponse> => {
    const teamId = requireTeamId()
    return runIntegrationWrite(
      teamId,
      (current) => current.filter((d) => d.id !== integrationId),
      () => deleteIntegrationFn({ teamId, integrationId }).then((r) => r.data)
    )
  }

  return {
    isLoading,
    loadError,
    integrations,
    agentIntegrations,
    toolIntegrations,
    dispatchable,
    getById,
    // Optimistic writes (shared by the agent/tool facades + useIntegrations).
    setEnabled,
    install,
    uninstall,
    remove,
  }
})

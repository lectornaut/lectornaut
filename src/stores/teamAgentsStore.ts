/**
 * Team Agents Store — single source of truth for the team's custom
 * multi-agent network.
 *
 * Three consumer surfaces share this store:
 *
 *   1. `SettingsCustomAgents.vue` (admin) — CRUD UI: list + per-card
 *      editor. The canonical *writer*; gates write actions via the
 *      `useMembershipStore` admin check (wrapped in
 *      `useTeamAgents` for i18n toasts).
 *
 *   2. `Agents.vue` sidebar (every member) — renders one item per
 *      active agent; clicking opens a chat focused on that agent.
 *      Read-only access to `activeAgents`. Phase 4.
 *
 *   3. `AiChatComposer.vue` (every member) — renders agent badges in
 *      the tool drawer; picking one binds the next send to that agent.
 *      Read-only access to `activeAgents`. Phase 3.
 *
 * Storage model:
 *   - Path:  teams/{teamId}/agents/{agentId}
 *   - Read:  via the shared TanStack query cache (`useCollectionQuery`),
 *            which holds one ref-counted `onSnapshot` per team's agents
 *            collection (Firestore rule allows `isTeamMember` reads).
 *            Writes are callable-only.
 *   - Soft-delete: `archivedAt` set by the archive callable; archived
 *            docs stay readable so chat sessions referencing them
 *            still resolve. Pickers filter by `activeAgents`.
 *
 * Race safety: the query key embeds the teamId, so switching teams is a
 * key swap — the old team's listener is released and the new team's
 * cached data renders while its listener reconnects. A late snapshot for
 * the previous team lands under its own (now unobserved) key and can't
 * clobber the active team's state, so no manual race guard is needed.
 */

import {
  archiveTeamAgent as archiveTeamAgentFn,
  createTeamAgent as createTeamAgentFn,
  deleteTeamAgent as deleteTeamAgentFn,
  restoreTeamAgent as restoreTeamAgentFn,
  setTeamAgentEnabled as setTeamAgentEnabledFn,
  updateTeamAgent as updateTeamAgentFn,
  type CreateTeamAgentDraft,
  type UpdateTeamAgentPatch,
} from "@/composables/useFunctions"
import { BUILT_IN_AGENTS, hydrateBuiltInAgent } from "@/data/builtInAgents"
import { firestore } from "@/modules/firebase"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import type { ITeamAgent } from "@/types/domain"
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  // Directory-listing companion to search; per-agent toggle, default true.
  listWorkspaceNodes: true,
  summarizeNode: true,
  // Real per-agent toggles for the multi-doc + nearest-neighbor tools.
  // Both read-only; default true so existing agents pick them up.
  compareNodes: true,
  findRelatedNodes: true,
  // Real per-agent toggles (unlike the three "type alignment only" gates
  // below): dispatch reads `agent.tools.manageContent` for the node-WRITE
  // tools and `agent.tools.readContent` for the node-READ tool. Default
  // true so existing agents keep node editing + reading.
  manageContent: true,
  readContent: true,
  // Mirrors the server-side default — see the JSDoc on
  // `botAgentToolTogglesSchema.customAgents`. Present for type
  // alignment; the per-agent value is never consumed by dispatch
  // (the team config's value is the canonical gate).
  customAgents: true,
  // Team-wide gate for custom (user-authored) workflows; per-agent value
  // ignored (the team config's value is canonical). Default true.
  customWorkflows: true,
  // Likewise carried for type alignment with the team-level toggle
  // schema — the per-agent value is ignored. Custom tools are gated
  // by the team-level `customTools` flag and (in the future) per-tool
  // assignments to agents.
  customTools: true,
  // Team feature gate (inspector summary button) — carried for type
  // alignment only; never consumed per-agent.
  summarizeNodeInspector: true,
}

/**
 * Normalize a Firestore doc snapshot into an `ITeamAgent`. Mirrors the
 * server-side `normalizeAgentDoc` — missing nested keys default to ""
 * (suffixes) and `true` (tools) so a doc written before a new tool key
 * existed still reads as if all tools were enabled. Keeps the client
 * and server in lockstep without a migration.
 */
function snapshotToAgent(
  teamId: string,
  snap: QueryDocumentSnapshot
): ITeamAgent {
  const data = snap.data() ?? {}
  const promptSuffixesRaw =
    data.promptSuffixes && typeof data.promptSuffixes === "object"
      ? (data.promptSuffixes as Record<string, unknown>)
      : {}
  const toolsRaw =
    data.tools && typeof data.tools === "object"
      ? (data.tools as Record<string, unknown>)
      : {}

  return {
    id: snap.id,
    teamId,
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    avatarSeed: typeof data.avatarSeed === "string" ? data.avatarSeed : "",
    systemPromptBase:
      typeof data.systemPromptBase === "string" ? data.systemPromptBase : "",
    promptSuffixes: {
      auto:
        typeof promptSuffixesRaw.auto === "string"
          ? (promptSuffixesRaw.auto as string)
          : DEFAULT_PROMPT_SUFFIXES.auto,
      agent:
        typeof promptSuffixesRaw.agent === "string"
          ? (promptSuffixesRaw.agent as string)
          : DEFAULT_PROMPT_SUFFIXES.agent,
      manual:
        typeof promptSuffixesRaw.manual === "string"
          ? (promptSuffixesRaw.manual as string)
          : DEFAULT_PROMPT_SUFFIXES.manual,
    },
    tools: {
      rollDice:
        typeof toolsRaw.rollDice === "boolean"
          ? (toolsRaw.rollDice as boolean)
          : DEFAULT_TOOL_TOGGLES.rollDice,
      browseInternet:
        typeof toolsRaw.browseInternet === "boolean"
          ? (toolsRaw.browseInternet as boolean)
          : DEFAULT_TOOL_TOGGLES.browseInternet,
      askQuestion:
        typeof toolsRaw.askQuestion === "boolean"
          ? (toolsRaw.askQuestion as boolean)
          : DEFAULT_TOOL_TOGGLES.askQuestion,
      searchWorkspaceNodes:
        typeof toolsRaw.searchWorkspaceNodes === "boolean"
          ? (toolsRaw.searchWorkspaceNodes as boolean)
          : DEFAULT_TOOL_TOGGLES.searchWorkspaceNodes,
      listWorkspaceNodes:
        typeof toolsRaw.listWorkspaceNodes === "boolean"
          ? (toolsRaw.listWorkspaceNodes as boolean)
          : DEFAULT_TOOL_TOGGLES.listWorkspaceNodes,
      summarizeNode:
        typeof toolsRaw.summarizeNode === "boolean"
          ? (toolsRaw.summarizeNode as boolean)
          : DEFAULT_TOOL_TOGGLES.summarizeNode,
      compareNodes:
        typeof toolsRaw.compareNodes === "boolean"
          ? (toolsRaw.compareNodes as boolean)
          : DEFAULT_TOOL_TOGGLES.compareNodes,
      findRelatedNodes:
        typeof toolsRaw.findRelatedNodes === "boolean"
          ? (toolsRaw.findRelatedNodes as boolean)
          : DEFAULT_TOOL_TOGGLES.findRelatedNodes,
      // Real per-agent gates for the node tools — consumed at dispatch
      // (intersected with the team toggle + membership). `manageContent`
      // gates the write tools; `readContent` gates `readNode`.
      manageContent:
        typeof toolsRaw.manageContent === "boolean"
          ? (toolsRaw.manageContent as boolean)
          : DEFAULT_TOOL_TOGGLES.manageContent,
      readContent:
        typeof toolsRaw.readContent === "boolean"
          ? (toolsRaw.readContent as boolean)
          : DEFAULT_TOOL_TOGGLES.readContent,
      // See `DEFAULT_TOOL_TOGGLES.customAgents` — present for shape
      // alignment with the team-level toggle schema; never consumed.
      customAgents:
        typeof toolsRaw.customAgents === "boolean"
          ? (toolsRaw.customAgents as boolean)
          : DEFAULT_TOOL_TOGGLES.customAgents,
      customWorkflows:
        typeof toolsRaw.customWorkflows === "boolean"
          ? (toolsRaw.customWorkflows as boolean)
          : DEFAULT_TOOL_TOGGLES.customWorkflows,
      // Likewise present for shape alignment only — see `DEFAULT_TOOL_TOGGLES.customTools`.
      customTools:
        typeof toolsRaw.customTools === "boolean"
          ? (toolsRaw.customTools as boolean)
          : DEFAULT_TOOL_TOGGLES.customTools,
      // Team feature gate — shape alignment only; per-agent value unused.
      summarizeNodeInspector:
        typeof toolsRaw.summarizeNodeInspector === "boolean"
          ? (toolsRaw.summarizeNodeInspector as boolean)
          : DEFAULT_TOOL_TOGGLES.summarizeNodeInspector,
    },
    // Per-custom-tool overrides for this agent. Reads only boolean
    // values (mirrors the server-side normalizer) so a malformed
    // entry can't poison the dispatch path. Empty default — missing
    // keys at dispatch time mean "use the team-level state."
    customTools: (() => {
      const raw = data.customTools
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
      const out: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(
        raw as Record<string, unknown>
      )) {
        if (typeof value === "boolean") out[key] = value
      }
      return out
    })(),
    // Default-true so docs written before `enabled` existed continue
    // dispatching normally — same normalization as the server's
    // `normalizeAgentDoc`. The lifecycle UI shows them as "active"
    // until an admin explicitly flips the toggle.
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

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTeamAgentsStore = defineStore("teamAgents", () => {
  const authStore = useAuthStore()
  const { currentTeamId } = storeToRefs(authStore)

  // Team-wide gate for the entire feature. Read from the team's
  // agent-config store (the same source that drives the Tools-section
  // toggle in `SettingsAgents.vue`). When false:
  //   - `selectableAgents` returns [] → sidebar + composer pickers
  //     hide automatically.
  //   - The settings cog button next to the toggle in `SettingsAgents`
  //     is disabled.
  //   - Server dispatch (`bot.ts`) skips the Firestore read and
  //     forces a fallback to the team default for every turn.
  //
  // The store still surfaces `disabledAgents` and `archivedAgents`
  // unchanged — admins reaching the management dialog need to see
  // existing agents even when the feature is globally gated, so they
  // can edit + tidy up before re-enabling.
  const agentConfigStore = useAgentConfigStore()
  const { config: teamAgentConfig } = storeToRefs(agentConfigStore)
  const customAgentsEnabled = computed<boolean>(
    () => teamAgentConfig.value.tools.customAgents !== false
  )
  const customWorkflowsEnabled = computed<boolean>(
    () => teamAgentConfig.value.tools.customWorkflows !== false
  )

  const isSaving = ref(false)

  /**
   * Firestore converter that funnels every read through `snapshotToAgent`
   * (which mirrors the server's `normalizeAgentDoc`), so cached docs are
   * normalized exactly as the old manual mapping did. `teamId` is recovered
   * from the doc path (`teams/{teamId}/agents/{id}`). `toFirestore` is never
   * exercised — writes go through the Cloud Functions above, not this ref.
   */
  const agentConverter: FirestoreDataConverter<ITeamAgent> = {
    toFirestore: () => ({}),
    fromFirestore: (snapshot) =>
      snapshotToAgent(snapshot.ref.parent.parent?.id ?? "", snapshot),
  }

  /**
   * Every agent for the active team — active AND archived. Computed views
   * (`activeAgents`, `archivedAgents`) filter by `archivedAt` so pickers and
   * admin lists don't re-implement the predicate. Empty while loading or when
   * no team is selected.
   *
   * Read through the shared TanStack cache: one live `onSnapshot` per
   * `teams/{teamId}/agents`, ref-counted and gc-torn-down by
   * `useCollectionQuery`. The query key embeds the teamId, so switching teams
   * releases the old listener and renders the new team's cached data (if any)
   * immediately while its listener reconnects — the per-team race guard the
   * old manual subscription needed is now structural. Writes still flow through
   * the Cloud Functions above; the listener reflects them within milliseconds.
   */
  const agentsQuery = useCollectionQuery<ITeamAgent>(
    (): CollectionQuerySource | null => {
      const teamId = currentTeamId.value
      if (!teamId) return null
      const path = `teams/${teamId}/agents`
      return {
        query: collection(firestore, path).withConverter(agentConverter),
        path,
      }
    }
  )

  const agents = computed<ITeamAgent[]>(() => agentsQuery.data.value ?? [])
  const isLoading = computed<boolean>(() => agentsQuery.isLoading.value)
  const loadError = computed<string | null>(
    () => agentsQuery.error.value?.message ?? null
  )

  /**
   * The teamId whose `agents` are currently loaded, or `null` while pending /
   * teamless. Retained for API compatibility; with per-team query keys it is a
   * thin derivation of the active team once the first snapshot has landed.
   */
  const loadedTeamId = computed<string | null>(() =>
    agentsQuery.data.value !== undefined ? currentTeamId.value : null
  )

  // ── Derived views ────────────────────────────────────────────────────────
  //
  // The lifecycle has four states (active / disabled / archived /
  // deleted) derived from two fields (`enabled`, `archivedAt`) plus
  // doc-presence. Views below carve up the collection by use case:
  //
  //   - selectableAgents — admin CRUD list (SettingsCustomAgents /
  //     SettingsAgents). Selectable custom agents only — built-ins
  //     have no Firestore doc and can't be edited/archived through
  //     this surface, so including them here would surface rows with
  //     non-functional Edit/Archive buttons.
  //   - pickerAgents     — what end-user pickers (composer badges,
  //     sidebar `Agents.vue`) render. Built-ins (gated per-id by
  //     `agentConfig.builtInAgents`) come first in their declared
  //     order, then selectable custom agents alphabetized. Mirrors
  //     the server's `[...builtInAgents, ...customAgents]` ordering
  //     in `prepareChatTurn` so the on-screen list matches dispatch.
  //   - allAgents        — built-ins + every custom (including
  //     disabled and archived). Used by `useBotChat.activeAgent` to
  //     resolve the id of the currently-bound agent regardless of
  //     lifecycle state — without built-ins here, picking a built-in
  //     would render the composer badge as "Deleted" because the
  //     lookup would miss.
  //   - disabledAgents / archivedAgents — admin-only views for the
  //     lifecycle sections in `SettingsCustomAgents`. Built-ins
  //     never appear here (the concept doesn't apply — the only
  //     on/off knob for a built-in is the team-config toggle, edited
  //     elsewhere).

  /**
   * Hydrated built-in presets allowed by the team's config. Gating
   * mirrors the server (`functions/src/builtInAgents.ts::listBuiltInAgents`)
   * so what the user sees in the picker matches what dispatch will
   * actually use:
   *   - team-wide `customAgents` OFF  → empty list (the feature gate
   *     hides built-ins AND customs uniformly).
   *   - per-id `builtInAgents[<id>] === false` → that preset filtered
   *     out; missing keys normalize to enabled (opt-out semantics).
   *
   * Order is the declaration order in `BUILT_IN_AGENTS` — keep
   * customer-facing presets first there. Empty when no team is loaded.
   */
  const builtInAgents = computed<ITeamAgent[]>(() => {
    if (!customAgentsEnabled.value) return []
    const teamId = currentTeamId.value
    if (!teamId) return []
    const toggles = teamAgentConfig.value.builtInAgents
    return BUILT_IN_AGENTS.filter(
      (definition) => toggles?.[definition.id] !== false
    ).map((definition) => hydrateBuiltInAgent(teamId, definition))
  })

  /**
   * Custom agents the admin can manage from the CRUD UI — enabled
   * AND non-archived. Sorted by name for stable rendering. Used by
   * `SettingsCustomAgents.vue` + `SettingsAgents.vue`'s row list;
   * built-ins are deliberately absent because the management
   * affordances (edit / archive / disable) don't apply to them.
   *
   * When `customAgentsEnabled` is false, returns `[]` so the admin
   * UI's active section collapses to the empty state.
   */
  const selectableAgents = computed<ITeamAgent[]>(() => {
    if (!customAgentsEnabled.value) return []
    return agents.value
      .filter((agent) => agent.enabled !== false && !agent.archivedAt)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  /**
   * What end-user pickers render: built-ins first (in declaration
   * order, customer-facing personas surface first), then selectable
   * custom agents alphabetically. This is the merged view the
   * composer's badge row and `Agents.vue` sidebar bind to — it
   * matches the server's `[...builtInAgents, ...customAgents]`
   * ordering in `prepareChatTurn`, so what the user picks visually
   * lines up with the transfer roster the model sees.
   *
   * Empty when `customAgentsEnabled` is false (both inner computeds
   * return `[]` in that state).
   */
  const pickerAgents = computed<ITeamAgent[]>(() => [
    ...builtInAgents.value,
    ...selectableAgents.value,
  ])

  /**
   * Union of built-ins + every custom record (including disabled and
   * archived). Used by `useBotChat.activeAgent` to resolve the
   * currently-bound agent's display record regardless of lifecycle
   * state — without this, picking a built-in would render the
   * composer's status badge as "Deleted" because the lookup against
   * the customs-only `agents` ref would miss. Mirrors how
   * `prepareChatTurn` resolves available agents server-side, plus
   * the not-currently-selectable customs the badge still needs to
   * render (e.g. archived agents pinned to an ongoing session).
   */
  const allAgents = computed<ITeamAgent[]>(() => [
    ...builtInAgents.value,
    ...agents.value,
  ])

  /**
   * Backwards-compat alias for `pickerAgents`. The old `activeAgents`
   * name predates built-in support; consumers that imported it for
   * the picker surface automatically pick up the merged list without
   * a rename.
   */
  const activeAgents = pickerAgents

  /**
   * Disabled agents — `enabled === false` AND not archived. Admin-
   * only view, surfaced in its own collapsible section so the toggle
   * status is discoverable but doesn't pollute the active list.
   * Disabled-AND-archived agents land in `archivedAgents` instead so
   * the user sees the stronger lifecycle signal first.
   */
  const disabledAgents = computed<ITeamAgent[]>(() =>
    agents.value
      .filter((agent) => agent.enabled === false && !agent.archivedAt)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  /**
   * Archived agents, sorted newest-archived first. Regardless of
   * `enabled` — an agent that's both disabled and archived shows up
   * here (the archive state is the stronger signal for the admin's
   * decision tree: "I'm phasing this out").
   */
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

  /**
   * O(1) lookup by id. Returns `null` for unknown ids so callers can
   * branch on missing-agent (vs the empty default object) without
   * tripping on stale references after an archive/delete.
   */
  const getById = (agentId: string): ITeamAgent | null =>
    agents.value.find((agent) => agent.id === agentId) ?? null

  // ── Mutations (admin only — server enforces) ────────────────────────────

  const create = async (draft: CreateTeamAgentDraft): Promise<ITeamAgent> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      throw new Error("Cannot create an agent without an active team.")
    }
    if (isSaving.value) {
      throw new Error("Agent save already in progress.")
    }
    isSaving.value = true
    try {
      const { data } = await createTeamAgentFn({ teamId, draft })
      // The subscription will receive the new doc within milliseconds —
      // no manual list splice needed. Return the server's view so
      // callers (e.g. the editor card) can switch to "edit mode" on
      // the newly-created agent immediately.
      return data.agent
    } finally {
      isSaving.value = false
    }
  }

  const update = async (
    agentId: string,
    patch: UpdateTeamAgentPatch
  ): Promise<ITeamAgent> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      throw new Error("Cannot update an agent without an active team.")
    }
    if (isSaving.value) {
      throw new Error("Agent save already in progress.")
    }
    isSaving.value = true
    try {
      const { data } = await updateTeamAgentFn({ teamId, agentId, patch })
      return data.agent
    } finally {
      isSaving.value = false
    }
  }

  const archive = async (agentId: string): Promise<ITeamAgent> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      throw new Error("Cannot archive an agent without an active team.")
    }
    if (isSaving.value) {
      throw new Error("Agent save already in progress.")
    }
    isSaving.value = true
    try {
      const { data } = await archiveTeamAgentFn({ teamId, agentId })
      return data.agent
    } finally {
      isSaving.value = false
    }
  }

  const restore = async (agentId: string): Promise<ITeamAgent> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      throw new Error("Cannot restore an agent without an active team.")
    }
    if (isSaving.value) {
      throw new Error("Agent save already in progress.")
    }
    isSaving.value = true
    try {
      const { data } = await restoreTeamAgentFn({ teamId, agentId })
      return data.agent
    } finally {
      isSaving.value = false
    }
  }

  /**
   * Flip an agent's `enabled` toggle. The Firestore subscription
   * receives the doc update within a tick — `selectableAgents` and
   * `disabledAgents` re-derive automatically, so pickers reflect the
   * new state without manual cache invalidation.
   */
  const setEnabled = async (
    agentId: string,
    enabled: boolean
  ): Promise<ITeamAgent> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      throw new Error("Cannot toggle an agent without an active team.")
    }
    if (isSaving.value) {
      throw new Error("Agent save already in progress.")
    }
    isSaving.value = true
    try {
      const { data } = await setTeamAgentEnabledFn({
        teamId,
        agentId,
        enabled,
      })
      return data.agent
    } finally {
      isSaving.value = false
    }
  }

  /**
   * Hard-delete an agent. Irreversible — the Firestore doc is removed
   * entirely. The subscription drops it from the list within a tick;
   * any session with `activeAgentId === agentId` will start rendering
   * a "Deleted" badge once `useBotChat.activeAgentStatus` re-evaluates
   * against the now-missing record.
   *
   * Returns `void` rather than the deleted agent shape — there's
   * nothing useful to return after a delete, and the caller already
   * has the agent record from before the call if it needs the name.
   */
  const remove = async (agentId: string): Promise<void> => {
    const teamId = currentTeamId.value
    if (!teamId) {
      throw new Error("Cannot delete an agent without an active team.")
    }
    if (isSaving.value) {
      throw new Error("Agent save already in progress.")
    }
    isSaving.value = true
    try {
      await deleteTeamAgentFn({ teamId, agentId })
    } finally {
      isSaving.value = false
    }
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
    create,
    update,
    archive,
    restore,
    setEnabled,
    remove,
  }
})

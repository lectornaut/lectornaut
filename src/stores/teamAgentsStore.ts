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
 *   - Read:  direct Firestore subscription (Firestore rule allows
 *            `isTeamMember` reads). Writes are callable-only.
 *   - Soft-delete: `archivedAt` set by the archive callable; archived
 *            docs stay readable so chat sessions referencing them
 *            still resolve. Pickers filter by `activeAgents`.
 *
 * Race safety: switching teams tears down the old `onSnapshot` and
 * spins up a fresh one for the new team. A snapshot that arrives after
 * a team switch is filtered out by `loadedTeamId` so a stale response
 * can't overwrite newer state. Pattern mirrors `agentConfigStore`.
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
import { firestore } from "@/modules/firebase"
import { useAgentConfigStore } from "@/stores/agentConfigStore"
import { useAuthStore } from "@/stores/authStore"
import type { ITeamAgent } from "@/types/domain"
import {
  collection,
  onSnapshot,
  Timestamp,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref, watch } from "vue"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_PROMPT_SUFFIXES: ITeamAgent["promptSuffixes"] = {
  auto: "",
  agent: "",
  manual: "",
}

const DEFAULT_TOOL_TOGGLES: ITeamAgent["tools"] = {
  getWeather: true,
  rollDice: true,
  askQuestion: true,
  searchWorkspaceNodes: true,
  summarizeNode: true,
  // Mirrors the server-side default — see the JSDoc on
  // `botAgentToolTogglesSchema.customAgents`. Present for type
  // alignment; the per-agent value is never consumed by dispatch.
  customAgents: true,
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
      getWeather:
        typeof toolsRaw.getWeather === "boolean"
          ? (toolsRaw.getWeather as boolean)
          : DEFAULT_TOOL_TOGGLES.getWeather,
      rollDice:
        typeof toolsRaw.rollDice === "boolean"
          ? (toolsRaw.rollDice as boolean)
          : DEFAULT_TOOL_TOGGLES.rollDice,
      askQuestion:
        typeof toolsRaw.askQuestion === "boolean"
          ? (toolsRaw.askQuestion as boolean)
          : DEFAULT_TOOL_TOGGLES.askQuestion,
      searchWorkspaceNodes:
        typeof toolsRaw.searchWorkspaceNodes === "boolean"
          ? (toolsRaw.searchWorkspaceNodes as boolean)
          : DEFAULT_TOOL_TOGGLES.searchWorkspaceNodes,
      summarizeNode:
        typeof toolsRaw.summarizeNode === "boolean"
          ? (toolsRaw.summarizeNode as boolean)
          : DEFAULT_TOOL_TOGGLES.summarizeNode,
      // See `DEFAULT_TOOL_TOGGLES.customAgents` — present for shape
      // alignment with the team-level toggle schema; never consumed.
      customAgents:
        typeof toolsRaw.customAgents === "boolean"
          ? (toolsRaw.customAgents as boolean)
          : DEFAULT_TOOL_TOGGLES.customAgents,
    },
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

  /**
   * Every agent for the active team — active AND archived. Computed
   * views (`activeAgents`, `archivedAgents`) filter by `archivedAt` so
   * pickers and admin lists don't have to re-implement the predicate.
   * Empty array while loading or when no team is selected.
   */
  const agents = ref<ITeamAgent[]>([])
  const isLoading = ref(false)
  const isSaving = ref(false)
  const loadError = ref<string | null>(null)

  /**
   * The teamId that `agents` currently reflects. Used as a race guard:
   * snapshot callbacks arriving after a team switch carry the stale
   * teamId and are dropped instead of overwriting the new team's state.
   * `null` means "no team loaded yet" (initial state or post-switch
   * while the new subscription's first snapshot is pending).
   */
  const loadedTeamId = ref<string | null>(null)

  /**
   * Handle to the active `onSnapshot` subscription. Stored at module
   * scope (not in the watcher closure) so the watcher's cleanup can
   * tear it down before spinning up a new one for the next team.
   */
  let unsubscribe: Unsubscribe | null = null

  const teardownSubscription = (): void => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  const startSubscription = (teamId: string): void => {
    teardownSubscription()
    isLoading.value = true
    loadError.value = null

    const ref = collection(firestore, `teams/${teamId}/agents`)
    unsubscribe = onSnapshot(
      ref,
      (snap) => {
        // Race guard: a snapshot arriving after the user switched teams
        // is for the wrong collection — drop rather than clobber. The
        // next subscription's first emission will land soon.
        if (currentTeamId.value !== teamId) return
        agents.value = snap.docs.map((doc) => snapshotToAgent(teamId, doc))
        loadedTeamId.value = teamId
        isLoading.value = false
      },
      (error) => {
        if (currentTeamId.value !== teamId) return
        console.error("[teamAgentsStore] subscription error:", error)
        loadError.value =
          error instanceof Error ? error.message : "Failed to load team agents."
        isLoading.value = false
      }
    )
  }

  // ── Derived views ────────────────────────────────────────────────────────
  //
  // The lifecycle has four states (active / disabled / archived /
  // deleted) derived from two fields (`enabled`, `archivedAt`) plus
  // doc-presence. Views below carve up the collection by use case:
  //
  //   - selectableAgents — what pickers (sidebar + composer badges)
  //     render. Enabled AND non-archived only.
  //   - disabledAgents   — admin-only view: agents with `enabled =
  //     false` and `archivedAt = null`. Stay in their own collapsed
  //     section so the active list isn't noisy.
  //   - archivedAgents   — admin-only view: archived regardless of
  //     `enabled`. Still dispatch in ongoing chats (the new "archive
  //     = deprecate" semantics), so they're not removed from the
  //     team's data plane the way deleted ones are.
  //
  // The `activeAgents` alias preserves the historical (pre-disable)
  // semantics so the sidebar / composer / Agents.vue don't need to
  // rename their bindings — it's now just sugar for
  // `selectableAgents`.

  /**
   * Agents the user can select from pickers: enabled AND non-archived
   * AND the team-wide feature is on. Sorted by name for stable
   * rendering. This is what `Agents.vue`, the composer's agent
   * picker, and the active agents section of the management dialog
   * all render.
   *
   * When `customAgentsEnabled` is false, returns `[]` immediately so
   * pickers collapse without any further filtering — the visible
   * surface for the feature disappears, and admins must re-enable
   * the toggle from `SettingsAgents.vue` to bring it back.
   */
  const selectableAgents = computed<ITeamAgent[]>(() => {
    if (!customAgentsEnabled.value) return []
    return agents.value
      .filter((agent) => agent.enabled !== false && !agent.archivedAt)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  /**
   * Backwards-compat alias for `selectableAgents`. Several consumers
   * (composer, sidebar) reference this name; keeping the alias means
   * the lifecycle change doesn't touch their call sites — they
   * automatically gain the new selectability semantics.
   */
  const activeAgents = selectableAgents

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

  // ── Lifecycle: (re)subscribe when team flips ────────────────────────────
  //
  // `immediate: true` so the first mount kicks off a subscription. The
  // subscription itself is what populates `agents`; until the first
  // snapshot lands, consumers see `[]` (handled in the UI with a
  // loading state via `isLoading`).
  watch(
    currentTeamId,
    (teamId) => {
      teardownSubscription()
      if (!teamId) {
        agents.value = []
        loadedTeamId.value = null
        isLoading.value = false
        loadError.value = null
        return
      }
      startSubscription(teamId)
    },
    { immediate: true }
  )

  return {
    agents,
    activeAgents,
    selectableAgents,
    disabledAgents,
    archivedAgents,
    customAgentsEnabled,
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

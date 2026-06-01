/**
 * Team-scoped custom agents — CRUD + lifecycle callables.
 *
 * Each team has a flat collection of custom agents at
 *   teams/{teamId}/agents/{agentId}
 *
 * Together with the team default at `teams/{teamId}/settings/agent`,
 * these agents form a multi-agent network. The composer / sidebar
 * selects which agent handles each chat turn; `bot.ts` dispatches
 * accordingly, with `agents.ts`'s `resolveActiveAgent` enforcing the
 * lifecycle gates below.
 *
 * Auth layering:
 *   - App Check + signed-in + email_verified enforced via
 *     `requireVerifiedAuth` at every callable boundary.
 *   - Owner/admin role enforced by `assertAdminRole` inside each
 *     handler. Non-admin reads happen client-side via Firestore
 *     subscription — `firestore.rules` lets any team member read the
 *     collection so pickers can render live.
 *
 * Lifecycle model (four states from two fields + doc presence):
 *
 *   | state    | `enabled`     | `archivedAt`     | doc present | dispatch        |
 *   |----------|---------------|------------------|-------------|-----------------|
 *   | active   | true          | null             | yes         | runs            |
 *   | disabled | false         | null OR set      | yes         | falls back      |
 *   | archived | true          | Timestamp        | yes         | RUNS (deprecate)|
 *   | deleted  | (n/a)         | (n/a)            | NO          | falls back      |
 *
 *   - `setTeamAgentEnabled` flips the on/off toggle (admin Switch row).
 *   - `archiveTeamAgent` + `restoreTeamAgent` set / clear `archivedAt`.
 *     Archived agents are HIDDEN from pickers but KEEP RUNNING for
 *     chats that already selected them — admins use archive to
 *     deprecate a persona without breaking ongoing conversations.
 *   - `deleteTeamAgent` removes the doc entirely (irreversible).
 *     Existing chats fall back to the team default and the composer
 *     renders a "Deleted" badge so the user sees why.
 *
 * Caps:
 *   - `MAX_ACTIVE_AGENTS_PER_TEAM` (50): non-archived count cap.
 *     Disabling alone doesn't free a slot (the doc still exists and
 *     can be re-enabled). Admins archive (deprecate) or hard-delete
 *     to make room.
 */

import { HttpsError, onCall } from "firebase-functions/v2/https"
import { z } from "zod"
import { getMembershipRole, requireVerifiedAuth } from "./bot.js"
import { admin, db } from "./firebase.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import type { IMembershipRole } from "./types.js"

// ─── Constants ──────────────────────────────────────────────────────────────

const ADMIN_ROLES: ReadonlyArray<IMembershipRole> = ["owner", "admin"]
const MAX_ACTIVE_AGENTS_PER_TEAM = 50

const AGENT_BOUNDS = {
  name: { min: 1, max: 40 },
  description: { max: 200 },
  avatarSeed: { max: 40 },
  systemPromptBase: { min: 1, max: 4000 },
  promptSuffix: { max: 2000 },
} as const

// ─── Types & helpers ────────────────────────────────────────────────────────

/**
 * Per-agent tool toggles. Mirrors `BotAgentToolToggles` from `bot.ts`
 * MINUS the team-only `customAgents` feature flag (which gates the
 * whole multi-agent system, not any single tool). `bot.ts`'s
 * `ChatToolName` union is the canonical key set; we can't import it
 * directly without creating a cycle, so the keys are spelled out here
 * — TypeScript catches drift when `pickChatTools` accesses
 * `agent.tools[name]` with a `name: ChatToolName`.
 *
 * Older agent docs may still carry a `customAgents` key in Firestore
 * — `normalizeAgentDoc` simply ignores it (the field is no longer in
 * this type, so the `toolsRaw.customAgents` branch was deleted).
 */
interface TeamAgentToolToggles {
  rollDice: boolean
  browseInternet: boolean
  askQuestion: boolean
  searchWorkspaceNodes: boolean
  /**
   * Per-agent gate for the node-enumeration tool (`listWorkspaceNodes` in
   * `botRag.ts`) — a directory listing the model uses to act over many/all
   * nodes instead of misusing `searchWorkspaceNodes` with a wildcard query.
   * Plain Firestore read; same per-agent × team intersection as the other
   * read-only workspace tools, with no Google-key dependency.
   */
  listWorkspaceNodes: boolean
  summarizeNode: boolean
  /**
   * Per-agent gate for the multi-doc comparison tool (`compareNodes` in
   * `botCompare.ts`). Same per-agent × team toggle intersection as
   * the other read-only workspace tools; uses the team's chat model
   * (no provider dependency beyond what the chat already needs).
   */
  compareNodes: boolean
  /**
   * Per-agent gate for the nearest-neighbor lookup tool
   * (`findRelatedNodes` in `botLink.ts`). Reuses the source node's
   * pre-computed embedding so there's no per-call embed cost; the
   * sidebar's `findRelatedNodes` callable lives alongside this tool
   * but is NOT gated by this toggle (it's a UI surface, not a
   * model-callable tool).
   */
  findRelatedNodes: boolean
  /**
   * Per-agent gate for the node-WRITE tools. NOT a `ChatToolName` (the
   * tools aren't registered via `pickChatTools`), but it IS consumed at
   * dispatch: `bot.ts` registers `NODE_WRITE_TOOLS` only when this is on
   * AND the team-level `manageContent` is on AND `canManageNodes` holds.
   * Default true so existing agents keep node editing.
   */
  manageContent: boolean
  /**
   * Per-agent gate for the node-READ tool (`readNode`). Sibling of
   * `manageContent`; dispatch registers `NODE_READ_TOOLS` only when this
   * is on AND the team-level `readContent` is on AND `canReadNodes` (the
   * lighter `READ_WORKSPACE` intersection) holds. Default true.
   */
  readContent: boolean
}

interface TeamAgentPromptSuffixes {
  auto: string
  agent: string
  manual: string
}

/**
 * Public shape returned by every callable. Mirrors `ITeamAgent` on the
 * client (defined via `z.infer<typeof teamAgentSchema>`); the Timestamp
 * fields serialize as `{ _seconds, _nanoseconds }` over the callable
 * wire and the client's converter re-hydrates them.
 */
interface TeamAgentDoc {
  id: string
  teamId: string
  name: string
  description: string
  avatarSeed: string
  systemPromptBase: string
  promptSuffixes: TeamAgentPromptSuffixes
  tools: TeamAgentToolToggles
  /**
   * Per-custom-tool toggles. Keyed by `TeamCustomToolDoc.id`. Missing
   * keys normalize to `true` — see the schema JSDoc. Dispatch in
   * `bot.ts` filters the team's custom tools through this map after
   * the team-level `agentConfig.tools.customTools` gate, so a tool
   * fires only when:
   *   - team-wide customTools feature is on,
   *   - the tool itself is enabled + non-archived,
   *   - this agent's per-tool toggle is not explicitly `false`.
   */
  customTools: Record<string, boolean>
  /**
   * Admin on/off toggle. `false` = "disabled" — dispatch silently
   * substitutes the team default for this agent. Independent of
   * `archivedAt`; see `teamAgentSchema` JSDoc for the full status
   * matrix.
   */
  enabled: boolean
  archivedAt: FirebaseFirestore.Timestamp | null
  createdAt: FirebaseFirestore.Timestamp
  updatedAt: FirebaseFirestore.Timestamp
  createdByUid: string
}

const DEFAULT_TOOL_TOGGLES: TeamAgentToolToggles = {
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
}

const DEFAULT_PROMPT_SUFFIXES: TeamAgentPromptSuffixes = {
  auto: "",
  agent: "",
  manual: "",
}

const isAdminRole = (role: IMembershipRole | null | undefined): boolean =>
  !!role && ADMIN_ROLES.includes(role)

async function assertAdminRole(teamId: string, uid: string): Promise<void> {
  const role = await getMembershipRole(teamId, uid)
  if (!isAdminRole(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only team owners and admins can manage custom agents."
    )
  }
}

const agentsCollectionPath = (teamId: string): string =>
  `teams/${teamId}/agents`

const agentDocPath = (teamId: string, agentId: string): string =>
  `${agentsCollectionPath(teamId)}/${agentId}`

/**
 * Public re-export so other server modules (e.g. `agents.ts`) can refer
 * to the same canonical `TeamAgentDoc` shape this file produces. Keeping
 * the doc shape in this file (not in `types.js`) means there's one
 * source of truth for the normalized agent record.
 */
export type { TeamAgentDoc }

/**
 * In-process TTL cache for `listTeamAgents` results. Cloud Functions
 * instances live for ~10-15 minutes between scale-downs and serve
 * requests sequentially per instance (default concurrency = 1 for
 * callables), so a Map keyed by teamId is safe — no cross-process
 * coherence problem to worry about.
 *
 * Why cache at all: the chat flow calls `listTeamAgents` on every
 * single turn (to resolve `activeAgentId` and build transfer
 * rosters), and the underlying Firestore read is a full-collection
 * scan of up to `MAX_ACTIVE_AGENTS_PER_TEAM = 50` docs. For an active
 * chat with one turn every few seconds, that's 50 docs read per
 * couple-seconds purely to ask "did the agent list change?".
 *
 * Why 5 seconds: short enough that admin edits (toggle, archive,
 * create) feel immediate to chatters — even mid-conversation — and
 * we explicitly invalidate from every mutation in this file so the
 * admin's OWN session never sees stale data. Long enough that a
 * burst of chat turns on the same team coalesces into a single
 * Firestore read.
 *
 * No promise dedup for parallel cache misses — if two callers race
 * past the miss check, they both hit Firestore and both populate the
 * cache. That's a few wasted reads in a rare race, not worth the
 * extra complexity of a `Map<teamId, Promise<...>>` in-flight table.
 */
const TEAM_AGENTS_CACHE_TTL_MS = 5_000
const teamAgentsCache = new Map<
  string,
  { entries: TeamAgentDoc[]; expiresAt: number }
>()

/**
 * Drop the cached entry for a team. Called by every mutation callable
 * in this file (create/update/setEnabled/archive/restore/delete) so
 * the admin who just made a change sees it reflected on their VERY
 * NEXT chat turn — not after a TTL boundary.
 *
 * Best-effort across instances: the mutation only invalidates the
 * Cloud Functions instance it ran on. Other instances see the change
 * after their TTL expires (≤5s). For a multi-instance deployment
 * that's the price of an in-process cache; the alternative (Redis or
 * Firestore-backed cache) is overkill for the staleness window we're
 * willing to tolerate.
 */
function invalidateTeamAgentsCache(teamId: string): void {
  teamAgentsCache.delete(teamId)
}

/**
 * Server-side helper: list EVERY agent for a team (including disabled
 * and archived). Used by the bot dispatcher (`bot.ts` →
 * `resolveActiveAgent`) on every chat turn so it can look up a
 * session's persisted `activeAgentId` regardless of state:
 *
 *   - Disabled agents are returned so the dispatcher can decide to
 *     fall back to the default persona.
 *   - Archived agents are returned because they STILL dispatch for
 *     existing chats (the "deprecate but keep running" model).
 *   - Hard-deleted agents naturally aren't returned — the doc is
 *     gone — and the dispatcher treats them the same as disabled.
 *
 * Caller (`buildTransferRoster`) further filters to enabled +
 * non-archived for transfer-eligible targets.
 *
 * Returns docs sorted by name for stable iteration order (matters for
 * deterministic system-prompt assembly).
 *
 * Results are cached per-team with a 5-second TTL — see
 * `teamAgentsCache` JSDoc for the rationale. Every mutation callable
 * below invalidates the entry, so the admin who edits an agent never
 * sees their old data on the next chat turn.
 */
export async function listTeamAgents(teamId: string): Promise<TeamAgentDoc[]> {
  const cached = teamAgentsCache.get(teamId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries
  }

  const snap = await db.collection(agentsCollectionPath(teamId)).get()
  const docs = snap.docs.map((doc) =>
    normalizeAgentDoc(teamId, doc.id, doc.data())
  )
  docs.sort((a, b) => a.name.localeCompare(b.name))

  teamAgentsCache.set(teamId, {
    entries: docs,
    expiresAt: Date.now() + TEAM_AGENTS_CACHE_TTL_MS,
  })
  return docs
}

/**
 * Server-side helper: fetch one agent by id, regardless of archive
 * state. Used to resolve a session's persisted `activeAgentId` even
 * when it points to an archived agent (the dispatcher falls back to
 * the default in that case, but we still want to surface the agent's
 * actual record for logging/telemetry).
 *
 * Returns `null` if the doc doesn't exist — callers should treat that
 * as "agent has been removed" and revert to the default.
 */
export async function loadTeamAgent(
  teamId: string,
  agentId: string
): Promise<TeamAgentDoc | null> {
  const snap = await db.doc(agentDocPath(teamId, agentId)).get()
  if (!snap.exists) return null
  return normalizeAgentDoc(teamId, agentId, snap.data())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Filter a raw map into a `Record<string, boolean>`. Drops any key
 * whose value isn't a boolean — keeps the per-agent
 * `customTools` map clean even if a malformed write landed on the
 * Firestore doc (e.g. a string `"false"` slipping through an old
 * client). Used by the agent doc normalizer.
 */
function normalizeBooleanRecord(raw: unknown): Record<string, boolean> {
  if (!isRecord(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") out[key] = value
  }
  return out
}

/**
 * Normalize a raw Firestore doc into the canonical `TeamAgentDoc` shape
 * the client expects — missing keys default to "" / `true` so old docs
 * (or docs written before a new tool key was added) read consistently.
 *
 * `id` and `teamId` are denormalized into the doc so the client can keep
 * references self-contained (no need to thread the doc path through
 * components that only see the agent object).
 */
function normalizeAgentDoc(
  teamId: string,
  agentId: string,
  raw: FirebaseFirestore.DocumentData | undefined
): TeamAgentDoc {
  const data = (raw ?? {}) as Record<string, unknown>
  const promptSuffixesRaw = isRecord(data.promptSuffixes)
    ? (data.promptSuffixes as Record<string, unknown>)
    : {}
  const toolsRaw = isRecord(data.tools)
    ? (data.tools as Record<string, unknown>)
    : {}

  return {
    id: agentId,
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
      manageContent:
        typeof toolsRaw.manageContent === "boolean"
          ? (toolsRaw.manageContent as boolean)
          : DEFAULT_TOOL_TOGGLES.manageContent,
      readContent:
        typeof toolsRaw.readContent === "boolean"
          ? (toolsRaw.readContent as boolean)
          : DEFAULT_TOOL_TOGGLES.readContent,
      // `customAgents` deliberately NOT read here — it was a per-agent
      // toggle in name only. Older Firestore docs may still have it
      // set; we ignore the value rather than copying it into a field
      // no consumer uses. The team-level `BotAgentToolToggles.customAgents`
      // is the canonical (and only consumed) source.
    },
    // Per-custom-tool toggles — keyed by custom-tool id. Only boolean
    // values are accepted; everything else is dropped so the doc
    // can't ship a malformed entry that confuses dispatch. Missing
    // keys at dispatch time normalize to `true` via the
    // `!== false` check, so the empty default below is the
    // every-tool-enabled state.
    customTools: normalizeBooleanRecord(data.customTools),
    // Default-true so docs written before `enabled` existed continue
    // dispatching normally — the lifecycle feature only marks them
    // "disabled" when an admin explicitly flips the toggle.
    enabled: typeof data.enabled === "boolean" ? data.enabled : true,
    archivedAt:
      data.archivedAt instanceof admin.firestore.Timestamp
        ? data.archivedAt
        : null,
    createdAt:
      data.createdAt instanceof admin.firestore.Timestamp
        ? data.createdAt
        : admin.firestore.Timestamp.now(),
    updatedAt:
      data.updatedAt instanceof admin.firestore.Timestamp
        ? data.updatedAt
        : admin.firestore.Timestamp.now(),
    createdByUid:
      typeof data.createdByUid === "string" ? data.createdByUid : "",
  }
}

// ─── Validation schemas ─────────────────────────────────────────────────────

const toolTogglesPatchSchema = z
  .object({
    rollDice: z.boolean(),
    browseInternet: z.boolean(),
    askQuestion: z.boolean(),
    searchWorkspaceNodes: z.boolean(),
    listWorkspaceNodes: z.boolean(),
    summarizeNode: z.boolean(),
    compareNodes: z.boolean(),
    findRelatedNodes: z.boolean(),
    manageContent: z.boolean(),
    readContent: z.boolean(),
  })
  .partial()

/**
 * Per-custom-tool toggles patch shape. Open-ended `Record<string, boolean>`
 * because the keys are Firestore-generated custom-tool ids — they're
 * unbounded and known only at runtime. Server-side we don't validate
 * that the keys reference real custom-tool ids; a stale id (e.g. tool
 * deleted between the form open and save) is harmless because dispatch
 * only consults the map for tools that still exist in
 * `listTeamCustomTools`.
 */
const customToolsTogglesPatchSchema = z.record(z.string(), z.boolean())

const promptSuffixesPatchSchema = z
  .object({
    auto: z.string().max(AGENT_BOUNDS.promptSuffix.max),
    agent: z.string().max(AGENT_BOUNDS.promptSuffix.max),
    manual: z.string().max(AGENT_BOUNDS.promptSuffix.max),
  })
  .partial()

/**
 * Creation payload — `name` and `systemPromptBase` are required because
 * they're load-bearing for the agent to function at all. Everything else
 * defaults server-side (description="", avatarSeed="" → falls back to
 * `name` on the client, suffixes="", tools=all-true).
 */
const teamAgentCreateSchema = z.object({
  name: z.string().min(AGENT_BOUNDS.name.min).max(AGENT_BOUNDS.name.max),
  description: z.string().max(AGENT_BOUNDS.description.max).optional(),
  avatarSeed: z.string().max(AGENT_BOUNDS.avatarSeed.max).optional(),
  systemPromptBase: z
    .string()
    .min(AGENT_BOUNDS.systemPromptBase.min)
    .max(AGENT_BOUNDS.systemPromptBase.max),
  promptSuffixes: promptSuffixesPatchSchema.optional(),
  tools: toolTogglesPatchSchema.optional(),
  customTools: customToolsTogglesPatchSchema.optional(),
})

/**
 * Update payload — all fields optional; only sent ones are written.
 * `name` and `systemPromptBase` keep their min-length floors so admins
 * can't blank them out mid-edit and brick the agent. `enabled` rides
 * along here for symmetry with other fields, but the dedicated
 * `setTeamAgentEnabled` callable is the preferred path for toggle
 * events from the row's Switch — clearer audit trail + no risk of
 * accidentally clobbering an in-flight edit.
 */
const teamAgentUpdateSchema = z.object({
  name: z
    .string()
    .min(AGENT_BOUNDS.name.min)
    .max(AGENT_BOUNDS.name.max)
    .optional(),
  description: z.string().max(AGENT_BOUNDS.description.max).optional(),
  avatarSeed: z.string().max(AGENT_BOUNDS.avatarSeed.max).optional(),
  systemPromptBase: z
    .string()
    .min(AGENT_BOUNDS.systemPromptBase.min)
    .max(AGENT_BOUNDS.systemPromptBase.max)
    .optional(),
  promptSuffixes: promptSuffixesPatchSchema.optional(),
  tools: toolTogglesPatchSchema.optional(),
  customTools: customToolsTogglesPatchSchema.optional(),
  enabled: z.boolean().optional(),
})

// ─── Callable: create ───────────────────────────────────────────────────────

interface CreateTeamAgentRequest {
  teamId: string
  draft: z.infer<typeof teamAgentCreateSchema>
}

interface CreateTeamAgentResponse {
  agent: TeamAgentDoc
}

export const createTeamAgent = onCall<CreateTeamAgentRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<CreateTeamAgentResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, draft } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }

    await assertAdminRole(teamId, auth.uid)

    const parsed = teamAgentCreateSchema.safeParse(draft ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid agent draft: ${parsed.error.message}`
      )
    }

    // Cap check — count non-archived agents (regardless of `enabled`).
    // Disabling alone doesn't free a slot; admins archive or hard-delete
    // to make room. Single-equality filter on `archivedAt == null`
    // means no composite index needed and the count aggregation stays
    // cheap even at scale.
    const activeSnap = await db
      .collection(agentsCollectionPath(teamId))
      .where("archivedAt", "==", null)
      .count()
      .get()
    if (activeSnap.data().count >= MAX_ACTIVE_AGENTS_PER_TEAM) {
      throw new HttpsError(
        "failed-precondition",
        `Active agent limit reached (${MAX_ACTIVE_AGENTS_PER_TEAM}). ` +
          "Archive or delete one to free a slot."
      )
    }

    const ref = db.collection(agentsCollectionPath(teamId)).doc()
    const now = admin.firestore.FieldValue.serverTimestamp()

    const docData = {
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      avatarSeed: parsed.data.avatarSeed ?? "",
      systemPromptBase: parsed.data.systemPromptBase,
      promptSuffixes: {
        ...DEFAULT_PROMPT_SUFFIXES,
        ...(parsed.data.promptSuffixes ?? {}),
      },
      tools: {
        ...DEFAULT_TOOL_TOGGLES,
        ...(parsed.data.tools ?? {}),
      },
      // Per-custom-tool overrides — empty when the form didn't send
      // any. Missing keys at dispatch time normalize to enabled (the
      // `!== false` check), so a brand-new agent automatically picks
      // up every existing custom tool without a separate "select all"
      // affordance in the editor.
      customTools: parsed.data.customTools ?? {},
      // New agents start enabled — admins explicitly toggle off later
      // if they want to gate the agent without archiving.
      enabled: true,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdByUid: auth.uid,
    }

    await ref.set(docData)
    invalidateTeamAgentsCache(teamId)

    // Re-read so we return resolved Timestamps (serverTimestamp() is a
    // sentinel until Firestore evaluates it). Cheap — single doc fetch.
    const snap = await ref.get()
    return { agent: normalizeAgentDoc(teamId, ref.id, snap.data()) }
  }
)

// ─── Callable: update ───────────────────────────────────────────────────────

interface UpdateTeamAgentRequest {
  teamId: string
  agentId: string
  patch: z.infer<typeof teamAgentUpdateSchema>
}

interface UpdateTeamAgentResponse {
  agent: TeamAgentDoc
}

export const updateTeamAgent = onCall<UpdateTeamAgentRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<UpdateTeamAgentResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, agentId, patch } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof agentId !== "string" || !agentId) {
      throw new HttpsError("invalid-argument", "agentId is required.")
    }

    await assertAdminRole(teamId, auth.uid)

    const parsed = teamAgentUpdateSchema.safeParse(patch ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid agent patch: ${parsed.error.message}`
      )
    }

    const ref = db.doc(agentDocPath(teamId, agentId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Agent not found.")
    }

    // Build update payload. Nested objects (promptSuffixes, tools) are
    // merged at the top level so a partial patch doesn't wipe untouched
    // sibling keys. Using set+merge instead of update because the latter
    // doesn't deep-merge nested map fields — it would replace
    // `promptSuffixes` wholesale even when only `auto` changed.
    const currentData = existing.data() ?? {}
    const currentSuffixes = isRecord(currentData.promptSuffixes)
      ? (currentData.promptSuffixes as Record<string, unknown>)
      : {}
    const currentTools = isRecord(currentData.tools)
      ? (currentData.tools as Record<string, unknown>)
      : {}

    const updates: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    if (parsed.data.name !== undefined) updates.name = parsed.data.name
    if (parsed.data.description !== undefined)
      updates.description = parsed.data.description
    if (parsed.data.avatarSeed !== undefined)
      updates.avatarSeed = parsed.data.avatarSeed
    if (parsed.data.systemPromptBase !== undefined)
      updates.systemPromptBase = parsed.data.systemPromptBase
    if (parsed.data.promptSuffixes !== undefined) {
      updates.promptSuffixes = {
        ...DEFAULT_PROMPT_SUFFIXES,
        ...currentSuffixes,
        ...parsed.data.promptSuffixes,
      }
    }
    if (parsed.data.tools !== undefined) {
      updates.tools = {
        ...DEFAULT_TOOL_TOGGLES,
        ...currentTools,
        ...parsed.data.tools,
      }
    }
    if (parsed.data.customTools !== undefined) {
      // Custom-tool overrides REPLACE the existing map wholesale —
      // not merged. Reason: the editor renders the full set of tool
      // ids on save, so what's not in the patch is intentionally
      // "should default to enabled" (key absent). A merge here would
      // make it impossible for the admin to UN-set a key once it
      // landed (a removed-from-form id would silently retain the
      // old value). The trade-off: an offline patch that touches
      // only one id and ships back a single-entry map will reset
      // every other id to the default. The editor never does that.
      updates.customTools = parsed.data.customTools
    }
    if (parsed.data.enabled !== undefined) {
      updates.enabled = parsed.data.enabled
    }

    await ref.set(updates, { merge: true })
    invalidateTeamAgentsCache(teamId)
    const after = await ref.get()
    return { agent: normalizeAgentDoc(teamId, agentId, after.data()) }
  }
)

// ─── Callable: setEnabled (admin toggle) ────────────────────────────────────
//
// Dedicated callable for the row-level Switch (mirrors the team's
// provider toggle pattern). Same effect as `updateTeamAgent({ enabled
// })` — but the narrower surface keeps the audit log cleaner ("admin
// disabled X" reads better than "admin updated X { enabled: false }")
// and means a toggle flip can't accidentally clobber an in-flight
// inline edit on another field.

interface SetTeamAgentEnabledRequest {
  teamId: string
  agentId: string
  enabled: boolean
}

interface SetTeamAgentEnabledResponse {
  agent: TeamAgentDoc
}

export const setTeamAgentEnabled = onCall<SetTeamAgentEnabledRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<SetTeamAgentEnabledResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, agentId, enabled } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof agentId !== "string" || !agentId) {
      throw new HttpsError("invalid-argument", "agentId is required.")
    }
    if (typeof enabled !== "boolean") {
      throw new HttpsError("invalid-argument", "enabled must be a boolean.")
    }

    await assertAdminRole(teamId, auth.uid)

    const ref = db.doc(agentDocPath(teamId, agentId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Agent not found.")
    }

    await ref.set(
      {
        enabled,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    invalidateTeamAgentsCache(teamId)

    const after = await ref.get()
    return { agent: normalizeAgentDoc(teamId, agentId, after.data()) }
  }
)

// ─── Callable: archive (soft-deprecate; keeps running for active chats) ─────

interface ArchiveTeamAgentRequest {
  teamId: string
  agentId: string
}

interface ArchiveTeamAgentResponse {
  agent: TeamAgentDoc
}

export const archiveTeamAgent = onCall<ArchiveTeamAgentRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<ArchiveTeamAgentResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, agentId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof agentId !== "string" || !agentId) {
      throw new HttpsError("invalid-argument", "agentId is required.")
    }

    await assertAdminRole(teamId, auth.uid)

    const ref = db.doc(agentDocPath(teamId, agentId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Agent not found.")
    }

    await ref.set(
      {
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    invalidateTeamAgentsCache(teamId)

    const after = await ref.get()
    return { agent: normalizeAgentDoc(teamId, agentId, after.data()) }
  }
)

// ─── Callable: restore (un-archive) ─────────────────────────────────────────

interface RestoreTeamAgentRequest {
  teamId: string
  agentId: string
}

interface RestoreTeamAgentResponse {
  agent: TeamAgentDoc
}

export const restoreTeamAgent = onCall<RestoreTeamAgentRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<RestoreTeamAgentResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, agentId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof agentId !== "string" || !agentId) {
      throw new HttpsError("invalid-argument", "agentId is required.")
    }

    await assertAdminRole(teamId, auth.uid)

    const ref = db.doc(agentDocPath(teamId, agentId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Agent not found.")
    }

    // Restore re-counts against the active cap — admins shouldn't be
    // able to bypass it by archive→create→restore cycles.
    const activeSnap = await db
      .collection(agentsCollectionPath(teamId))
      .where("archivedAt", "==", null)
      .count()
      .get()
    if (activeSnap.data().count >= MAX_ACTIVE_AGENTS_PER_TEAM) {
      throw new HttpsError(
        "failed-precondition",
        `Active agent limit reached (${MAX_ACTIVE_AGENTS_PER_TEAM}). ` +
          "Archive another agent first."
      )
    }

    await ref.set(
      {
        archivedAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    invalidateTeamAgentsCache(teamId)

    const after = await ref.get()
    return { agent: normalizeAgentDoc(teamId, agentId, after.data()) }
  }
)

// ─── Callable: delete (irreversible hard delete) ────────────────────────────
//
// Removes the Firestore document entirely — distinct from
// `archiveTeamAgent` (which sets `archivedAt` and keeps the doc
// runnable). Hard delete is the ONLY path that frees the agent's slot
// against the cap permanently AND prevents any future dispatch under
// the agent's persona.
//
// Existing chats that persisted the deleted agent's id keep their
// `IBotSession.activeAgentId` field pointing at the now-missing id.
// The client's `activeAgentStatus` resolves to "deleted" because the
// agent isn't found in the team's agents collection; the composer
// renders a "Deleted" badge, and the server's `resolveActiveAgent`
// returns `null` so dispatch falls back to the team default persona.
// No cascade clean-up of session docs — the badge tells the user
// what happened, and re-selecting any other agent clears the stale
// id on the next send.
//
// No "are you sure" gate server-side beyond the admin role check —
// the client owns the confirmation dialog (an AlertDialog with the
// "Delete forever" affordance). Returns just the agentId since the
// doc is gone.

interface DeleteTeamAgentRequest {
  teamId: string
  agentId: string
}

interface DeleteTeamAgentResponse {
  agentId: string
  deleted: true
}

export const deleteTeamAgent = onCall<DeleteTeamAgentRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<DeleteTeamAgentResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, agentId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof agentId !== "string" || !agentId) {
      throw new HttpsError("invalid-argument", "agentId is required.")
    }

    await assertAdminRole(teamId, auth.uid)

    const ref = db.doc(agentDocPath(teamId, agentId))
    // Idempotent: if the doc was already deleted between the admin's
    // confirmation and this call, succeed silently rather than error.
    // The end state ("agent gone") matches what the caller asked for.
    // Cache invalidation runs either way — if a sibling instance just
    // deleted, our local cache (if any) is still stale for this team.
    const existing = await ref.get()
    if (!existing.exists) {
      invalidateTeamAgentsCache(teamId)
      return { agentId, deleted: true }
    }

    await ref.delete()
    invalidateTeamAgentsCache(teamId)
    return { agentId, deleted: true }
  }
)

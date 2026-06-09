/**
 * Unified integrations — CRUD + install/uninstall + dispatch resolution for
 * the AGENT and TOOL integration types.
 *
 * Every installed agent/tool integration is a doc at
 *   teams/{teamId}/integrations/{integrationId}
 *
 * This collection replaces the four old storage mechanisms for agents+tools:
 *   - custom agents collection (teams/{teamId}/agents)
 *   - custom tools collection (teams/{teamId}/tools)
 *   - installedBuiltInAgents / builtInAgents maps on settings/agent
 *   - installedBuiltInTools map + the tool-enable bits in settings/agent.tools
 *
 * (Workflows are the third building block conceptually, but NOT a member of this
 * collection: they have a materialized/opt-in lifecycle + a runtime, so they
 * live in `teams/{teamId}/workspaces/{workspaceId}/workflows` with their own
 * storage + run/schedule engine in `workflows.ts`. The three are unified only
 * at the catalog
 * (`integrationCatalog.ts`) and the client registry facade
 * (`useIntegrationsRegistry`). See the file-top note in `useIntegrations.ts`.)
 *
 * CATALOG OVERLAY (preserves the old opt-out default with no migration):
 *   A built-in agent/tool has a doc here ONLY when the team has DIVERGED from
 *   the shipped default — i.e. uninstalled it (archivedAt set) or disabled it
 *   (enabled=false). A built-in with NO doc resolves as installed+enabled, so
 *   a newly-shipped built-in rolls out opt-out, exactly as before. Built-in
 *   doc id == its catalog `sourceKey` (`_researcher`, `rollDice`) so dispatch
 *   addressing is unchanged. Custom integrations always have an auto-id doc.
 *
 * LIFECYCLE (one model for all types):
 *   - installed = an active (non-archived) doc/overlay exists.
 *   - enabled   = the `enabled` field.
 *   - uninstall = soft-archive (`archivedAt`); history-preserving, re-install
 *     restores. Archived AGENTS still resolve for sessions that reference them
 *     (deprecate-but-run); archived TOOLS do not dispatch.
 *   - delete    = hard-remove (custom only; frees the per-type cap).
 *
 * Auth mirrors the old per-kind callables: App Check + verified auth at the
 * boundary, owner/admin (`assertAdminRole`) inside every mutation. Reads are
 * client-side Firestore subscriptions (members can read the collection).
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { z } from "zod"
import { requireVerifiedAuth } from "./auth.js"
import { assertAdminRole as assertTeamAdminRole } from "./authGuards.js"
import { NODE_SCOPES, type IntegrationSource } from "./domain.js"
import { db } from "./firebase.js"
import {
  getCatalogEntry,
  listCatalog,
  type AgentCatalogSpec,
  type CatalogEntry,
} from "./integrationCatalog.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import type { WorkspaceNodeScope } from "./types.js"

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Per-type active (non-archived) caps for the integration collection — the
 * single authoritative cap per stored integration type, enforced here in
 * createIntegration. Workflows live in their own collection and cap themselves
 * (see `MAX_ACTIVE_WORKFLOWS` in `workflows.ts`).
 */
export const MAX_ACTIVE_PER_TYPE: Record<"agent" | "tool", number> = {
  agent: 50,
  tool: 50,
}

const IDENTIFIER_RE = /^[a-z][a-zA-Z0-9_]*$/

// ─── Server-side spec types (mirror src/schemas/domain.ts) ───────────────────

interface PromptSuffixes {
  auto: string
  agent: string
  manual: string
}

interface ToolToggles {
  rollDice: boolean
  browseInternet: boolean
  askQuestion: boolean
  searchWorkspaceNodes: boolean
  listWorkspaceNodes: boolean
  summarizeNode: boolean
  compareNodes: boolean
  findRelatedNodes: boolean
  manageContent: boolean
  readContent: boolean
}

export interface AgentSpec {
  systemPromptBase: string
  promptSuffixes: PromptSuffixes
  tools: ToolToggles
  customTools: Record<string, boolean>
}

type ToolAction =
  | {
      kind: "httpWebhook"
      url: string
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
      headers: { name: string; value: string }[]
      bodyTemplate: string
      maxResponseBytes: number
      timeoutMs: number
    }
  | { kind: "constant"; value: string }
  | { kind: "promptTemplate"; prompt: string; model: string | null }
  | {
      kind: "workspaceSearch"
      scope: WorkspaceNodeScope | null
      defaultLimit: number
      filterHint: string
    }

interface ToolField {
  name: string
  type: "string" | "number" | "boolean"
  description: string
  required: boolean
}

export interface ToolSpec {
  wireName: string
  inputSchema: { fields: ToolField[] }
  outputSchema: { fields: ToolField[] }
  action: ToolAction
}

interface IntegrationDocBase {
  id: string
  teamId: string
  source: IntegrationSource
  sourceKey: string | null
  name: string
  description: string
  avatarSeed: string
  enabled: boolean
  archivedAt: FirebaseFirestore.Timestamp | null
  createdAt: FirebaseFirestore.Timestamp
  updatedAt: FirebaseFirestore.Timestamp
  createdByUid: string
}

/** Stored doc. `spec` is null for built-in agents/tools (thin references). */
export type IntegrationDoc =
  | (IntegrationDocBase & { type: "agent"; spec: AgentSpec | null })
  | (IntegrationDocBase & { type: "tool"; spec: ToolSpec | null })

/**
 * Effective integration after catalog overlay. `installed` = an active
 * doc/overlay exists. For built-in agents `spec` is resolved from the catalog;
 * for built-in tools it stays null (the handler is code, keyed by `sourceKey`).
 */
export interface ResolvedIntegration {
  id: string
  teamId: string
  type: "agent" | "tool"
  source: IntegrationSource
  sourceKey: string | null
  name: string
  description: string
  avatarSeed: string
  enabled: boolean
  installed: boolean
  archivedAt: FirebaseFirestore.Timestamp | null
  spec: AgentSpec | ToolSpec | null
  createdAt: FirebaseFirestore.Timestamp
  updatedAt: FirebaseFirestore.Timestamp
  createdByUid: string
}

// ─── Validation schemas (callable payloads) ──────────────────────────────────

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

const promptSuffixesPatchSchema = z
  .object({
    auto: z.string().max(2000),
    agent: z.string().max(2000),
    manual: z.string().max(2000),
  })
  .partial()

const agentSpecDraftSchema = z.object({
  systemPromptBase: z.string().min(1).max(4000),
  promptSuffixes: promptSuffixesPatchSchema.optional(),
  tools: toolTogglesPatchSchema.optional(),
  customTools: z.record(z.string(), z.boolean()).optional(),
})

const toolFieldSchema = z.object({
  name: z.string().min(1).max(40).regex(IDENTIFIER_RE),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().max(200),
  required: z.boolean(),
})

const toolActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("httpWebhook"),
    url: z.string().url().max(2048),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    headers: z.array(
      z.object({ name: z.string().min(1).max(80), value: z.string().max(1000) })
    ),
    bodyTemplate: z.string().max(8000),
    maxResponseBytes: z.number().int().min(256).max(65536),
    timeoutMs: z.number().int().min(1000).max(30_000),
  }),
  z.object({ kind: z.literal("constant"), value: z.string().max(8000) }),
  z.object({
    kind: z.literal("promptTemplate"),
    prompt: z.string().min(1).max(4000),
    model: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("workspaceSearch"),
    scope: z.enum(NODE_SCOPES).nullable(),
    defaultLimit: z.number().int().min(1).max(20),
    filterHint: z.string().max(200),
  }),
])

const toolSpecDraftSchema = z.object({
  wireName: z.string().min(1).max(40).regex(IDENTIFIER_RE),
  inputSchema: z.object({ fields: z.array(toolFieldSchema).max(10) }),
  outputSchema: z.object({ fields: z.array(toolFieldSchema).max(10) }),
  action: toolActionSchema,
})

const agentDraftSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().max(200).optional(),
  avatarSeed: z.string().max(40).optional(),
  spec: agentSpecDraftSchema,
})

const toolDraftSchema = z.object({
  name: z.string().max(60).optional(),
  description: z.string().min(1).max(500),
  avatarSeed: z.string().max(40).optional(),
  spec: toolSpecDraftSchema,
})

const agentPatchSchema = z
  .object({
    name: z.string().min(1).max(40),
    description: z.string().max(200),
    avatarSeed: z.string().max(40),
    spec: agentSpecDraftSchema.partial(),
  })
  .partial()

const toolPatchSchema = z
  .object({
    name: z.string().max(60),
    description: z.string().min(1).max(500),
    avatarSeed: z.string().max(40),
    spec: toolSpecDraftSchema.partial(),
  })
  .partial()

// ─── Auth + path helpers ──────────────────────────────────────────────────────

/** Owner/admin gate (shared role logic — see authGuards.ts + shared/permissions). */
const assertAdminRole = (teamId: string, uid: string): Promise<void> =>
  assertTeamAdminRole(
    teamId,
    uid,
    "Only team owners and admins can manage integrations."
  )

const integrationsCollectionPath = (teamId: string): string =>
  `teams/${teamId}/integrations`

const integrationDocPath = (teamId: string, id: string): string =>
  `${integrationsCollectionPath(teamId)}/${id}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeBooleanRecord(raw: unknown): Record<string, boolean> {
  if (!isRecord(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") out[key] = value
  }
  return out
}

// ─── Doc normalization ────────────────────────────────────────────────────────

const DEFAULT_TOOL_TOGGLES: ToolToggles = {
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

function normalizeToolToggles(raw: unknown): ToolToggles {
  const r = isRecord(raw) ? raw : {}
  const pick = (k: keyof ToolToggles): boolean =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : DEFAULT_TOOL_TOGGLES[k]
  return {
    rollDice: pick("rollDice"),
    browseInternet: pick("browseInternet"),
    askQuestion: pick("askQuestion"),
    searchWorkspaceNodes: pick("searchWorkspaceNodes"),
    listWorkspaceNodes: pick("listWorkspaceNodes"),
    summarizeNode: pick("summarizeNode"),
    compareNodes: pick("compareNodes"),
    findRelatedNodes: pick("findRelatedNodes"),
    manageContent: pick("manageContent"),
    readContent: pick("readContent"),
  }
}

function normalizeAgentSpec(raw: unknown): AgentSpec {
  const r = isRecord(raw) ? raw : {}
  const suffixes = isRecord(r.promptSuffixes) ? r.promptSuffixes : {}
  const str = (v: unknown): string => (typeof v === "string" ? v : "")
  return {
    systemPromptBase: str(r.systemPromptBase),
    promptSuffixes: {
      auto: str(suffixes.auto),
      agent: str(suffixes.agent),
      manual: str(suffixes.manual),
    },
    tools: normalizeToolToggles(r.tools),
    customTools: normalizeBooleanRecord(r.customTools),
  }
}

function normalizeToolSpec(raw: unknown): ToolSpec {
  const r = isRecord(raw) ? raw : {}
  const fields = (v: unknown): ToolField[] => {
    const arr = isRecord(v) && Array.isArray(v.fields) ? v.fields : []
    return (arr as unknown[]).flatMap((f) => {
      if (!isRecord(f) || typeof f.name !== "string") return []
      const type =
        f.type === "number" || f.type === "boolean" ? f.type : "string"
      return [
        {
          name: f.name,
          type,
          description: typeof f.description === "string" ? f.description : "",
          required: typeof f.required === "boolean" ? f.required : false,
        },
      ]
    })
  }
  const action = isRecord(r.action) ? r.action : {}
  const normalizedAction = ((): ToolAction => {
    switch (action.kind) {
      case "httpWebhook":
        return {
          kind: "httpWebhook",
          url: typeof action.url === "string" ? action.url : "",
          method:
            action.method === "GET" ||
            action.method === "PUT" ||
            action.method === "PATCH" ||
            action.method === "DELETE"
              ? action.method
              : "POST",
          headers: Array.isArray(action.headers)
            ? (action.headers as unknown[]).flatMap((h) =>
                isRecord(h) &&
                typeof h.name === "string" &&
                typeof h.value === "string"
                  ? [{ name: h.name, value: h.value }]
                  : []
              )
            : [],
          bodyTemplate:
            typeof action.bodyTemplate === "string" ? action.bodyTemplate : "",
          maxResponseBytes:
            typeof action.maxResponseBytes === "number"
              ? action.maxResponseBytes
              : 16384,
          timeoutMs:
            typeof action.timeoutMs === "number" ? action.timeoutMs : 10000,
        }
      case "promptTemplate":
        return {
          kind: "promptTemplate",
          prompt: typeof action.prompt === "string" ? action.prompt : "",
          model: typeof action.model === "string" ? action.model : null,
        }
      case "workspaceSearch":
        return {
          kind: "workspaceSearch",
          scope:
            action.scope === "code" || action.scope === "write"
              ? action.scope
              : null,
          defaultLimit:
            typeof action.defaultLimit === "number" ? action.defaultLimit : 5,
          filterHint:
            typeof action.filterHint === "string" ? action.filterHint : "",
        }
      default:
        return {
          kind: "constant",
          value:
            typeof action.value === "string" ? action.value : '{"ok":true}',
        }
    }
  })()
  return {
    wireName: typeof r.wireName === "string" ? r.wireName : "",
    inputSchema: { fields: fields(r.inputSchema) },
    outputSchema: { fields: fields(r.outputSchema) },
    action: normalizedAction,
  }
}

function normalizeIntegrationDoc(
  teamId: string,
  id: string,
  raw: FirebaseFirestore.DocumentData | undefined
): IntegrationDoc | null {
  const data = (raw ?? {}) as Record<string, unknown>
  const type =
    data.type === "tool" ? "tool" : data.type === "agent" ? "agent" : null
  if (!type) return null
  const source: IntegrationSource =
    data.source === "custom" || data.source === "published"
      ? data.source
      : "builtin"
  const base: IntegrationDocBase = {
    id,
    teamId,
    source,
    sourceKey: typeof data.sourceKey === "string" ? data.sourceKey : null,
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    avatarSeed: typeof data.avatarSeed === "string" ? data.avatarSeed : "",
    enabled: typeof data.enabled === "boolean" ? data.enabled : true,
    archivedAt: data.archivedAt instanceof Timestamp ? data.archivedAt : null,
    createdAt:
      data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    updatedAt:
      data.updatedAt instanceof Timestamp ? data.updatedAt : Timestamp.now(),
    createdByUid:
      typeof data.createdByUid === "string" ? data.createdByUid : "",
  }
  // Built-in docs are thin references — spec stays null and is resolved from
  // the catalog. Custom docs carry a full spec.
  const hasSpec = source === "custom" && isRecord(data.spec)
  if (type === "agent") {
    return {
      ...base,
      type,
      spec: hasSpec ? normalizeAgentSpec(data.spec) : null,
    }
  }
  return { ...base, type, spec: hasSpec ? normalizeToolSpec(data.spec) : null }
}

// ─── Catalog overlay + resolution ─────────────────────────────────────────────

function catalogAgentSpec(entry: CatalogEntry): AgentSpec {
  const spec: AgentCatalogSpec =
    entry.type === "agent"
      ? entry.agentSpec
      : {
          systemPromptBase: "",
          promptSuffixes: { auto: "", agent: "", manual: "" },
          tools: { ...DEFAULT_TOOL_TOGGLES },
          customTools: {},
        }
  return {
    systemPromptBase: spec.systemPromptBase,
    promptSuffixes: { ...spec.promptSuffixes },
    tools: normalizeToolToggles(spec.tools),
    customTools: { ...spec.customTools },
  }
}

/** Resolve a stored doc into its effective integration (overlaying catalog). */
function resolveDoc(doc: IntegrationDoc): ResolvedIntegration {
  const installed = doc.archivedAt === null
  let spec: AgentSpec | ToolSpec | null = doc.spec
  if (doc.source !== "custom" && doc.sourceKey) {
    const entry = getCatalogEntry(doc.type, doc.sourceKey)
    if (entry && doc.type === "agent") spec = catalogAgentSpec(entry)
    else if (doc.type === "tool") spec = null // handler keyed by sourceKey
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
    installed,
    archivedAt: doc.archivedAt,
    spec,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdByUid: doc.createdByUid,
  }
}

/** Synthesize the default (installed+enabled) overlay for an un-diverged built-in. */
function virtualFromCatalog(
  teamId: string,
  entry: Extract<CatalogEntry, { type: "agent" | "tool" }>
): ResolvedIntegration {
  const now = Timestamp.now()
  return {
    id: entry.key,
    teamId,
    type: entry.type,
    source: "builtin",
    sourceKey: entry.key,
    name: entry.name,
    description: entry.description,
    avatarSeed: entry.avatarSeed,
    enabled: true,
    installed: true,
    archivedAt: null,
    spec: entry.type === "agent" ? catalogAgentSpec(entry) : null,
    createdAt: now,
    updatedAt: now,
    createdByUid: "",
  }
}

// ─── List (with 5s TTL cache, mirroring teamAgents) ───────────────────────────

const CACHE_TTL_MS = 5_000
const integrationsCache = new Map<
  string,
  { entries: ResolvedIntegration[]; expiresAt: number }
>()

export function invalidateIntegrationsCache(teamId: string): void {
  integrationsCache.delete(teamId)
}

/**
 * List the team's effective agent+tool integrations — catalog built-ins
 * overlaid with any divergent docs, plus all custom docs. Includes
 * uninstalled (archived) and disabled entries; callers filter. Cached 5s.
 */
export async function listIntegrations(
  teamId: string
): Promise<ResolvedIntegration[]> {
  const cached = integrationsCache.get(teamId)
  if (cached && cached.expiresAt > Date.now()) return cached.entries

  const snap = await db.collection(integrationsCollectionPath(teamId)).get()
  const docs: IntegrationDoc[] = []
  for (const d of snap.docs) {
    const doc = normalizeIntegrationDoc(teamId, d.id, d.data())
    if (doc) docs.push(doc)
  }
  const byTypeKey = new Map<string, IntegrationDoc>()
  const customs: IntegrationDoc[] = []
  for (const doc of docs) {
    if (doc.source === "custom") customs.push(doc)
    else if (doc.sourceKey) byTypeKey.set(`${doc.type}:${doc.sourceKey}`, doc)
  }

  const resolved: ResolvedIntegration[] = []
  // Built-in agents + tools: doc if diverged, else virtual installed+enabled.
  // (The catalog also lists workflow presets, but those materialize into their
  // own collection — the integration resolver walks only agent + tool entries.)
  for (const entry of [...listCatalog("agent"), ...listCatalog("tool")]) {
    const doc = byTypeKey.get(`${entry.type}:${entry.key}`)
    resolved.push(doc ? resolveDoc(doc) : virtualFromCatalog(teamId, entry))
  }
  // Custom integrations always have a doc.
  for (const doc of customs) resolved.push(resolveDoc(doc))

  resolved.sort((a, b) => a.name.localeCompare(b.name))
  integrationsCache.set(teamId, {
    entries: resolved,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
  return resolved
}

/** Active (non-archived) + enabled integrations of a type — the dispatch set. */
export async function listDispatchable(
  teamId: string,
  type: "agent" | "tool"
): Promise<ResolvedIntegration[]> {
  const all = await listIntegrations(teamId)
  return all.filter((i) => i.type === type && i.installed && i.enabled)
}

// ─── Shared mutation plumbing ─────────────────────────────────────────────────

function requireTeamId(teamId: unknown): asserts teamId is string {
  if (typeof teamId !== "string" || !teamId) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
}

async function countActiveOfType(
  teamId: string,
  type: "agent" | "tool"
): Promise<number> {
  // Stored docs count toward the cap; un-diverged virtual built-ins do not
  // (they don't consume a doc). Custom + diverged built-ins are what we cap.
  const snap = await db
    .collection(integrationsCollectionPath(teamId))
    .where("type", "==", type)
    .where("archivedAt", "==", null)
    .count()
    .get()
  return snap.data().count
}

async function assertWireNameUnique(
  teamId: string,
  wireName: string,
  exceptId: string | null
): Promise<void> {
  // Custom tools store the wire-name at `spec.wireName`. Built-in tool
  // wire-names are their catalog keys; collisions with those are also rejected.
  if (getCatalogEntry("tool", wireName)) {
    throw new HttpsError(
      "already-exists",
      `A built-in tool already uses the name "${wireName}".`
    )
  }
  const snap = await db
    .collection(integrationsCollectionPath(teamId))
    .where("type", "==", "tool")
    .where("archivedAt", "==", null)
    .where("spec.wireName", "==", wireName)
    .get()
  const clash = snap.docs.find((d) => d.id !== exceptId)
  if (clash) {
    throw new HttpsError(
      "already-exists",
      `A tool with the wire-name "${wireName}" already exists.`
    )
  }
}

// ─── Callable: createIntegration (custom agent | tool) ────────────────────────

interface CreateIntegrationRequest {
  teamId: string
  type: "agent" | "tool"
  draft: unknown
}

export const createIntegration = onCall<CreateIntegrationRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request) => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, type, draft } = request.data ?? {}
    requireTeamId(teamId)
    if (type !== "agent" && type !== "tool") {
      throw new HttpsError(
        "invalid-argument",
        "type must be 'agent' or 'tool' (workflows are created via workflow callables)."
      )
    }
    await assertAdminRole(teamId, auth.uid)

    if (type === "agent") {
      const parsed = agentDraftSchema.safeParse(draft ?? {})
      if (!parsed.success) {
        throw new HttpsError(
          "invalid-argument",
          `Invalid agent draft: ${parsed.error.message}`
        )
      }
      if (
        (await countActiveOfType(teamId, "agent")) >= MAX_ACTIVE_PER_TYPE.agent
      ) {
        throw new HttpsError(
          "failed-precondition",
          `Active agent limit reached (${MAX_ACTIVE_PER_TYPE.agent}). Uninstall or delete one to free a slot.`
        )
      }
      const spec: AgentSpec = {
        systemPromptBase: parsed.data.spec.systemPromptBase,
        promptSuffixes: {
          auto: parsed.data.spec.promptSuffixes?.auto ?? "",
          agent: parsed.data.spec.promptSuffixes?.agent ?? "",
          manual: parsed.data.spec.promptSuffixes?.manual ?? "",
        },
        tools: { ...DEFAULT_TOOL_TOGGLES, ...(parsed.data.spec.tools ?? {}) },
        customTools: parsed.data.spec.customTools ?? {},
      }
      const id = await writeNewCustomDoc(teamId, auth.uid, {
        type: "agent",
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        avatarSeed: parsed.data.avatarSeed ?? "",
        spec,
      })
      return { integration: await loadResolved(teamId, id) }
    }

    const parsed = toolDraftSchema.safeParse(draft ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid tool draft: ${parsed.error.message}`
      )
    }
    await assertWireNameUnique(teamId, parsed.data.spec.wireName, null)
    if ((await countActiveOfType(teamId, "tool")) >= MAX_ACTIVE_PER_TYPE.tool) {
      throw new HttpsError(
        "failed-precondition",
        `Active tool limit reached (${MAX_ACTIVE_PER_TYPE.tool}). Uninstall or delete one to free a slot.`
      )
    }
    const id = await writeNewCustomDoc(teamId, auth.uid, {
      type: "tool",
      name: parsed.data.name ?? "",
      description: parsed.data.description,
      avatarSeed: parsed.data.avatarSeed ?? "",
      spec: parsed.data.spec as ToolSpec,
    })
    return { integration: await loadResolved(teamId, id) }
  }
)

async function writeNewCustomDoc(
  teamId: string,
  uid: string,
  fields: {
    type: "agent" | "tool"
    name: string
    description: string
    avatarSeed: string
    spec: AgentSpec | ToolSpec
  }
): Promise<string> {
  const ref = db.collection(integrationsCollectionPath(teamId)).doc()
  const now = FieldValue.serverTimestamp()
  await ref.set({
    type: fields.type,
    source: "custom",
    sourceKey: null,
    name: fields.name,
    description: fields.description,
    avatarSeed: fields.avatarSeed,
    spec: fields.spec,
    enabled: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
  })
  invalidateIntegrationsCache(teamId)
  return ref.id
}

async function loadResolved(
  teamId: string,
  id: string
): Promise<ResolvedIntegration | null> {
  const snap = await db.doc(integrationDocPath(teamId, id)).get()
  if (!snap.exists) return null
  const doc = normalizeIntegrationDoc(teamId, id, snap.data())
  return doc ? resolveDoc(doc) : null
}

// ─── Callable: updateIntegration (custom only) ────────────────────────────────

interface UpdateIntegrationRequest {
  teamId: string
  integrationId: string
  patch: unknown
}

export const updateIntegration = onCall<UpdateIntegrationRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request) => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, integrationId, patch } = request.data ?? {}
    requireTeamId(teamId)
    if (typeof integrationId !== "string" || !integrationId) {
      throw new HttpsError("invalid-argument", "integrationId is required.")
    }
    await assertAdminRole(teamId, auth.uid)

    const ref = db.doc(integrationDocPath(teamId, integrationId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Integration not found.")
    }
    const current = normalizeIntegrationDoc(
      teamId,
      integrationId,
      existing.data()
    )
    if (!current) throw new HttpsError("not-found", "Integration not found.")
    if (current.source !== "custom") {
      throw new HttpsError(
        "failed-precondition",
        "Built-in integrations can't be edited — only enabled, disabled, installed, or uninstalled."
      )
    }

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (current.type === "agent") {
      const parsed = agentPatchSchema.safeParse(patch ?? {})
      if (!parsed.success) {
        throw new HttpsError(
          "invalid-argument",
          `Invalid agent patch: ${parsed.error.message}`
        )
      }
      applyEnvelopePatch(updates, parsed.data)
      const cur = current.spec as AgentSpec | null
      if (parsed.data.spec) {
        // Deep-merge promptSuffixes/tools; replace customTools wholesale
        // (the editor ships the full id set — a merge would make un-setting
        // a key impossible). Mirrors the old updateTeamAgent policy.
        const base = cur ?? normalizeAgentSpec({})
        updates.spec = {
          systemPromptBase:
            parsed.data.spec.systemPromptBase ?? base.systemPromptBase,
          promptSuffixes: {
            ...base.promptSuffixes,
            ...(parsed.data.spec.promptSuffixes ?? {}),
          },
          tools: { ...base.tools, ...(parsed.data.spec.tools ?? {}) },
          customTools: parsed.data.spec.customTools ?? base.customTools,
        }
      }
    } else {
      const parsed = toolPatchSchema.safeParse(patch ?? {})
      if (!parsed.success) {
        throw new HttpsError(
          "invalid-argument",
          `Invalid tool patch: ${parsed.error.message}`
        )
      }
      applyEnvelopePatch(updates, parsed.data)
      const cur = current.spec as ToolSpec | null
      if (parsed.data.spec) {
        const nextWire = parsed.data.spec.wireName ?? cur?.wireName ?? ""
        if (nextWire && nextWire !== cur?.wireName) {
          await assertWireNameUnique(teamId, nextWire, integrationId)
        }
        // Tool spec fields are wholesale-replaced (IO schema + action are
        // edited as whole objects in the form). Mirrors old updateTeamCustomTool.
        updates.spec = {
          wireName: nextWire,
          inputSchema: parsed.data.spec.inputSchema ??
            cur?.inputSchema ?? {
              fields: [],
            },
          outputSchema: parsed.data.spec.outputSchema ??
            cur?.outputSchema ?? {
              fields: [],
            },
          action: parsed.data.spec.action ??
            cur?.action ?? { kind: "constant", value: '{"ok":true}' },
        }
      }
    }

    await ref.set(updates, { merge: true })
    invalidateIntegrationsCache(teamId)
    return { integration: await loadResolved(teamId, integrationId) }
  }
)

function applyEnvelopePatch(
  updates: Record<string, unknown>,
  patch: { name?: string; description?: string; avatarSeed?: string }
): void {
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.description !== undefined) updates.description = patch.description
  if (patch.avatarSeed !== undefined) updates.avatarSeed = patch.avatarSeed
}

// ─── Callable: setIntegrationEnabled ──────────────────────────────────────────
// For built-ins, "disabling" diverges from the default, so we materialize a
// thin doc (id == sourceKey) carrying the enabled flag.

interface SetIntegrationEnabledRequest {
  teamId: string
  // Built-in (no doc yet): pass type + sourceKey. Existing doc: pass integrationId.
  integrationId?: string
  type?: "agent" | "tool"
  sourceKey?: string
  enabled: boolean
}

export const setIntegrationEnabled = onCall<SetIntegrationEnabledRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request) => {
    const auth = requireVerifiedAuth(request.auth)
    const data = request.data ?? ({} as SetIntegrationEnabledRequest)
    const { teamId, enabled } = data
    requireTeamId(teamId)
    if (typeof enabled !== "boolean") {
      throw new HttpsError("invalid-argument", "enabled must be a boolean.")
    }
    await assertAdminRole(teamId, auth.uid)

    const ref = await resolveMutableRef(teamId, data)
    await ref.set(
      { enabled, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    )
    invalidateIntegrationsCache(teamId)
    return { integration: await loadResolved(teamId, ref.id) }
  }
)

/**
 * Resolve the doc ref to mutate. For an existing doc, by id. For a built-in
 * with no doc yet (first divergence), materialize a thin doc at id==sourceKey
 * snapshotting the catalog display fields.
 */
async function resolveMutableRef(
  teamId: string,
  data: { integrationId?: string; type?: "agent" | "tool"; sourceKey?: string }
): Promise<FirebaseFirestore.DocumentReference> {
  if (data.integrationId) {
    const ref = db.doc(integrationDocPath(teamId, data.integrationId))
    if (!(await ref.get()).exists) {
      throw new HttpsError("not-found", "Integration not found.")
    }
    return ref
  }
  if (
    (data.type === "agent" || data.type === "tool") &&
    typeof data.sourceKey === "string"
  ) {
    const entry = getCatalogEntry(data.type, data.sourceKey)
    if (!entry)
      throw new HttpsError("not-found", "Unknown built-in integration.")
    const ref = db.doc(integrationDocPath(teamId, data.sourceKey))
    const snap = await ref.get()
    if (!snap.exists) {
      const now = FieldValue.serverTimestamp()
      await ref.set({
        type: entry.type,
        source: "builtin",
        sourceKey: entry.key,
        name: entry.name,
        description: entry.description,
        avatarSeed: entry.avatarSeed,
        spec: null,
        enabled: true,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        createdByUid: "",
      })
    }
    return ref
  }
  throw new HttpsError(
    "invalid-argument",
    "Provide integrationId, or type + sourceKey for a built-in."
  )
}

// ─── Callable: installIntegration (built-in / published agent | tool) ─────────

interface InstallIntegrationRequest {
  teamId: string
  // Built-in / published: install from the catalog by `type` + `sourceKey`.
  type?: "agent" | "tool"
  sourceKey?: string
  // Custom: re-install (un-archive) an existing doc by id. install == uninstall⁻¹.
  integrationId?: string
}

export const installIntegration = onCall<InstallIntegrationRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request) => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, type, sourceKey, integrationId } = request.data ?? {}
    requireTeamId(teamId)
    await assertAdminRole(teamId, auth.uid)
    const now = FieldValue.serverTimestamp()

    // Custom (or any existing doc) restore: clear archivedAt by id.
    if (integrationId) {
      const ref = db.doc(integrationDocPath(teamId, integrationId))
      if (!(await ref.get()).exists) {
        throw new HttpsError("not-found", "Integration not found.")
      }
      await ref.set({ archivedAt: null, updatedAt: now }, { merge: true })
      invalidateIntegrationsCache(teamId)
      return { integration: await loadResolved(teamId, integrationId) }
    }

    // Built-in install from the catalog by (type, sourceKey).
    if (type !== "agent" && type !== "tool") {
      throw new HttpsError(
        "invalid-argument",
        "type must be 'agent' or 'tool'."
      )
    }
    if (typeof sourceKey !== "string" || !sourceKey) {
      throw new HttpsError("invalid-argument", "sourceKey is required.")
    }
    const entry = getCatalogEntry(type, sourceKey)
    if (!entry)
      throw new HttpsError("not-found", "Unknown built-in integration.")

    const ref = db.doc(integrationDocPath(teamId, sourceKey))
    const snap = await ref.get()
    if (!snap.exists) {
      // No divergence doc exists → already installed-by-default (overlay).
      // Writing nothing keeps the opt-out semantics; return the virtual entry.
      return { integration: virtualFromCatalog(teamId, entry) }
    }
    // A divergence doc exists (uninstalled/disabled) → restore to installed.
    await ref.set({ archivedAt: null, updatedAt: now }, { merge: true })
    invalidateIntegrationsCache(teamId)
    return { integration: await loadResolved(teamId, sourceKey) }
  }
)

// ─── Callable: uninstallIntegration (soft-archive) ────────────────────────────

interface UninstallIntegrationRequest {
  teamId: string
  integrationId?: string
  type?: "agent" | "tool"
  sourceKey?: string
}

export const uninstallIntegration = onCall<UninstallIntegrationRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request) => {
    const auth = requireVerifiedAuth(request.auth)
    const data = request.data ?? ({} as UninstallIntegrationRequest)
    requireTeamId(data.teamId)
    await assertAdminRole(data.teamId, auth.uid)

    const ref = await resolveMutableRef(data.teamId, data)
    await ref.set(
      {
        archivedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    invalidateIntegrationsCache(data.teamId)
    return { integration: await loadResolved(data.teamId, ref.id) }
  }
)

// ─── Callable: deleteIntegration (hard delete; custom only) ───────────────────

interface DeleteIntegrationRequest {
  teamId: string
  integrationId: string
}

export const deleteIntegration = onCall<DeleteIntegrationRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request) => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, integrationId } = request.data ?? {}
    requireTeamId(teamId)
    if (typeof integrationId !== "string" || !integrationId) {
      throw new HttpsError("invalid-argument", "integrationId is required.")
    }
    await assertAdminRole(teamId, auth.uid)

    const ref = db.doc(integrationDocPath(teamId, integrationId))
    const existing = await ref.get()
    if (!existing.exists) {
      invalidateIntegrationsCache(teamId)
      return { integrationId, deleted: true as const }
    }
    const doc = normalizeIntegrationDoc(teamId, integrationId, existing.data())
    if (doc && doc.source !== "custom") {
      throw new HttpsError(
        "failed-precondition",
        "Built-in integrations can't be deleted — uninstall them instead."
      )
    }
    await ref.delete()
    invalidateIntegrationsCache(teamId)
    return { integrationId, deleted: true as const }
  }
)

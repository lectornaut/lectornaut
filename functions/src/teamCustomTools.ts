/**
 * Team-scoped custom tools — admin-authored Genkit tools the model
 * can invoke during chat. Mirrors `teamAgents.ts` in shape and intent:
 *
 *   - Storage path: `teams/{teamId}/tools/{toolId}`
 *   - Auth: App Check + verified email + admin role (owner | admin)
 *     for every mutation. Reads are allowed for any team member via
 *     `firestore.rules` so pickers can render live.
 *   - Lifecycle: four states from `enabled` × `archivedAt` × doc
 *     presence (active / disabled / archived / deleted). Archived
 *     tools KEEP RUNNING for chats that already had them — same
 *     "deprecate but don't break" semantics as custom agents.
 *
 * Each tool carries:
 *   - identity: name (wire-name + display), description, avatar seed
 *   - inputSchema: list of named fields with primitive types
 *   - outputSchema: same shape for what the tool returns
 *   - action: discriminated by `kind` (httpWebhook | constant |
 *     promptTemplate | workspaceSearch) — the actual implementation
 *
 * At dispatch time `buildCustomToolForAgent` reads one doc and
 * produces a Genkit `defineTool` with the wire-name and a handler
 * that dispatches by action `kind`. The chat-flow integrator
 * (`bot.ts`) calls `listTeamCustomTools(teamId)` to get every
 * enabled+non-archived doc and folds them into the tool catalog
 * alongside the built-ins.
 *
 * Result-cache semantics mirror `teamAgents.ts`: 5s TTL, explicit
 * invalidation from every mutation. Chat turns coalesce reads; admin
 * edits propagate on the admin's NEXT chat turn (cache busted from
 * the same Cloud Functions instance).
 */

import { logger } from "firebase-functions/v2"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { tool, z } from "genkit/beta"

import { getMembershipRole, requireVerifiedAuth } from "./bot.js"
import type { BotActionContext } from "./botBuiltinTools.js"
import { searchWorkspaceNodesTool } from "./botRag.js"
import { admin, db } from "./firebase.js"
import {
  ai,
  isAiModelProviderConfigured,
  resolveModel,
} from "./genkitClient.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import type { IMembershipRole } from "./types.js"

// ─── Constants ──────────────────────────────────────────────────────────────

const ADMIN_ROLES: ReadonlyArray<IMembershipRole> = ["owner", "admin"]
const MAX_ACTIVE_TOOLS_PER_TEAM = 50

const TOOL_BOUNDS = {
  name: { min: 1, max: 40 },
  displayName: { max: 60 },
  description: { min: 1, max: 500 },
  avatarSeed: { max: 40 },
  fieldsMax: 10,
  fieldName: { min: 1, max: 40 },
  fieldDescription: { max: 200 },
  httpUrl: { max: 2048 },
  httpHeaderName: { min: 1, max: 80 },
  httpHeaderValue: { max: 1000 },
  httpBody: { max: 8000 },
  httpResponseBytes: { min: 256, max: 65536 },
  httpTimeoutMs: { min: 1000, max: 30_000 },
  constantValue: { max: 8000 },
  promptTemplate: { min: 1, max: 4000 },
  workspaceSearchLimit: { min: 1, max: 20 },
  workspaceSearchFilter: { max: 200 },
} as const

const IDENTIFIER_RE = /^[a-z][a-zA-Z0-9_]*$/

// ─── Types ──────────────────────────────────────────────────────────────────

export type CustomToolFieldType = "string" | "number" | "boolean"

export interface CustomToolField {
  name: string
  type: CustomToolFieldType
  description: string
  required: boolean
}

export type CustomToolAction =
  | {
      kind: "httpWebhook"
      url: string
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
      headers: Array<{ name: string; value: string }>
      bodyTemplate: string
      maxResponseBytes: number
      timeoutMs: number
    }
  | { kind: "constant"; value: string }
  | { kind: "promptTemplate"; prompt: string; model: string | null }
  | {
      kind: "workspaceSearch"
      scope: "code" | "write" | null
      defaultLimit: number
      filterHint: string
    }

export type CustomToolActionKind = CustomToolAction["kind"]

export interface TeamCustomToolDoc {
  id: string
  teamId: string
  name: string
  displayName: string
  description: string
  avatarSeed: string
  inputSchema: { fields: CustomToolField[] }
  outputSchema: { fields: CustomToolField[] }
  action: CustomToolAction
  enabled: boolean
  archivedAt: FirebaseFirestore.Timestamp | null
  createdAt: FirebaseFirestore.Timestamp
  updatedAt: FirebaseFirestore.Timestamp
  createdByUid: string
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_ACTION: CustomToolAction = {
  kind: "constant",
  value: '{ "ok": true }',
}

// ─── Auth + path helpers ────────────────────────────────────────────────────

const isAdminRole = (role: IMembershipRole | null | undefined): boolean =>
  !!role && ADMIN_ROLES.includes(role)

async function assertAdminRole(teamId: string, uid: string): Promise<void> {
  const role = await getMembershipRole(teamId, uid)
  if (!isAdminRole(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only team owners and admins can manage custom tools."
    )
  }
}

const toolsCollectionPath = (teamId: string): string => `teams/${teamId}/tools`
const toolDocPath = (teamId: string, toolId: string): string =>
  `${toolsCollectionPath(teamId)}/${toolId}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ─── In-process TTL cache ───────────────────────────────────────────────────
//
// Mirrors the cache in `teamAgents.ts` — 5s TTL, explicit invalidation
// from every mutation. The chat flow reads every turn; cache coalesces
// those reads while keeping admin edits visible on the admin's next
// chat turn (same-instance invalidation).

const TOOLS_CACHE_TTL_MS = 5_000
const toolsCache = new Map<
  string,
  { entries: TeamCustomToolDoc[]; expiresAt: number }
>()

function invalidateToolsCache(teamId: string): void {
  toolsCache.delete(teamId)
}

/**
 * Server-side helper: list EVERY custom tool for a team (including
 * disabled and archived). Mirrors `listTeamAgents` — disabled tools are
 * returned so the dispatcher can gate them out; archived tools are
 * returned because the "archive = deprecate" model keeps them
 * runnable for sessions that already use them.
 */
export async function listTeamCustomTools(
  teamId: string
): Promise<TeamCustomToolDoc[]> {
  const cached = toolsCache.get(teamId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries
  }
  const snap = await db.collection(toolsCollectionPath(teamId)).get()
  const docs = snap.docs.map((doc) =>
    normalizeToolDoc(teamId, doc.id, doc.data())
  )
  docs.sort((a, b) => a.name.localeCompare(b.name))
  toolsCache.set(teamId, {
    entries: docs,
    expiresAt: Date.now() + TOOLS_CACHE_TTL_MS,
  })
  return docs
}

// ─── Normalization ─────────────────────────────────────────────────────────

function normalizeField(raw: unknown): CustomToolField | null {
  if (!isRecord(raw)) return null
  const name = typeof raw.name === "string" ? raw.name : null
  const type =
    raw.type === "string" || raw.type === "number" || raw.type === "boolean"
      ? raw.type
      : null
  if (!name || !IDENTIFIER_RE.test(name) || !type) return null
  return {
    name,
    type,
    description: typeof raw.description === "string" ? raw.description : "",
    required: raw.required === true,
  }
}

function normalizeFieldsList(raw: unknown): CustomToolField[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalizeField)
    .filter((f): f is CustomToolField => f !== null)
    .slice(0, TOOL_BOUNDS.fieldsMax)
}

/**
 * Normalize the `action` discriminator. An invalid action falls back
 * to `DEFAULT_ACTION` (a constant returning `{ ok: true }`) so a
 * malformed doc still produces a runnable tool — admins can fix it
 * via the editor rather than the chat blowing up.
 */
function normalizeAction(raw: unknown): CustomToolAction {
  if (!isRecord(raw)) return { ...DEFAULT_ACTION }
  const kind = raw.kind
  switch (kind) {
    case "httpWebhook": {
      const url = typeof raw.url === "string" ? raw.url : ""
      const method =
        raw.method === "GET" ||
        raw.method === "POST" ||
        raw.method === "PUT" ||
        raw.method === "PATCH" ||
        raw.method === "DELETE"
          ? raw.method
          : "POST"
      const headers = Array.isArray(raw.headers)
        ? raw.headers
            .map((h: unknown) => {
              if (!isRecord(h)) return null
              const name = typeof h.name === "string" ? h.name : ""
              const value = typeof h.value === "string" ? h.value : ""
              return name ? { name, value } : null
            })
            .filter((h): h is { name: string; value: string } => h !== null)
        : []
      return {
        kind: "httpWebhook",
        url,
        method,
        headers,
        bodyTemplate:
          typeof raw.bodyTemplate === "string" ? raw.bodyTemplate : "",
        maxResponseBytes:
          typeof raw.maxResponseBytes === "number"
            ? Math.min(
                Math.max(
                  raw.maxResponseBytes,
                  TOOL_BOUNDS.httpResponseBytes.min
                ),
                TOOL_BOUNDS.httpResponseBytes.max
              )
            : 16384,
        timeoutMs:
          typeof raw.timeoutMs === "number"
            ? Math.min(
                Math.max(raw.timeoutMs, TOOL_BOUNDS.httpTimeoutMs.min),
                TOOL_BOUNDS.httpTimeoutMs.max
              )
            : 10_000,
      }
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
        model: typeof raw.model === "string" ? raw.model : null,
      }
    case "workspaceSearch":
      return {
        kind: "workspaceSearch",
        scope: raw.scope === "code" || raw.scope === "write" ? raw.scope : null,
        defaultLimit:
          typeof raw.defaultLimit === "number"
            ? Math.min(
                Math.max(
                  raw.defaultLimit,
                  TOOL_BOUNDS.workspaceSearchLimit.min
                ),
                TOOL_BOUNDS.workspaceSearchLimit.max
              )
            : 5,
        filterHint: typeof raw.filterHint === "string" ? raw.filterHint : "",
      }
    default:
      return { ...DEFAULT_ACTION }
  }
}

function normalizeToolDoc(
  teamId: string,
  toolId: string,
  raw: FirebaseFirestore.DocumentData | undefined
): TeamCustomToolDoc {
  const data = (raw ?? {}) as Record<string, unknown>
  const inputSchemaRaw = isRecord(data.inputSchema) ? data.inputSchema : {}
  const outputSchemaRaw = isRecord(data.outputSchema) ? data.outputSchema : {}
  return {
    id: toolId,
    teamId,
    name: typeof data.name === "string" ? data.name : "",
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    description: typeof data.description === "string" ? data.description : "",
    avatarSeed: typeof data.avatarSeed === "string" ? data.avatarSeed : "",
    inputSchema: { fields: normalizeFieldsList(inputSchemaRaw.fields) },
    outputSchema: { fields: normalizeFieldsList(outputSchemaRaw.fields) },
    action: normalizeAction(data.action),
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

// ─── Validation schemas (callables) ─────────────────────────────────────────

const fieldSchema = z.object({
  name: z
    .string()
    .min(TOOL_BOUNDS.fieldName.min)
    .max(TOOL_BOUNDS.fieldName.max)
    .regex(IDENTIFIER_RE, "Invalid field name"),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().max(TOOL_BOUNDS.fieldDescription.max),
  required: z.boolean(),
})

const fieldsListSchema = z.object({
  fields: z.array(fieldSchema).max(TOOL_BOUNDS.fieldsMax),
})

const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("httpWebhook"),
    url: z.string().url().max(TOOL_BOUNDS.httpUrl.max),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    headers: z.array(
      z.object({
        name: z
          .string()
          .min(TOOL_BOUNDS.httpHeaderName.min)
          .max(TOOL_BOUNDS.httpHeaderName.max),
        value: z.string().max(TOOL_BOUNDS.httpHeaderValue.max),
      })
    ),
    bodyTemplate: z.string().max(TOOL_BOUNDS.httpBody.max),
    maxResponseBytes: z
      .number()
      .int()
      .min(TOOL_BOUNDS.httpResponseBytes.min)
      .max(TOOL_BOUNDS.httpResponseBytes.max),
    timeoutMs: z
      .number()
      .int()
      .min(TOOL_BOUNDS.httpTimeoutMs.min)
      .max(TOOL_BOUNDS.httpTimeoutMs.max),
  }),
  z.object({
    kind: z.literal("constant"),
    value: z.string().max(TOOL_BOUNDS.constantValue.max),
  }),
  z.object({
    kind: z.literal("promptTemplate"),
    prompt: z
      .string()
      .min(TOOL_BOUNDS.promptTemplate.min)
      .max(TOOL_BOUNDS.promptTemplate.max),
    model: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("workspaceSearch"),
    scope: z.enum(["code", "write"]).nullable(),
    defaultLimit: z
      .number()
      .int()
      .min(TOOL_BOUNDS.workspaceSearchLimit.min)
      .max(TOOL_BOUNDS.workspaceSearchLimit.max),
    filterHint: z.string().max(TOOL_BOUNDS.workspaceSearchFilter.max),
  }),
])

const toolCreateSchema = z.object({
  name: z
    .string()
    .min(TOOL_BOUNDS.name.min)
    .max(TOOL_BOUNDS.name.max)
    .regex(IDENTIFIER_RE, "Invalid tool name"),
  displayName: z.string().max(TOOL_BOUNDS.displayName.max).optional(),
  description: z
    .string()
    .min(TOOL_BOUNDS.description.min)
    .max(TOOL_BOUNDS.description.max),
  avatarSeed: z.string().max(TOOL_BOUNDS.avatarSeed.max).optional(),
  inputSchema: fieldsListSchema,
  outputSchema: fieldsListSchema,
  action: actionSchema,
})

const toolUpdateSchema = z.object({
  name: z
    .string()
    .min(TOOL_BOUNDS.name.min)
    .max(TOOL_BOUNDS.name.max)
    .regex(IDENTIFIER_RE, "Invalid tool name")
    .optional(),
  displayName: z.string().max(TOOL_BOUNDS.displayName.max).optional(),
  description: z
    .string()
    .min(TOOL_BOUNDS.description.min)
    .max(TOOL_BOUNDS.description.max)
    .optional(),
  avatarSeed: z.string().max(TOOL_BOUNDS.avatarSeed.max).optional(),
  inputSchema: fieldsListSchema.optional(),
  outputSchema: fieldsListSchema.optional(),
  action: actionSchema.optional(),
  enabled: z.boolean().optional(),
})

// ─── Callables: CRUD ───────────────────────────────────────────────────────

interface CreateTeamCustomToolRequest {
  teamId: string
  draft: z.infer<typeof toolCreateSchema>
}

interface CreateTeamCustomToolResponse {
  tool: TeamCustomToolDoc
}

export const createTeamCustomTool = onCall<CreateTeamCustomToolRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<CreateTeamCustomToolResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, draft } = request.data ?? {}
    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    await assertAdminRole(teamId, auth.uid)
    const parsed = toolCreateSchema.safeParse(draft ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid tool draft: ${parsed.error.message}`
      )
    }

    // Wire-name uniqueness — two tools with the same `name` would
    // collide in Genkit's tool catalog; the second `defineTool` call
    // throws. Enforce at the data layer so admins see a clean error
    // up front rather than a cryptic registration failure at chat time.
    const existing = await db
      .collection(toolsCollectionPath(teamId))
      .where("name", "==", parsed.data.name)
      .where("archivedAt", "==", null)
      .limit(1)
      .get()
    if (!existing.empty) {
      throw new HttpsError(
        "already-exists",
        `A custom tool named "${parsed.data.name}" already exists. ` +
          "Archive the old one or pick a different name."
      )
    }

    const activeSnap = await db
      .collection(toolsCollectionPath(teamId))
      .where("archivedAt", "==", null)
      .count()
      .get()
    if (activeSnap.data().count >= MAX_ACTIVE_TOOLS_PER_TEAM) {
      throw new HttpsError(
        "failed-precondition",
        `Active tool limit reached (${MAX_ACTIVE_TOOLS_PER_TEAM}). ` +
          "Archive or delete one to free a slot."
      )
    }

    const ref = db.collection(toolsCollectionPath(teamId)).doc()
    const now = admin.firestore.FieldValue.serverTimestamp()
    const docData = {
      name: parsed.data.name,
      displayName: parsed.data.displayName ?? "",
      description: parsed.data.description,
      avatarSeed: parsed.data.avatarSeed ?? "",
      inputSchema: parsed.data.inputSchema,
      outputSchema: parsed.data.outputSchema,
      action: parsed.data.action,
      enabled: true,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      createdByUid: auth.uid,
    }
    await ref.set(docData)
    invalidateToolsCache(teamId)
    const snap = await ref.get()
    return { tool: normalizeToolDoc(teamId, ref.id, snap.data()) }
  }
)

interface UpdateTeamCustomToolRequest {
  teamId: string
  toolId: string
  patch: z.infer<typeof toolUpdateSchema>
}

interface UpdateTeamCustomToolResponse {
  tool: TeamCustomToolDoc
}

export const updateTeamCustomTool = onCall<UpdateTeamCustomToolRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<UpdateTeamCustomToolResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, toolId, patch } = request.data ?? {}
    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof toolId !== "string" || !toolId) {
      throw new HttpsError("invalid-argument", "toolId is required.")
    }
    await assertAdminRole(teamId, auth.uid)
    const parsed = toolUpdateSchema.safeParse(patch ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid tool patch: ${parsed.error.message}`
      )
    }

    const ref = db.doc(toolDocPath(teamId, toolId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Tool not found.")
    }

    // Rename → re-check uniqueness, excluding self.
    if (parsed.data.name) {
      const existingByName = await db
        .collection(toolsCollectionPath(teamId))
        .where("name", "==", parsed.data.name)
        .where("archivedAt", "==", null)
        .limit(2)
        .get()
      const collision = existingByName.docs.find((d) => d.id !== toolId)
      if (collision) {
        throw new HttpsError(
          "already-exists",
          `Another tool already uses the name "${parsed.data.name}".`
        )
      }
    }

    const updates: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (parsed.data.name !== undefined) updates.name = parsed.data.name
    if (parsed.data.displayName !== undefined)
      updates.displayName = parsed.data.displayName
    if (parsed.data.description !== undefined)
      updates.description = parsed.data.description
    if (parsed.data.avatarSeed !== undefined)
      updates.avatarSeed = parsed.data.avatarSeed
    if (parsed.data.inputSchema !== undefined)
      updates.inputSchema = parsed.data.inputSchema
    if (parsed.data.outputSchema !== undefined)
      updates.outputSchema = parsed.data.outputSchema
    if (parsed.data.action !== undefined) updates.action = parsed.data.action
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled

    await ref.set(updates, { merge: true })
    invalidateToolsCache(teamId)
    const after = await ref.get()
    return { tool: normalizeToolDoc(teamId, toolId, after.data()) }
  }
)

interface SetTeamCustomToolEnabledRequest {
  teamId: string
  toolId: string
  enabled: boolean
}

interface SetTeamCustomToolEnabledResponse {
  tool: TeamCustomToolDoc
}

export const setTeamCustomToolEnabled = onCall<SetTeamCustomToolEnabledRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<SetTeamCustomToolEnabledResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, toolId, enabled } = request.data ?? {}
    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof toolId !== "string" || !toolId) {
      throw new HttpsError("invalid-argument", "toolId is required.")
    }
    if (typeof enabled !== "boolean") {
      throw new HttpsError("invalid-argument", "enabled must be a boolean.")
    }
    await assertAdminRole(teamId, auth.uid)
    const ref = db.doc(toolDocPath(teamId, toolId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Tool not found.")
    }
    await ref.set(
      {
        enabled,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    invalidateToolsCache(teamId)
    const after = await ref.get()
    return { tool: normalizeToolDoc(teamId, toolId, after.data()) }
  }
)

interface ArchiveTeamCustomToolRequest {
  teamId: string
  toolId: string
}

interface ArchiveTeamCustomToolResponse {
  tool: TeamCustomToolDoc
}

export const archiveTeamCustomTool = onCall<ArchiveTeamCustomToolRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<ArchiveTeamCustomToolResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, toolId } = request.data ?? {}
    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof toolId !== "string" || !toolId) {
      throw new HttpsError("invalid-argument", "toolId is required.")
    }
    await assertAdminRole(teamId, auth.uid)
    const ref = db.doc(toolDocPath(teamId, toolId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Tool not found.")
    }
    await ref.set(
      {
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    invalidateToolsCache(teamId)
    const after = await ref.get()
    return { tool: normalizeToolDoc(teamId, toolId, after.data()) }
  }
)

interface RestoreTeamCustomToolRequest {
  teamId: string
  toolId: string
}

interface RestoreTeamCustomToolResponse {
  tool: TeamCustomToolDoc
}

export const restoreTeamCustomTool = onCall<RestoreTeamCustomToolRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<RestoreTeamCustomToolResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, toolId } = request.data ?? {}
    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof toolId !== "string" || !toolId) {
      throw new HttpsError("invalid-argument", "toolId is required.")
    }
    await assertAdminRole(teamId, auth.uid)
    const ref = db.doc(toolDocPath(teamId, toolId))
    const existing = await ref.get()
    if (!existing.exists) {
      throw new HttpsError("not-found", "Tool not found.")
    }
    const activeSnap = await db
      .collection(toolsCollectionPath(teamId))
      .where("archivedAt", "==", null)
      .count()
      .get()
    if (activeSnap.data().count >= MAX_ACTIVE_TOOLS_PER_TEAM) {
      throw new HttpsError(
        "failed-precondition",
        `Active tool limit reached (${MAX_ACTIVE_TOOLS_PER_TEAM}). ` +
          "Archive another tool first."
      )
    }
    await ref.set(
      {
        archivedAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    invalidateToolsCache(teamId)
    const after = await ref.get()
    return { tool: normalizeToolDoc(teamId, toolId, after.data()) }
  }
)

interface DeleteTeamCustomToolRequest {
  teamId: string
  toolId: string
}

interface DeleteTeamCustomToolResponse {
  toolId: string
  deleted: true
}

export const deleteTeamCustomTool = onCall<DeleteTeamCustomToolRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<DeleteTeamCustomToolResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, toolId } = request.data ?? {}
    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }
    if (typeof toolId !== "string" || !toolId) {
      throw new HttpsError("invalid-argument", "toolId is required.")
    }
    await assertAdminRole(teamId, auth.uid)
    const ref = db.doc(toolDocPath(teamId, toolId))
    const existing = await ref.get()
    if (!existing.exists) {
      invalidateToolsCache(teamId)
      return { toolId, deleted: true }
    }
    await ref.delete()
    invalidateToolsCache(teamId)
    return { toolId, deleted: true }
  }
)

// ─── Schema → Zod mapping for Genkit ────────────────────────────────────────

/**
 * Convert a stored field list into a Zod object schema usable by
 * `ai.defineTool`. Required fields are kept required; optional fields
 * become `.optional()`. `.describe(...)` is attached so the model sees
 * the per-field description in its tool catalog.
 */
function fieldsToZodObject(
  fields: ReadonlyArray<CustomToolField>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of fields) {
    let base: z.ZodTypeAny
    switch (field.type) {
      case "number":
        base = z.number()
        break
      case "boolean":
        base = z.boolean()
        break
      case "string":
      default:
        base = z.string()
        break
    }
    const desc = field.description ? base.describe(field.description) : base
    shape[field.name] = field.required ? desc : desc.optional()
  }
  return z.object(shape)
}

// ─── Template interpolation ─────────────────────────────────────────────────

/**
 * Substitute `{{fieldName}}` markers in a template string with the
 * model's tool-input values. Missing keys interpolate to "" rather
 * than throwing — keeps templates resilient when the model omits an
 * optional field. The replacer trims interior whitespace inside the
 * markers so `{{ name }}` works identically to `{{name}}`.
 */
function interpolateTemplate(
  template: string,
  input: Record<string, unknown>
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_m, k) => {
      const value = input[k]
      if (value === undefined || value === null) return ""
      if (typeof value === "object") {
        try {
          return JSON.stringify(value)
        } catch {
          return ""
        }
      }
      return String(value)
    }
  )
}

// ─── Action handlers ────────────────────────────────────────────────────────

async function executeHttpWebhook(
  action: Extract<CustomToolAction, { kind: "httpWebhook" }>,
  input: Record<string, unknown>
): Promise<unknown> {
  const headers: Record<string, string> = {}
  for (const h of action.headers) {
    headers[h.name] = interpolateTemplate(h.value, input)
  }
  const init: RequestInit & { signal?: AbortSignal } = {
    method: action.method,
    headers,
  }
  if (action.method !== "GET") {
    init.body = interpolateTemplate(action.bodyTemplate, input)
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json"
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), action.timeoutMs)
  init.signal = controller.signal
  try {
    const url = interpolateTemplate(action.url, input)
    const res = await fetch(url, init)
    const buf = await res.arrayBuffer()
    const limited =
      buf.byteLength > action.maxResponseBytes
        ? buf.slice(0, action.maxResponseBytes)
        : buf
    const text = new TextDecoder().decode(limited)
    // Best-effort JSON parse — if the response is plain text the model
    // gets the string verbatim, which is usually what it wants for
    // text-returning APIs (status pages, weather, etc.).
    try {
      return {
        status: res.status,
        ok: res.ok,
        body: JSON.parse(text),
        truncated: buf.byteLength > action.maxResponseBytes,
      }
    } catch {
      return {
        status: res.status,
        ok: res.ok,
        body: text,
        truncated: buf.byteLength > action.maxResponseBytes,
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpsError(
        "deadline-exceeded",
        `HTTP webhook timed out after ${action.timeoutMs}ms.`
      )
    }
    throw new HttpsError(
      "unavailable",
      `HTTP webhook failed: ${err instanceof Error ? err.message : "unknown"}`
    )
  } finally {
    clearTimeout(timer)
  }
}

function executeConstant(
  action: Extract<CustomToolAction, { kind: "constant" }>
): unknown {
  // Try parsing as JSON for a structured return; fall back to the raw
  // string so admins can ship plain-text tools too.
  try {
    return JSON.parse(action.value)
  } catch {
    return action.value
  }
}

async function executePromptTemplate(
  action: Extract<CustomToolAction, { kind: "promptTemplate" }>,
  input: Record<string, unknown>,
  context: BotActionContext | undefined
): Promise<unknown> {
  const prompt = interpolateTemplate(action.prompt, input)
  // Pick the wire-name in priority order:
  //   1. Admin-specified override (if the provider is still configured).
  //   2. The chat's current effective model (post-clamp; threaded
  //      through via `BotActionContext.effectiveModel`).
  //   3. A hardcoded Flash fallback so the call doesn't blow up on
  //      legacy code paths that never set `effectiveModel`.
  let modelName: string
  const adminProvider = action.model ? modelProvider(action.model) : null
  if (
    action.model &&
    adminProvider &&
    isAiModelProviderConfigured(adminProvider)
  ) {
    modelName = action.model
  } else if (context?.effectiveModel) {
    modelName = context.effectiveModel
  } else {
    modelName = "gemini-2.5-flash"
  }
  // The generation call deliberately avoids `output: { schema }`
  // because the tool's outputSchema is admin-defined and may be
  // free-form; returning the raw text and letting the model parse it
  // is more flexible than forcing a structured shape it might not
  // match.
  try {
    const result = await ai.generate({
      model: resolveModel(modelName),
      prompt,
    })
    return { text: result.text }
  } catch (err) {
    logger.warn("[customTools] promptTemplate failed", err)
    throw new HttpsError(
      "internal",
      `Prompt template tool failed: ${err instanceof Error ? err.message : "unknown"}`
    )
  }
}

async function executeWorkspaceSearch(
  action: Extract<CustomToolAction, { kind: "workspaceSearch" }>,
  input: Record<string, unknown>,
  context: BotActionContext | undefined
): Promise<unknown> {
  // The model's tool input must include `query` (we add it
  // automatically to the schema below). The action's `filterHint`
  // prepends to the query so the model effectively searches against
  // the admin-narrowed topic.
  const baseQuery = typeof input.query === "string" ? input.query : ""
  const fullQuery = action.filterHint
    ? `${action.filterHint} ${baseQuery}`.trim()
    : baseQuery
  // `searchWorkspaceNodesTool` is itself a Genkit tool — invoke it as
  // a function (Genkit tools expose a callable interface). Pass the
  // workspace-aware action context so the underlying retriever
  // resolves the correct collection. `null` (admin chose "both")
  // maps to the literal "both" the underlying tool expects.
  return await searchWorkspaceNodesTool(
    {
      query: fullQuery,
      scope: action.scope ?? "both",
      limit: action.defaultLimit,
    },
    { context }
  )
}

/**
 * Provider for a wire-name, or `null` for an unknown prefix. Local
 * variant of `getModelProvider` (which throws on unknown); we want a
 * silent "not configured → fall back to chat model" branch, not an
 * exception bubbling up from a tool call mid-turn.
 */
function modelProvider(
  modelId: string
): "google" | "anthropic" | "openai" | null {
  if (modelId.startsWith("gemini-")) return "google"
  if (modelId.startsWith("claude-")) return "anthropic"
  if (modelId.startsWith("gpt-")) return "openai"
  return null
}

// ─── Genkit tool factory ────────────────────────────────────────────────────

/**
 * Build a dynamic Genkit tool from a stored doc. Called once per
 * relevant tool per chat turn from `bot.ts::pickChatTools`. The
 * construction is per-turn (not module-scope) because each tool's
 * schema is admin-defined and may change between turns — caching
 * across turns would either need invalidation tied to the cache TTL
 * (complex) or risk stale schemas (worse).
 *
 * Uses `tool()` (not `ai.defineTool()`) for the registration. The
 * distinction is load-bearing for per-turn dynamic tools:
 *
 *   - `ai.defineTool(...)` registers the tool in Genkit's GLOBAL
 *     registry by name. Intended for module-load static tools
 *     (`getWeatherTool`, `summarizeNodeTool`, etc.). Calling it more
 *     than once with the same name within a single process either
 *     throws or leaves stale registry state — the wrong primitive
 *     when the same admin-authored name re-appears every turn.
 *
 *   - `tool(...)` (the modern API; `dynamicTool` is the deprecated
 *     alias) returns a `DynamicToolAction` that's NOT added to the
 *     registry. The model still sees it on this turn because it's
 *     passed inline via `session.chat({ tools })`, but there's no
 *     persistent registration that conflicts with the next turn's
 *     re-creation.
 *
 * Previously this used `ai.defineTool` which silently produced the
 * symptom "tool card never appears" from turn 2 onward — first turn
 * succeeded (registry was empty), subsequent turns failed to register
 * cleanly so the model saw a stale/missing tool catalog.
 *
 * `workspaceSearch` tools have a hardcoded `query: string` input
 * appended to whatever the admin defined, so the model always knows
 * what to send. Other action types take whatever the admin's input
 * schema specifies (or `{}` for a tool with no inputs).
 */
export function buildCustomToolForChat(doc: TeamCustomToolDoc) {
  // For workspaceSearch tools we INJECT a `query` field so the model
  // always has a way to pass the natural-language search string. The
  // admin's input fields can still be added on top (e.g. an extra
  // filter); reserved field name `query` is documented in the editor.
  const baseInputFields: CustomToolField[] =
    doc.action.kind === "workspaceSearch"
      ? [
          {
            name: "query",
            type: "string",
            description: "Natural-language search query.",
            required: true,
          },
          ...doc.inputSchema.fields.filter((f) => f.name !== "query"),
        ]
      : doc.inputSchema.fields

  const inputZod = fieldsToZodObject(baseInputFields)
  // OutputSchema is intentionally `z.any()` rather than the
  // admin-defined shape. The model only USES the output text the
  // handler returns; forcing a strict shape risks rejecting valid
  // payloads (HTTP webhook returning a string when admins typed it
  // as `object`, prompt-template returning structured-but-unexpected
  // shape). Treat the admin's outputSchema as documentation for the
  // model, surfaced via `.describe` on the tool description.
  const outputDescription =
    doc.outputSchema.fields.length > 0
      ? `Returns: ${doc.outputSchema.fields
          .map(
            (f) =>
              `\`${f.name}\` (${f.type})${f.description ? ` — ${f.description}` : ""}`
          )
          .join(", ")}.`
      : "Returns the tool's response."

  return tool(
    {
      name: doc.name,
      description: `${doc.description}\n\n${outputDescription}`,
      inputSchema: inputZod,
      outputSchema: z.any(),
    },
    async (input, { context }) => {
      const ctx = context as BotActionContext | undefined
      const inputObj = input as Record<string, unknown>
      switch (doc.action.kind) {
        case "httpWebhook":
          return executeHttpWebhook(doc.action, inputObj)
        case "constant":
          return executeConstant(doc.action)
        case "promptTemplate":
          return executePromptTemplate(doc.action, inputObj, ctx)
        case "workspaceSearch":
          return executeWorkspaceSearch(doc.action, inputObj, ctx)
      }
    }
  )
}

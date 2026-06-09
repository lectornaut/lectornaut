/**
 * Memory — content mutations (the create/update/delete/archive/pin/share ring).
 *
 * Every write is an authorized, audited content mutation built on
 * `defineMutation` (study `createWorkspaceNode` in `audit.ts`): it composes
 * `authorize` (capability + scope-walk) → `requireAuthorized` → the handler in a
 * transaction → `logEvent` atomically inside it, and masks non-`HttpsError`
 * errors as `internal`. The create callable writes the doc WITHOUT an embedding;
 * `embedMemoryOnWrite` (memoryRag.ts) fills the vector in asynchronously, so the
 * create returns immediately (spec §10 / gotcha #9).
 *
 * Reads are NOT here: the list/management UI reads `memories` directly through
 * Firestore (rules-gated) via `useInfiniteCollectionQuery`, exactly like
 * notifications and sessions. Only the Admin-SDK `findNearest` recall is a
 * callable (`recallMemories`, a later phase).
 *
 * Resource type: memory audit rows use `resource.type: "content"` (a memory is
 * workspace content) — no new `LogResourceType` needed.
 */

import { FieldValue, type Transaction } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import { HttpsError } from "firebase-functions/v2/https"
import { z } from "zod"
import { defineMutation, logEvent } from "./audit.js"
import { authorize, requireAuthorized } from "./authorize.js"
import { defineCallable } from "./defineCallable.js"
import {
  MEMORY_CATEGORIES,
  MEMORY_VISIBILITY,
  type MemoryCategory,
  type MemorySource,
  type MemoryVisibility,
} from "./domain.js"
import { db } from "./firebase.js"
import { recallMemoriesCore, type RecalledMemory } from "./memoryRag.js"
import {
  clampImportance,
  isNearDuplicate,
  MEMORY_CONTENT_MAX,
  MEMORY_SUMMARY_MAX,
  normalizeTags,
} from "./memoryShared.js"
import { DESTRUCTIVE_CALLABLE_OPTS } from "./runtimeConfig.js"
import { Capabilities } from "./types.js"
import { resolveParticipation } from "./workspaceRoles.js"

// ===========================================================================
// Shared helpers
// ===========================================================================

const nonEmptyString = z.string().trim().min(1)

/** Every memory mutation authorizes + audits on the same (team, workspace). */
const memoryScope = (input: { teamId: string; workspaceId: string }) => ({
  teamId: input.teamId,
  workspaceId: input.workspaceId,
})

const MANAGE_MEMORY_DENY =
  "You do not have permission to manage workspace memories."

const READ_MEMORY_DENY =
  "You do not have permission to read workspace memories."

const PURGE_MEMORY_DENY =
  "You do not have permission to delete all workspace memories."

// Firestore write-batch ceiling (mirrors `DELETE_BATCH_SIZE` in audit.ts).
const MEMORY_DELETE_BATCH_SIZE = 450

/** Split into fixed-size chunks (batched deletes respect Firestore's cap). */
function chunkRefs<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

const RECALL_LIMIT_MIN = 1
const RECALL_LIMIT_MAX = 20

/** Coerce a client-supplied recall limit into [1, 20]; never throws. */
function clampRecallLimit(raw: number | undefined): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined
  return Math.min(RECALL_LIMIT_MAX, Math.max(RECALL_LIMIT_MIN, Math.floor(raw)))
}

const memoriesCollectionPath = (teamId: string, workspaceId: string) =>
  `teams/${teamId}/workspaces/${workspaceId}/memories`

const memoryDocPath = (teamId: string, workspaceId: string, memoryId: string) =>
  `${memoriesCollectionPath(teamId, workspaceId)}/${memoryId}`

const memoryTargetSchema = z.object({
  teamId: nonEmptyString,
  workspaceId: nonEmptyString,
  memoryId: nonEmptyString,
})

const contentSchema = z.string().trim().min(1).max(MEMORY_CONTENT_MAX)
const summarySchema = z.string().trim().max(MEMORY_SUMMARY_MAX)
const categorySchema = z.enum(MEMORY_CATEGORIES)
const visibilitySchema = z.enum(MEMORY_VISIBILITY)
// Permissive on purpose — clamped to [0, 100] in the handler (gotcha #3).
const importanceSchema = z.number()
const tagsSchema = z.array(z.string())
const metadataSchema = z.record(z.string(), z.unknown())

/** Read a memory through the mutation's transaction, throwing `not-found`. */
async function requireMemoryInTx(
  tx: Transaction,
  teamId: string,
  workspaceId: string,
  memoryId: string
): Promise<{
  ref: FirebaseFirestore.DocumentReference
  data: Record<string, unknown>
}> {
  const ref = db.doc(memoryDocPath(teamId, workspaceId, memoryId))
  const snap = await tx.get(ref)
  if (!snap.exists) {
    throw new HttpsError("not-found", "Memory not found.")
  }
  return { ref, data: snap.data() ?? {} }
}

// ===========================================================================
// Create
// ===========================================================================

export const createMemory = defineMutation({
  name: "createMemory",
  input: z.object({
    teamId: nonEmptyString,
    workspaceId: nonEmptyString,
    content: contentSchema,
    summary: summarySchema.optional(),
    tags: tagsSchema.optional(),
    category: categorySchema.optional(),
    importance: importanceSchema.optional(),
    visibility: visibilitySchema.optional(),
    metadata: metadataSchema.optional(),
  }),
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.create",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId } = input

    const workspaceRef = db.doc(`teams/${teamId}/workspaces/${workspaceId}`)
    const workspaceSnap = await tx.get(workspaceRef)
    if (!workspaceSnap.exists) {
      throw new HttpsError("not-found", "Workspace not found.")
    }

    const ref = db.collection(memoriesCollectionPath(teamId, workspaceId)).doc()
    const now = FieldValue.serverTimestamp()
    // Privacy-first defaults; the embed trigger fills `embedding` after this
    // write resolves, so it is intentionally absent here.
    const visibility = input.visibility ?? "private"
    const category = input.category ?? "context"
    const importance = clampImportance(input.importance)
    const tags = normalizeTags(input.tags)

    // Build conditionally — the Admin SDK rejects any `undefined` value (and an
    // undefined here would, via the in-transaction audit write, roll back the
    // whole mutation; cf. gotcha #1).
    const data: Record<string, unknown> = {
      ownerUid: actorId,
      visibility,
      content: input.content,
      category,
      importance,
      source: "user",
      archived: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    }
    if (input.summary) data.summary = input.summary
    if (tags.length > 0) data.tags = tags
    if (input.metadata && Object.keys(input.metadata).length > 0) {
      data.metadata = input.metadata
    }

    tx.set(ref, data)

    return {
      result: { memoryId: ref.id },
      audit: {
        resource: { type: "content", id: ref.id, parentId: workspaceId },
        // Record only the non-sensitive shape — never the (possibly private)
        // content body — in the admin-readable audit log.
        changes: {
          fields: ["content", "category", "visibility", "importance"],
          after: { category, visibility, importance },
        },
      },
    }
  },
})

// ===========================================================================
// Update
// ===========================================================================

export const updateMemory = defineMutation({
  name: "updateMemory",
  input: memoryTargetSchema.extend({
    content: contentSchema.optional(),
    summary: summarySchema.optional(),
    tags: tagsSchema.optional(),
    category: categorySchema.optional(),
    importance: importanceSchema.optional(),
  }),
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.update",
  handler: async ({ input, tx }) => {
    const { teamId, workspaceId, memoryId } = input
    const { ref } = await requireMemoryInTx(tx, teamId, workspaceId, memoryId)

    const updates: Record<string, unknown> = {}
    const fields: string[] = []

    if (input.content !== undefined) {
      updates.content = input.content
      fields.push("content")
    }
    if (input.summary !== undefined) {
      // Empty string clears the field; the embed trigger ignores summary.
      updates.summary = input.summary ? input.summary : FieldValue.delete()
      fields.push("summary")
    }
    if (input.tags !== undefined) {
      const tags = normalizeTags(input.tags)
      updates.tags = tags.length > 0 ? tags : FieldValue.delete()
      fields.push("tags")
    }
    if (input.category !== undefined) {
      updates.category = input.category
      fields.push("category")
    }
    if (input.importance !== undefined) {
      updates.importance = clampImportance(input.importance)
      fields.push("importance")
    }

    if (fields.length === 0) {
      // Nothing to change — skip the write AND the audit log (no-op).
      return { result: { memoryId, updated: false }, audit: null }
    }

    updates.updatedAt = FieldValue.serverTimestamp()
    tx.update(ref, updates)

    return {
      result: { memoryId, updated: true },
      audit: {
        resource: { type: "content", id: memoryId, parentId: workspaceId },
        // Field names only — never the edited content body — in the log.
        changes: { fields },
      },
    }
  },
})

// ===========================================================================
// Delete
// ===========================================================================

export const deleteMemory = defineMutation({
  name: "deleteMemory",
  input: memoryTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.delete",
  handler: async ({ input, tx }) => {
    const { teamId, workspaceId, memoryId } = input
    const { ref } = await requireMemoryInTx(tx, teamId, workspaceId, memoryId)

    tx.delete(ref)

    return {
      result: { memoryId, deleted: true },
      audit: {
        resource: { type: "content", id: memoryId, parentId: workspaceId },
      },
    }
  },
})

// ===========================================================================
// Archive / unarchive (soft delete)
// ===========================================================================

export const archiveMemory = defineMutation({
  name: "archiveMemory",
  input: memoryTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.archive",
  handler: async ({ input, tx }) => {
    const { teamId, workspaceId, memoryId } = input
    const { ref, data } = await requireMemoryInTx(
      tx,
      teamId,
      workspaceId,
      memoryId
    )
    if (data.archived === true) {
      return { result: { memoryId, archived: true }, audit: null }
    }

    tx.update(ref, {
      archived: true,
      archivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return {
      result: { memoryId, archived: true },
      audit: {
        resource: { type: "content", id: memoryId, parentId: workspaceId },
        changes: { fields: ["archived"], after: { archived: true } },
      },
    }
  },
})

export const unarchiveMemory = defineMutation({
  name: "unarchiveMemory",
  input: memoryTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.unarchive",
  handler: async ({ input, tx }) => {
    const { teamId, workspaceId, memoryId } = input
    const { ref, data } = await requireMemoryInTx(
      tx,
      teamId,
      workspaceId,
      memoryId
    )
    if (data.archived !== true) {
      return { result: { memoryId, archived: false }, audit: null }
    }

    tx.update(ref, {
      archived: false,
      archivedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return {
      result: { memoryId, archived: false },
      audit: {
        resource: { type: "content", id: memoryId, parentId: workspaceId },
        changes: { fields: ["archived"], after: { archived: false } },
      },
    }
  },
})

// ===========================================================================
// Pin / unpin (recall boost)
// ===========================================================================

export const pinMemory = defineMutation({
  name: "pinMemory",
  input: memoryTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.update",
  handler: async ({ input, tx }) => {
    const { teamId, workspaceId, memoryId } = input
    const { ref, data } = await requireMemoryInTx(
      tx,
      teamId,
      workspaceId,
      memoryId
    )
    if (data.pinned === true) {
      return { result: { memoryId, pinned: true }, audit: null }
    }

    tx.update(ref, { pinned: true, updatedAt: FieldValue.serverTimestamp() })

    return {
      result: { memoryId, pinned: true },
      audit: {
        resource: { type: "content", id: memoryId, parentId: workspaceId },
        changes: { fields: ["pinned"], after: { pinned: true } },
      },
    }
  },
})

export const unpinMemory = defineMutation({
  name: "unpinMemory",
  input: memoryTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.update",
  handler: async ({ input, tx }) => {
    const { teamId, workspaceId, memoryId } = input
    const { ref, data } = await requireMemoryInTx(
      tx,
      teamId,
      workspaceId,
      memoryId
    )
    if (data.pinned !== true) {
      return { result: { memoryId, pinned: false }, audit: null }
    }

    tx.update(ref, { pinned: false, updatedAt: FieldValue.serverTimestamp() })

    return {
      result: { memoryId, pinned: false },
      audit: {
        resource: { type: "content", id: memoryId, parentId: workspaceId },
        changes: { fields: ["pinned"], after: { pinned: false } },
      },
    }
  },
})

// ===========================================================================
// Share / unshare (owner-only, beyond the capability)
// ===========================================================================

export const shareMemory = defineMutation({
  name: "shareMemory",
  input: memoryTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.share",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId, memoryId } = input
    const { ref, data } = await requireMemoryInTx(
      tx,
      teamId,
      workspaceId,
      memoryId
    )
    // Owner-only beyond the capability: broadening who can see a memory is the
    // author's call alone — a member with MANAGE_WORKSPACE_CONTENT still can't
    // expose someone else's private memory (spec §4 / §7).
    if (data.ownerUid !== actorId) {
      throw new HttpsError(
        "permission-denied",
        "Only the owner can change a memory's visibility."
      )
    }
    if (data.visibility === "shared") {
      return { result: { memoryId, visibility: "shared" }, audit: null }
    }

    tx.update(ref, {
      visibility: "shared",
      updatedAt: FieldValue.serverTimestamp(),
    })

    return {
      result: { memoryId, visibility: "shared" },
      audit: {
        resource: { type: "content", id: memoryId, parentId: workspaceId },
        changes: { fields: ["visibility"], after: { visibility: "shared" } },
      },
    }
  },
})

export const unshareMemory = defineMutation({
  name: "unshareMemory",
  input: memoryTargetSchema,
  capability: Capabilities.MANAGE_WORKSPACE_CONTENT,
  context: memoryScope,
  denyMessage: MANAGE_MEMORY_DENY,
  action: "memory.unshare",
  handler: async ({ input, tx, actorId }) => {
    const { teamId, workspaceId, memoryId } = input
    const { ref, data } = await requireMemoryInTx(
      tx,
      teamId,
      workspaceId,
      memoryId
    )
    if (data.ownerUid !== actorId) {
      throw new HttpsError(
        "permission-denied",
        "Only the owner can change a memory's visibility."
      )
    }
    if (data.visibility !== "shared") {
      return { result: { memoryId, visibility: "private" }, audit: null }
    }

    tx.update(ref, {
      visibility: "private",
      updatedAt: FieldValue.serverTimestamp(),
    })

    return {
      result: { memoryId, visibility: "private" },
      audit: {
        resource: { type: "content", id: memoryId, parentId: workspaceId },
        changes: { fields: ["visibility"], after: { visibility: "private" } },
      },
    }
  },
})

// ===========================================================================
// Recall (read) — semantic + hybrid, Admin-SDK findNearest so it's a callable
// ===========================================================================

export interface RecallMemoriesResult {
  memories: RecalledMemory[]
}

/**
 * Semantic recall over the workspace's memories. A read (no audit), so it
 * composes `authorize` + `requireAuthorized` directly rather than going through
 * `defineMutation`. `READ_WORKSPACE` is team-scoped, so it does NOT itself check
 * workspace participation — we add an explicit exclusion deny so an excluded
 * member can't recall (defense-in-depth matching the rules' `!isWorkspaceExcluded`).
 *
 * The visibility filter inside `recallMemoriesCore` is the privacy boundary
 * (owner-or-shared only, never an admin override), so recall never injects
 * another member's private memory.
 */
export const recallMemories = defineCallable<
  {
    teamId: string
    workspaceId: string
    query: string
    limit?: number
  },
  RecallMemoriesResult
>({
  name: "recallMemories",
  input: z.object({
    teamId: nonEmptyString,
    workspaceId: nonEmptyString,
    query: z.string().trim().min(1),
    limit: z.number().optional(),
  }),
  handler: async ({ auth, input }) => {
    const actorId = auth.uid
    const { teamId, workspaceId } = input

    requireAuthorized(
      await authorize(actorId, Capabilities.READ_WORKSPACE, {
        teamId,
        workspaceId,
      }),
      READ_MEMORY_DENY
    )
    const participation = await resolveParticipation(
      teamId,
      workspaceId,
      actorId
    )
    if (participation.excluded) {
      throw new HttpsError(
        "permission-denied",
        "You are not a member of this workspace."
      )
    }

    const memories = await recallMemoriesCore({
      teamId,
      workspaceId,
      actingUid: actorId,
      query: input.query,
      limit: clampRecallLimit(input.limit),
    })
    return { memories }
  },
})

// ===========================================================================
// Purge (admin governance) — delete every memory in a workspace
// ===========================================================================

export interface PurgeWorkspaceMemoriesResult {
  deleted: number
  logId: string
}

/**
 * Delete EVERY memory in a workspace — the admin "Delete all" governance action
 * (Settings → Memory). Gated by `MANAGE_WORKSPACE_STORAGE` (owner/admin-only,
 * distinct from the member-level `MANAGE_WORKSPACE_CONTENT` everyday CRUD).
 *
 * A batched delete (not one transaction — a workspace can hold more docs than a
 * transaction allows), so it composes `authorize` + chunked `batch.delete` +
 * a single audited `logEvent` directly, like the storage-side-effect mutations.
 * Available regardless of the `memoryEnabled` toggle — governance over existing
 * data stays on even when the subsystem is dormant (spec §8b).
 */
export const purgeWorkspaceMemories = defineCallable<
  { teamId: string; workspaceId: string },
  PurgeWorkspaceMemoriesResult
>({
  name: "purgeWorkspaceMemories",
  opts: DESTRUCTIVE_CALLABLE_OPTS,
  input: z.object({
    teamId: nonEmptyString,
    workspaceId: nonEmptyString,
  }),
  handler: async ({ auth, input }) => {
    const actorId = auth.uid
    const actorEmail = auth.token.email ?? undefined
    const { teamId, workspaceId } = input

    const role =
      requireAuthorized(
        await authorize(actorId, Capabilities.MANAGE_WORKSPACE_STORAGE, {
          teamId,
          workspaceId,
        }),
        PURGE_MEMORY_DENY
      ).teamRole ?? undefined

    const snap = await db
      .collection(memoriesCollectionPath(teamId, workspaceId))
      .get()
    const refs = snap.docs.map((d) => d.ref)

    let deleted = 0
    for (const batchRefs of chunkRefs(refs, MEMORY_DELETE_BATCH_SIZE)) {
      const batch = db.batch()
      batchRefs.forEach((ref) => batch.delete(ref))
      await batch.commit()
      deleted += batchRefs.length
    }

    const logRef = await logEvent({
      teamId,
      workspaceId,
      actor: { userId: actorId, email: actorEmail, role },
      action: "memory.purge",
      resource: { type: "content", id: workspaceId, parentId: teamId },
      changes: { fields: ["deletedCount"], after: { deletedCount: deleted } },
    })

    return { deleted, logId: logRef.id }
  },
})

// ===========================================================================
// Internal agent-write path (saveMemory tool + post-gen extraction)
// ===========================================================================

export interface SaveMemoryInternalParams {
  teamId: string
  workspaceId: string
  /** The human owner the memory is saved on behalf of. Empty ⇒ skip (no owner). */
  ownerUid: string
  content: string
  summary?: string
  tags?: string[]
  category?: MemoryCategory
  importance?: number
  /** Default `"private"` — auto-saved memories never silently widen. */
  visibility?: MemoryVisibility
  source: MemorySource
  /** Set when an agent wrote it (audit actor + the doc's `agentId`). */
  agentId?: string
}

export interface SaveMemoryInternalResult {
  memoryId: string
  merged: boolean
}

/**
 * Non-transactional create used by the `saveMemory` bot tool and post-generation
 * extraction. Composes `authorize` (defense-in-depth — owner must have content
 * rights) → near-duplicate detection (a tight-cosine recall against the owner's
 * own memories) → either MERGE into the near-dup or INSERT a fresh doc → audited
 * via a non-txn `logEvent`. Best-effort: returns `null` rather than throwing so a
 * save can never abort the chat turn it runs inside.
 *
 * The embedding is filled asynchronously by `embedMemoryOnWrite`; merge edits the
 * stored `content`/`tags`/`importance` and the trigger re-embeds on the change.
 */
export async function saveMemoryInternal(
  params: SaveMemoryInternalParams
): Promise<SaveMemoryInternalResult | null> {
  const { teamId, workspaceId, ownerUid } = params
  const content = params.content.trim().slice(0, MEMORY_CONTENT_MAX)
  if (!ownerUid || !content) return null

  // Defense-in-depth: the owner must be able to manage workspace content. Never
  // throws here — a denied save just no-ops (it's inside a chat turn).
  const decision = await authorize(
    ownerUid,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
    {
      teamId,
      workspaceId,
    }
  )
  if (!decision.allowed) {
    logger.debug(
      `[saveMemoryInternal] skipped: owner=${ownerUid} not authorized in team=${teamId} workspace=${workspaceId}`
    )
    return null
  }

  const tags = normalizeTags(params.tags)
  const importance = clampImportance(params.importance)
  const category: MemoryCategory = params.category ?? "context"
  const visibility: MemoryVisibility = params.visibility ?? "private"
  const summary = params.summary?.trim()

  // Near-duplicate detection (spec §5): a tight-cosine recall against the
  // owner's own memories. Only the embedded existing memories are findable, so
  // this is best-effort. A hit collapses into a merge instead of a new row.
  let nearDup: RecalledMemory | undefined
  try {
    const hits = await recallMemoriesCore({
      teamId,
      workspaceId,
      actingUid: ownerUid,
      query: content,
      limit: 1,
      fetch: 5,
    })
    const top = hits[0]
    if (top && top.ownerUid === ownerUid && isNearDuplicate(top.distance)) {
      nearDup = top
    }
  } catch {
    // Dedup is best-effort; a recall hiccup just means we insert fresh.
  }

  const now = FieldValue.serverTimestamp()

  if (nearDup) {
    // Merge into the existing memory: union tags, max importance, keep the
    // richer (longer) content. Re-fetch to read the true stored content (the
    // recalled snippet is PII-redacted and not a safe write source).
    const ref = db.doc(memoryDocPath(teamId, workspaceId, nearDup.id))
    const snap = await ref.get()
    if (snap.exists) {
      const data = snap.data() ?? {}
      const existingContent =
        typeof data.content === "string" ? data.content : ""
      const existingTags = Array.isArray(data.tags)
        ? data.tags.filter((t): t is string => typeof t === "string")
        : []
      const existingImportance =
        typeof data.importance === "number" ? data.importance : 0
      const mergedContent =
        content.length > existingContent.length ? content : existingContent
      const mergedTags = normalizeTags([...existingTags, ...tags])
      const updates: Record<string, unknown> = {
        importance: Math.max(existingImportance, importance),
        updatedAt: now,
      }
      if (mergedContent !== existingContent) updates.content = mergedContent
      if (mergedTags.length > 0) updates.tags = mergedTags
      if (summary && !data.summary) updates.summary = summary
      await ref.update(updates)
      await logEvent({
        teamId,
        workspaceId,
        actor: { userId: ownerUid, agentId: params.agentId },
        action: "memory.merge",
        resource: { type: "content", id: nearDup.id, parentId: workspaceId },
        changes: {
          fields: Object.keys(updates).filter((k) => k !== "updatedAt"),
        },
      })
      return { memoryId: nearDup.id, merged: true }
    }
    // The near-dup vanished between recall and read — fall through to insert.
  }

  const ref = db.collection(memoriesCollectionPath(teamId, workspaceId)).doc()
  const data: Record<string, unknown> = {
    ownerUid,
    visibility,
    content,
    category,
    importance,
    source: params.source,
    archived: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }
  if (summary) data.summary = summary
  if (tags.length > 0) data.tags = tags
  if (params.agentId) data.agentId = params.agentId

  await ref.set(data)
  await logEvent({
    teamId,
    workspaceId,
    actor: { userId: ownerUid, agentId: params.agentId },
    action: "memory.create",
    resource: { type: "content", id: ref.id, parentId: workspaceId },
    changes: {
      fields: ["content", "category", "visibility", "importance"],
      after: { category, visibility, importance },
    },
  })
  return { memoryId: ref.id, merged: false }
}

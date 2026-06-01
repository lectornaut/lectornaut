/**
 * Agent node-CRUD tools — let an agent member create and maintain workspace
 * nodes (files / folders) mid-chat. The model controls only the *intent*
 * (name, content, where); the team / workspace and the authorization gate
 * come from the action context the dispatcher populates — the model can
 * never widen its own scope.
 *
 * Authorization (defense in depth) — split into READ and WRITE:
 *   - WRITE tools (`NODE_WRITE_TOOLS`: create/update/rename/move/archive)
 *     are REGISTERED only when `canManageNodes` is true — the INTERSECTION
 *     of the active agent's role AND the driving user's role, both needing
 *     MANAGE_WORKSPACE_CONTENT. A guest can't drive a member-agent into
 *     editing content they couldn't touch themselves.
 *   - READ tool (`NODE_READ_TOOLS`: `readNode`) is registered when
 *     `canReadNodes` holds — the same intersection but on the lighter
 *     READ_WORKSPACE capability (held by every role, guests included), so
 *     an agent can read full file content without edit rights.
 *   - Each is additionally gated by a team-wide + per-agent toggle
 *     (`manageContent` / `readContent`); see `bot.ts`.
 *   - Every handler re-checks the matching flag via `resolveNodeContext`
 *     (`access: "read" | "write"`) + `ctx.activeAgentId`, so a future code
 *     path that registers a tool without its gate still can't run it.
 *
 * Attribution: mutations are written via the admin SDK (bypassing rules,
 * like every other server mutation) with `createdBy`/`updatedBy` set to the
 * agent id and an audit-log `actor` of `{ userId: <driver>, agentId,
 * agentName }` — "by <agent>, on behalf of <user>".
 *
 * Content model: `write` nodes persist Tiptap JSON, so the agent's markdown
 * is converted via `markdownToTiptapJson`; `code` nodes store raw text. A
 * content edit also deletes the node's Yjs snapshot (`snapshots/{nodeId}`)
 * so the collaborative editor re-seeds from the new `content` on next open
 * (see `TextEditor.vue`'s empty-doc hydration) — otherwise a stale CRDT
 * snapshot would mask the edit. The embed-on-write trigger re-indexes the
 * node for search automatically.
 *
 * Scope is deliberately ARCHIVE-only — no hard delete — so every agent
 * action is reversible.
 */

import { z } from "genkit/beta"

import { logEvent } from "./audit.js"
import { admin, db } from "./firebase.js"
import { ai } from "./genkitClient.js"
import {
  markdownToTiptapJson,
  tiptapJsonToMarkdown,
} from "./markdownToTiptap.js"
import type { NodeType, WorkspaceNodeScope } from "./types.js"

// ─── Local helpers (mirror the private ones in audit.ts) ─────────────────────

const ROOT_PARENT_ID = "root"
const NODE_NAME_MAX_LENGTH = 128

function normalizeNodeName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}

function toNameLower(name: string): string {
  return normalizeNodeName(name).toLowerCase()
}

function getTypeOrder(type: NodeType): number {
  return type === "folder" ? 0 : 1
}

function nodesCollectionPath(
  teamId: string,
  workspaceId: string,
  scope: WorkspaceNodeScope
): string {
  return `teams/${teamId}/workspaces/${workspaceId}/${scope}`
}

// ─── Shared context + result shapes ──────────────────────────────────────────

/** Op kinds a WRITE tool can record for review / audit. */
export type NodeChangeOp =
  | "create"
  | "update"
  | "rename"
  | "move"
  | "archive"
  | "unarchive"

/**
 * A node edit recorded by a WRITE tool. In `require_review` (capture-only)
 * mode it's a PROPOSAL replayed on approval; in `automatic` mode it's an
 * audit record of an edit already applied. `input` is the verbatim tool input
 * so `applyProposedChange` can re-run it.
 */
export interface CapturedNodeChange {
  op: NodeChangeOp
  scope: WorkspaceNodeScope
  nodeId: string | null
  summary: string
  input: Record<string, unknown>
  sourceNodeId?: string | null
}

interface NodeToolContext {
  auth?: { uid?: string }
  teamId?: string
  workspaceId?: string
  /** May run the WRITE tools (create/update/rename/move/archive). */
  canManageNodes?: boolean
  /** May run the READ tool (`readNode`). Lighter `READ_WORKSPACE` gate. */
  canReadNodes?: boolean
  activeAgentId?: string
  activeAgentName?: string
  /**
   * When present, WRITE tools push a {@link CapturedNodeChange} here. Set by
   * the Workflows worker so a headless run's edits are recorded (for the run's
   * changeset + cost view).
   */
  captureSink?: CapturedNodeChange[]
  /**
   * When true (a `require_review` workflow run), WRITE tools record the change
   * into `captureSink` and return success WITHOUT committing — the edit is
   * applied later, on admin approval, via {@link applyProposedChange}.
   */
  captureOnly?: boolean
  /**
   * When set, WRITE tools refuse edits to any other scope — enforces a
   * workflow's `targetScope` so an automation can't wander outside its tree.
   */
  allowedScope?: WorkspaceNodeScope | null
}

export interface ResolvedNodeContext {
  teamId: string
  workspaceId: string
  agentId: string
  agentName: string
  actorUid: string
}

/**
 * Pull the workspace + authorization facts the dispatcher injected. Returns
 * a `{ error }` the handler surfaces to the model rather than throwing — a
 * permission failure should read back as a normal tool result the agent can
 * explain, not a turn-killing exception.
 *
 * `access` picks which membership flag to require: `"write"` (default) for
 * the mutating tools checks `canManageNodes`; `"read"` for `readNode`
 * checks the lighter `canReadNodes`. This is defense in depth — the
 * dispatcher already only registers each tool when its gate holds — so a
 * future stray registration still can't bypass the right capability.
 */
function resolveNodeContext(
  context: unknown,
  access: "read" | "write" = "write"
): ResolvedNodeContext | { error: string } {
  const ctx = (context ?? {}) as NodeToolContext
  if (!ctx.teamId || !ctx.workspaceId) {
    return { error: "No workspace is bound to this chat." }
  }
  const permitted = access === "read" ? ctx.canReadNodes : ctx.canManageNodes
  if (!permitted || !ctx.activeAgentId) {
    return {
      error:
        access === "read"
          ? "You're not permitted to read this workspace's content. " +
            "Adding the agent as a team member is required."
          : "You're not permitted to modify this workspace's content. " +
            "Adding the agent as a team member with edit rights is required.",
    }
  }
  return {
    teamId: ctx.teamId,
    workspaceId: ctx.workspaceId,
    agentId: ctx.activeAgentId,
    agentName: ctx.activeAgentName ?? "Agent",
    actorUid: ctx.auth?.uid ?? "",
  }
}

type MutationResult = {
  ok: boolean
  nodeId?: string
  name?: string
  message: string
}

/** Reject a WRITE op whose scope is outside the run's allowed target tree. */
function scopeBlocked(
  context: unknown,
  scope: WorkspaceNodeScope
): MutationResult | null {
  const ctx = (context ?? {}) as NodeToolContext
  if (ctx.allowedScope && ctx.allowedScope !== scope) {
    return {
      ok: false,
      message:
        `This workflow may only edit the "${ctx.allowedScope}" tree, ` +
        `not the "${scope}" tree.`,
    }
  }
  return null
}

/**
 * Record a WRITE op on the run's capture sink (if present). In capture-only
 * mode (a `require_review` run) returns a success result so the caller SKIPS
 * committing — the edit is applied later on approval via
 * {@link applyProposedChange}. Otherwise returns null and the caller commits.
 */
function captureGate(
  context: unknown,
  change: CapturedNodeChange
): MutationResult | null {
  const ctx = (context ?? {}) as NodeToolContext
  if (ctx.captureSink) ctx.captureSink.push(change)
  if (ctx.captureOnly) {
    return {
      ok: true,
      nodeId: change.nodeId ?? undefined,
      name:
        typeof change.input.name === "string" ? change.input.name : undefined,
      message: `Proposed for review: ${change.summary}`,
    }
  }
  return null
}

const nodeScopeSchema = z
  .enum(["code", "write"])
  .describe(
    "Which workspace subtree the node lives in: 'code' (raw source files) " +
      "or 'write' (rich-text documents)."
  )

function validateName(raw: string): { name: string } | { error: string } {
  const name = normalizeNodeName(raw)
  if (!name.length || name.length > NODE_NAME_MAX_LENGTH) {
    return {
      error: `Name must be between 1 and ${NODE_NAME_MAX_LENGTH} characters.`,
    }
  }
  return { name }
}

/**
 * Serialize agent-supplied content for storage. `write` nodes hold Tiptap
 * JSON (convert the markdown); `code` nodes hold the raw text verbatim.
 */
function serializeContent(scope: WorkspaceNodeScope, content: string): string {
  return scope === "write" ? markdownToTiptapJson(content) : content
}

const mutationResultSchema = z.object({
  ok: z.boolean(),
  nodeId: z.string().optional(),
  name: z.string().optional(),
  message: z.string(),
})

// ─── createNode ──────────────────────────────────────────────────────────────

export const createNodeTool = ai.defineTool(
  {
    name: "createNode",
    description:
      "Create a new file or folder in the team's workspace. Use for " +
      "requests like 'make a new doc for the launch plan' or 'add a folder " +
      "called Specs'. For files you may pass initial `content`: markdown " +
      "for 'write' docs (converted to rich text) or raw source for 'code' " +
      "files. Folders ignore content. Returns the new node's id, which you " +
      "can feed into updateNodeContent / renameNode / moveNode.",
    inputSchema: z.object({
      scope: nodeScopeSchema,
      type: z
        .enum(["file", "folder"])
        .describe("Whether to create a file or a folder."),
      name: z.string().min(1).describe("Display name for the new node."),
      parentId: z
        .string()
        .optional()
        .describe(
          "Id of the parent folder. Omit (or 'root') to create at the top " +
            "level. Must reference an existing, non-archived folder."
        ),
      content: z
        .string()
        .optional()
        .describe(
          "Initial file content. Markdown for 'write' docs; raw source for " +
            "'code' files. Ignored for folders."
        ),
    }),
    outputSchema: mutationResultSchema,
  },
  async (input, { context }) => {
    const resolved = resolveNodeContext(context)
    if ("error" in resolved) return { ok: false, message: resolved.error }
    const blocked = scopeBlocked(context, input.scope)
    if (blocked) return blocked
    const gated = captureGate(context, {
      op: "create",
      scope: input.scope,
      nodeId: null,
      summary: `Create ${input.type} "${input.name}"`,
      input: { ...input },
    })
    if (gated) return gated
    return applyCreateNode(resolved, input)
  }
)

interface CreateNodeInput {
  scope: WorkspaceNodeScope
  type: "file" | "folder"
  name: string
  parentId?: string
  content?: string
}

/** Commit core for `createNode` — shared by the live tool + approval replay. */
export async function applyCreateNode(
  resolved: ResolvedNodeContext,
  input: CreateNodeInput
): Promise<MutationResult> {
  const { teamId, workspaceId, agentId, agentName, actorUid } = resolved

  const named = validateName(input.name)
  if ("error" in named) return { ok: false, message: named.error }
  const { name } = named

  const scope = input.scope
  const type = input.type
  const parentId =
    typeof input.parentId === "string" && input.parentId.trim()
      ? input.parentId.trim()
      : ROOT_PARENT_ID

  try {
    const nodeId = await db.runTransaction(async (transaction) => {
      if (parentId !== ROOT_PARENT_ID) {
        const parentRef = db.doc(
          `${nodesCollectionPath(teamId, workspaceId, scope)}/${parentId}`
        )
        const parentSnap = await transaction.get(parentRef)
        if (!parentSnap.exists) throw new Error("Parent folder not found.")
        const parentData = parentSnap.data() ?? {}
        if (parentData.type !== "folder") {
          throw new Error("Parent must be a folder.")
        }
        if (parentData.isArchived) throw new Error("Parent folder is archived.")
      }

      const nodeRef = db
        .collection(nodesCollectionPath(teamId, workspaceId, scope))
        .doc()
      const now = admin.firestore.FieldValue.serverTimestamp()
      const nameLower = toNameLower(name)
      const fileContent =
        type === "file" && typeof input.content === "string" && input.content
          ? serializeContent(scope, input.content)
          : ""

      transaction.set(nodeRef, {
        workspaceId,
        type,
        typeOrder: getTypeOrder(type),
        name,
        nameLower,
        parentId,
        isArchived: false,
        createdAt: now,
        createdBy: agentId,
        updatedAt: now,
        updatedBy: agentId,
        sortKey: nameLower,
        ...(type === "file" ? { content: fileContent } : {}),
      })

      await logEvent(
        {
          teamId,
          workspaceId,
          actor: { userId: actorUid || undefined, agentId, agentName },
          action: "content.create",
          resource: {
            type: "content",
            id: nodeRef.id,
            parentId: workspaceId,
          },
          changes: {
            fields: ["name", "type", "parentId"],
            after: { name, type, parentId },
          },
        },
        { transaction }
      )

      return nodeRef.id
    })

    return {
      ok: true,
      nodeId,
      name,
      message: `Created ${type} "${name}".`,
    }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

// ─── readNode ────────────────────────────────────────────────────────────────

/**
 * Largest file `readNode` will return. Above this we fail closed rather than
 * truncate: handing back a partial document that the model might feed straight
 * into `updateNodeContent` would silently delete the omitted tail. Oversized
 * docs are rare; the safe answer is "narrow the edit / do it in the app."
 */
const READ_NODE_MAX_CHARS = 100_000

export const readNodeTool = ai.defineTool(
  {
    name: "readNode",
    description:
      "Read the FULL current content of a workspace file. Returns 'write' " +
      "docs as markdown and 'code' files as raw source — the same formats " +
      "updateNodeContent accepts — so you can read, modify, and write the " +
      "result back without losing the rest of the document. Call this " +
      "BEFORE updateNodeContent whenever the file isn't already in the " +
      "attached-context block: a searchWorkspaceNodes snippet is only a " +
      "preview, and overwriting from a preview destroys everything it " +
      "omitted. Folders have no content to read.",
    inputSchema: z.object({
      scope: nodeScopeSchema,
      nodeId: z.string().min(1).describe("Id of the file to read."),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      nodeId: z.string().optional(),
      name: z.string().optional(),
      type: z.enum(["file", "folder"]).optional(),
      content: z.string().optional(),
      message: z.string(),
    }),
  },
  async (input, { context }) => {
    const resolved = resolveNodeContext(context, "read")
    if ("error" in resolved) return { ok: false, message: resolved.error }
    const { teamId, workspaceId } = resolved
    const { scope, nodeId } = input

    try {
      const snap = await db
        .doc(`${nodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`)
        .get()
      if (!snap.exists) return { ok: false, message: "Node not found." }
      const data = snap.data() ?? {}
      if (data.isArchived) {
        return {
          ok: false,
          nodeId,
          message: "Node is archived — unarchive it before reading.",
        }
      }
      const name = typeof data.name === "string" ? data.name : nodeId
      const type: "folder" | "file" = data.type === "folder" ? "folder" : "file"
      if (type === "folder") {
        return {
          ok: true,
          nodeId,
          name,
          type,
          content: "",
          message: `"${name}" is a folder and has no content.`,
        }
      }

      const raw = typeof data.content === "string" ? data.content : ""
      const full = scope === "write" ? tiptapJsonToMarkdown(raw) : raw
      if (full.length > READ_NODE_MAX_CHARS) {
        return {
          ok: false,
          nodeId,
          name,
          type,
          message:
            `"${name}" is too large to read in full (${full.length} ` +
            `characters; limit ${READ_NODE_MAX_CHARS}). Do not overwrite ` +
            `it from a partial view — ask the user to narrow the change or ` +
            `to edit it directly in the app.`,
        }
      }

      return {
        ok: true,
        nodeId,
        name,
        type,
        content: full,
        message: full
          ? `Read "${name}" (${full.length} characters).`
          : `"${name}" is empty.`,
      }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  }
)

// ─── updateNodeContent ───────────────────────────────────────────────────────

export const updateNodeContentTool = ai.defineTool(
  {
    name: "updateNodeContent",
    description:
      "Replace the entire content of an existing file. Pass markdown for " +
      "'write' docs (converted to rich text) or raw source for 'code' " +
      "files. This OVERWRITES the whole document — include the full new " +
      "content, not just a diff, and preserve anything you are not " +
      "intentionally changing. Only call this when you already have the " +
      "file's FULL current text (from the attached-context block or a " +
      "readNode call); a search snippet or summary is NOT enough, since " +
      "overwriting from a partial view destroys the rest of the document. " +
      "If you don't have the full content, call readNode first to fetch " +
      "it (or ask the user to attach the file). Folders can't hold " +
      "content.",
    inputSchema: z.object({
      scope: nodeScopeSchema,
      nodeId: z.string().min(1).describe("Id of the file to update."),
      content: z
        .string()
        .describe(
          "Full new content. Markdown for 'write' docs; raw source for " +
            "'code' files."
        ),
    }),
    outputSchema: mutationResultSchema,
  },
  async (input, { context }) => {
    const resolved = resolveNodeContext(context)
    if ("error" in resolved) return { ok: false, message: resolved.error }
    const blocked = scopeBlocked(context, input.scope)
    if (blocked) return blocked
    const gated = captureGate(context, {
      op: "update",
      scope: input.scope,
      nodeId: input.nodeId,
      summary: `Replace content of ${input.nodeId}`,
      input: { ...input },
    })
    if (gated) return gated
    return applyUpdateNodeContent(resolved, input)
  }
)

interface UpdateNodeContentInput {
  scope: WorkspaceNodeScope
  nodeId: string
  content?: string
}

/** Commit core for `updateNodeContent` — shared by the live tool + replay. */
export async function applyUpdateNodeContent(
  resolved: ResolvedNodeContext,
  input: UpdateNodeContentInput
): Promise<MutationResult> {
  const { teamId, workspaceId, agentId, agentName, actorUid } = resolved

  const scope = input.scope
  const nodeId = input.nodeId
  const content = serializeContent(scope, input.content ?? "")

  try {
    await db.runTransaction(async (transaction) => {
      const nodeRef = db.doc(
        `${nodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
      )
      const nodeSnap = await transaction.get(nodeRef)
      if (!nodeSnap.exists) throw new Error("File not found.")
      const before = nodeSnap.data() ?? {}
      if (before.type !== "file") throw new Error("Only files have content.")
      if (before.isArchived) throw new Error("Cannot edit an archived file.")

      const now = admin.firestore.FieldValue.serverTimestamp()
      transaction.update(nodeRef, {
        content,
        updatedAt: now,
        updatedBy: agentId,
      })

      // Invalidate the live collaborative snapshot so a *fresh* open re-seeds
      // from the new `content` instead of restoring the stale pre-edit CRDT.
      transaction.delete(db.doc(`snapshots/${nodeId}`))

      // Relay the new content to any client currently in this doc's collab
      // room. One elected editor (client-side) applies it through its live
      // editor binding — propagating to other peers via the WebRTC mesh and
      // re-saving the snapshot — so the edit shows up live without a reopen.
      // `seq` increments each edit so clients distinguish a new edit from the
      // baseline they subscribed on. Single overwritten doc → no growth.
      transaction.set(
        db.doc(`signaling/${nodeId}/agentRelay/state`),
        {
          scope,
          content,
          by: agentId,
          byName: agentName,
          seq: admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        },
        { merge: true }
      )

      await logEvent(
        {
          teamId,
          workspaceId,
          actor: { userId: actorUid || undefined, agentId, agentName },
          action: "content.update",
          resource: { type: "content", id: nodeId, parentId: workspaceId },
          changes: { fields: ["content"] },
        },
        { transaction }
      )
    })

    return { ok: true, nodeId, message: "Updated file content." }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

// ─── renameNode ──────────────────────────────────────────────────────────────

export const renameNodeTool = ai.defineTool(
  {
    name: "renameNode",
    description:
      "Rename an existing file or folder. Provide the node's id and the new " +
      "display name.",
    inputSchema: z.object({
      scope: nodeScopeSchema,
      nodeId: z.string().min(1).describe("Id of the node to rename."),
      name: z.string().min(1).describe("New display name."),
    }),
    outputSchema: mutationResultSchema,
  },
  async (input, { context }) => {
    const resolved = resolveNodeContext(context)
    if ("error" in resolved) return { ok: false, message: resolved.error }
    const blocked = scopeBlocked(context, input.scope)
    if (blocked) return blocked
    const gated = captureGate(context, {
      op: "rename",
      scope: input.scope,
      nodeId: input.nodeId,
      summary: `Rename ${input.nodeId} to "${input.name}"`,
      input: { ...input },
    })
    if (gated) return gated
    return applyRenameNode(resolved, input)
  }
)

interface RenameNodeInput {
  scope: WorkspaceNodeScope
  nodeId: string
  name: string
}

/** Commit core for `renameNode` — shared by the live tool + replay. */
export async function applyRenameNode(
  resolved: ResolvedNodeContext,
  input: RenameNodeInput
): Promise<MutationResult> {
  const { teamId, workspaceId, agentId, agentName, actorUid } = resolved

  const named = validateName(input.name)
  if ("error" in named) return { ok: false, message: named.error }
  const { name } = named
  const { scope, nodeId } = input

  try {
    await db.runTransaction(async (transaction) => {
      const nodeRef = db.doc(
        `${nodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
      )
      const nodeSnap = await transaction.get(nodeRef)
      if (!nodeSnap.exists) throw new Error("Node not found.")
      if ((nodeSnap.data() ?? {}).isArchived) {
        throw new Error("Cannot rename an archived node.")
      }

      const now = admin.firestore.FieldValue.serverTimestamp()
      const nameLower = toNameLower(name)
      transaction.update(nodeRef, {
        name,
        nameLower,
        sortKey: nameLower,
        updatedAt: now,
        updatedBy: agentId,
      })

      await logEvent(
        {
          teamId,
          workspaceId,
          actor: { userId: actorUid || undefined, agentId, agentName },
          action: "content.rename",
          resource: { type: "content", id: nodeId, parentId: workspaceId },
          changes: { fields: ["name"], after: { name } },
        },
        { transaction }
      )
    })

    return { ok: true, nodeId, name, message: `Renamed to "${name}".` }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

// ─── moveNode ────────────────────────────────────────────────────────────────

export const moveNodeTool = ai.defineTool(
  {
    name: "moveNode",
    description:
      "Move a file or folder under a different parent folder. Pass the " +
      "node's id and the destination folder id, or 'root' to move it to the " +
      "top level.",
    inputSchema: z.object({
      scope: nodeScopeSchema,
      nodeId: z.string().min(1).describe("Id of the node to move."),
      parentId: z
        .string()
        .optional()
        .describe(
          "Destination folder id, or 'root' / omitted for the top level."
        ),
    }),
    outputSchema: mutationResultSchema,
  },
  async (input, { context }) => {
    const resolved = resolveNodeContext(context)
    if ("error" in resolved) return { ok: false, message: resolved.error }
    const blocked = scopeBlocked(context, input.scope)
    if (blocked) return blocked
    const gated = captureGate(context, {
      op: "move",
      scope: input.scope,
      nodeId: input.nodeId,
      summary: `Move ${input.nodeId} to ${input.parentId ?? "root"}`,
      input: { ...input },
    })
    if (gated) return gated
    return applyMoveNode(resolved, input)
  }
)

interface MoveNodeInput {
  scope: WorkspaceNodeScope
  nodeId: string
  parentId?: string
}

/** Commit core for `moveNode` — shared by the live tool + replay. */
export async function applyMoveNode(
  resolved: ResolvedNodeContext,
  input: MoveNodeInput
): Promise<MutationResult> {
  const { teamId, workspaceId, agentId, agentName, actorUid } = resolved

  const { scope, nodeId } = input
  const parentId =
    typeof input.parentId === "string" && input.parentId.trim()
      ? input.parentId.trim()
      : ROOT_PARENT_ID

  if (nodeId === parentId) {
    return { ok: false, message: "A node cannot be its own parent." }
  }

  try {
    await db.runTransaction(async (transaction) => {
      const nodeRef = db.doc(
        `${nodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
      )
      const nodeSnap = await transaction.get(nodeRef)
      if (!nodeSnap.exists) throw new Error("Node not found.")
      if ((nodeSnap.data() ?? {}).isArchived) {
        throw new Error("Cannot move an archived node.")
      }

      if (parentId !== ROOT_PARENT_ID) {
        const parentRef = db.doc(
          `${nodesCollectionPath(teamId, workspaceId, scope)}/${parentId}`
        )
        const parentSnap = await transaction.get(parentRef)
        if (!parentSnap.exists) throw new Error("Parent folder not found.")
        const parentData = parentSnap.data() ?? {}
        if (parentData.type !== "folder") {
          throw new Error("Parent must be a folder.")
        }
        if (parentData.isArchived) throw new Error("Parent folder is archived.")
      }

      const now = admin.firestore.FieldValue.serverTimestamp()
      transaction.update(nodeRef, {
        parentId,
        updatedAt: now,
        updatedBy: agentId,
      })

      await logEvent(
        {
          teamId,
          workspaceId,
          actor: { userId: actorUid || undefined, agentId, agentName },
          action: "content.move",
          resource: { type: "content", id: nodeId, parentId: workspaceId },
          changes: { fields: ["parentId"], after: { parentId } },
        },
        { transaction }
      )
    })

    return { ok: true, nodeId, message: "Moved node." }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

// ─── archive / unarchive ─────────────────────────────────────────────────────

function defineArchiveTool(archived: boolean) {
  const verb = archived ? "archive" : "unarchive"
  return ai.defineTool(
    {
      name: archived ? "archiveNode" : "unarchiveNode",
      description: archived
        ? "Archive a file or folder (reversible soft-delete). Archived " +
          "nodes disappear from the tree and search but can be restored " +
          "with unarchiveNode. Prefer this over any permanent deletion."
        : "Restore a previously archived file or folder back into the " +
          "workspace tree.",
      inputSchema: z.object({
        scope: nodeScopeSchema,
        nodeId: z.string().min(1).describe(`Id of the node to ${verb}.`),
      }),
      outputSchema: mutationResultSchema,
    },
    async (input, { context }) => {
      const resolved = resolveNodeContext(context)
      if ("error" in resolved) return { ok: false, message: resolved.error }
      const blocked = scopeBlocked(context, input.scope)
      if (blocked) return blocked
      const gated = captureGate(context, {
        op: archived ? "archive" : "unarchive",
        scope: input.scope,
        nodeId: input.nodeId,
        summary: `${archived ? "Archive" : "Restore"} ${input.nodeId}`,
        input: { ...input },
      })
      if (gated) return gated
      return applyArchiveNode(resolved, input, archived)
    }
  )
}

interface ArchiveNodeInput {
  scope: WorkspaceNodeScope
  nodeId: string
}

/** Commit core for archive/unarchive — shared by the live tool + replay. */
export async function applyArchiveNode(
  resolved: ResolvedNodeContext,
  input: ArchiveNodeInput,
  archived: boolean
): Promise<MutationResult> {
  const { teamId, workspaceId, agentId, agentName, actorUid } = resolved
  const { scope, nodeId } = input

  try {
    await db.runTransaction(async (transaction) => {
      const nodeRef = db.doc(
        `${nodesCollectionPath(teamId, workspaceId, scope)}/${nodeId}`
      )
      const nodeSnap = await transaction.get(nodeRef)
      if (!nodeSnap.exists) throw new Error("Node not found.")
      if (Boolean((nodeSnap.data() ?? {}).isArchived) === archived) {
        throw new Error(
          archived ? "Node is already archived." : "Node is not archived."
        )
      }

      const now = admin.firestore.FieldValue.serverTimestamp()
      transaction.update(nodeRef, {
        isArchived: archived,
        updatedAt: now,
        updatedBy: agentId,
      })

      await logEvent(
        {
          teamId,
          workspaceId,
          actor: { userId: actorUid || undefined, agentId, agentName },
          action: archived ? "content.archive" : "content.unarchive",
          resource: { type: "content", id: nodeId, parentId: workspaceId },
          changes: {
            fields: ["isArchived"],
            after: { isArchived: archived },
          },
        },
        { transaction }
      )
    })

    return {
      ok: true,
      nodeId,
      message: archived ? "Archived node." : "Restored node.",
    }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

export const archiveNodeTool = defineArchiveTool(true)
export const unarchiveNodeTool = defineArchiveTool(false)

/**
 * Node-READ tools — registered by the dispatcher when the READ gate holds
 * (`READ_WORKSPACE` membership × team/agent `readContent` toggle).
 * `readNode` returns a file's full content, so it's split from the write
 * tools: an agent can be allowed to read without being granted edit rights.
 */
export const NODE_READ_TOOLS = [readNodeTool]

/**
 * Node-WRITE tools — registered when the WRITE gate holds
 * (`MANAGE_WORKSPACE_CONTENT` membership × team/agent `manageContent`
 * toggle). All mutate workspace content; scope is archive-only (no hard
 * delete) so every agent action is reversible.
 */
export const NODE_WRITE_TOOLS = [
  createNodeTool,
  updateNodeContentTool,
  renameNodeTool,
  moveNodeTool,
  archiveNodeTool,
  unarchiveNodeTool,
]

/**
 * Apply ONE captured change (a `require_review` proposal) on admin approval,
 * replaying the verbatim tool input through the same commit core the live
 * tool uses — so an approved edit is byte-identical to an immediate one. The
 * approving admin's role is the authority (checked by the caller); the edit
 * stays attributed to the workflow's agent via `resolved`.
 */
export async function applyProposedChange(
  resolved: ResolvedNodeContext,
  change: CapturedNodeChange
): Promise<MutationResult> {
  const input = change.input
  switch (change.op) {
    case "create":
      return applyCreateNode(resolved, input as unknown as CreateNodeInput)
    case "update":
      return applyUpdateNodeContent(
        resolved,
        input as unknown as UpdateNodeContentInput
      )
    case "rename":
      return applyRenameNode(resolved, input as unknown as RenameNodeInput)
    case "move":
      return applyMoveNode(resolved, input as unknown as MoveNodeInput)
    case "archive":
      return applyArchiveNode(
        resolved,
        input as unknown as ArchiveNodeInput,
        true
      )
    case "unarchive":
      return applyArchiveNode(
        resolved,
        input as unknown as ArchiveNodeInput,
        false
      )
  }
}

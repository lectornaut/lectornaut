/**
 * Workspace RAG — semantic retrieval over team workspace nodes.
 *
 * Three moving parts:
 *
 *   1. An embedder (`googleAI.embedder('gemini-embedding-001')`) — 768
 *      dimensions, fits comfortably under Firestore's vector index cap.
 *
 *   2. A Firestore retriever (`workspaceNodesRetriever`) — one shared
 *      instance whose collection path is overridden per call via
 *      `options.collection` so the same retriever can serve any
 *      `teams/{teamId}/workspaces/{workspaceId}/{scope}` subcollection.
 *
 *   3. A `searchWorkspaceNodes` tool — exposed to the model in the bot's
 *      tool list. Pulls `teamId` / `workspaceId` from the action context
 *      so the model can never search outside the calling user's
 *      workspace (the model controls only the natural-language query,
 *      not the collection scope).
 *
 * Embeddings are produced server-side via two Firestore triggers
 * (one per scope — `code`, `write`) that fire on document write,
 * recompute the embedding when content changes, and store the vector
 * back on the same doc. A `embedHash` field acts as the loop guard so a
 * trigger that just *wrote* an embedding doesn't re-fire forever.
 *
 * Vector index for the `embedding` field must exist in Firestore before
 * `findNearest()` will accept queries — see `firestore.indexes.json`.
 */

import { createHash } from "node:crypto"

import { defineFirestoreRetriever } from "@genkit-ai/firebase"
import { googleAI } from "@genkit-ai/google-genai"
import { FieldValue } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import { onDocumentWritten } from "firebase-functions/v2/firestore"
import { z } from "genkit/beta"

import { db } from "./firebase.js"
import { ai } from "./genkitClient.js"
import { TRIGGER_OPTS } from "./runtimeConfig.js"
import { geminiApiKey } from "./secrets.js"

// ===========================================================================
// Embedder + Retriever
// ===========================================================================

/**
 * 768-dim Gemini embedder. Chosen over the 3072-dim `gemini-embedding-2`
 * variants because (a) 768 dims is plenty for workspace-scale retrieval
 * (thousands, not millions, of nodes) and (b) smaller vectors mean
 * cheaper Firestore writes/reads and faster nearest-neighbor scans.
 */
const NODE_EMBEDDER = googleAI.embedder("gemini-embedding-001")

/** Dimension count of the embedder above — referenced by the Firestore vector
 *  index in `firestore.indexes.json`. Changing the embedder requires changing
 *  this constant AND rebuilding the index. */
export const NODE_EMBEDDING_DIM = 768

/**
 * Maximum content bytes fed to the embedder. The model accepts ~2k tokens
 * (~8k characters for English). We cap at 30 KB so longer files don't
 * silently fail the embed call; the embedding is then a "head"
 * representation of the file, which is still useful for retrieval since
 * the leading characters typically carry the topic signal.
 */
const MAX_EMBED_INPUT_BYTES = 30_000

/**
 * One shared retriever — the per-call `options.collection` override lets
 * a single registration serve every `teams/{}/workspaces/{}/{scope}`
 * subcollection. The placeholder `collection` here is never queried; if
 * `searchWorkspaceNodesTool` ever forgets to set `options.collection`,
 * the retriever throws (see the Firestore retriever source).
 */
const workspaceNodesRetriever = defineFirestoreRetriever(ai, {
  name: "workspaceNodes",
  firestore: db,
  collection: "_placeholder_overridden_per_call_",
  contentField: "content",
  vectorField: "embedding",
  embedder: NODE_EMBEDDER,
  distanceMeasure: "COSINE",
  distanceResultField: "_distance",
  // Whitelist the fields we pull back as metadata so we don't accidentally
  // expose anything sensitive on the doc (e.g. private collaborator notes).
  metadataFields: ["name", "type", "isArchived", "ownerUid"],
})

// ===========================================================================
// Tool — searchWorkspaceNodes
// ===========================================================================

/**
 * Context shape the tool reads from `chat({ context })`. Keep loose-typed
 * because Genkit erases the context schema at the action boundary; the
 * caller (in `bot.ts`) is responsible for populating these fields.
 */
interface RagToolContext {
  teamId?: string
  workspaceId?: string
}

const SEARCH_SCOPES = ["code", "write", "both"] as const

const searchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Natural-language description of what the user is looking for. Phrase " +
        "as a search query, not a question — e.g. 'sprint planning notes' " +
        "rather than 'what did we decide about sprint planning?'."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("Maximum number of nodes to return across all scopes."),
  scope: z
    .enum(SEARCH_SCOPES)
    .default("both")
    .describe(
      "Which workspace subtree to search: 'code' for code nodes, 'write' " +
        "for write nodes, or 'both' (default)."
    ),
})

const searchResultSchema = z.object({
  nodeId: z.string(),
  scope: z.enum(["code", "write"]),
  name: z.string(),
  type: z.enum(["folder", "file"]),
  snippet: z.string(),
  distance: z.number().optional(),
})

const searchOutputSchema = z.object({
  results: z.array(searchResultSchema),
  /** True when more matches existed than `limit` allowed. */
  truncated: z.boolean(),
})

const SNIPPET_MAX_LENGTH = 500

export const searchWorkspaceNodesTool = ai.defineTool(
  {
    name: "searchWorkspaceNodes",
    description:
      "Semantic search over the user's workspace. Returns the most " +
      "relevant workspace nodes (files / folders) for a natural-language " +
      "query, including a short content snippet for each. Use when the " +
      "user references a node by name or by something inside it but " +
      "hasn't attached it — e.g. 'summarize the auth doc', 'what's in " +
      "the sprint notes?', 'where did we write down the API plan?'. " +
      "Always prefer calling this once with a focused query over " +
      "guessing.\n\n" +
      "Each result carries `scope` + `nodeId`. You can feed those " +
      "directly into other node-aware tools — most notably " +
      "`summarizeNode({ scope, nodeId })` for a structured summary of a " +
      "match. When there's exactly one strong match, chain straight to " +
      "the next tool; when several results look plausible, ask the user " +
      "to clarify via `askQuestion` before committing.",
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
  },
  async (input, { context }) => {
    const ctx = (context ?? {}) as RagToolContext
    const teamId = ctx.teamId
    const workspaceId = ctx.workspaceId
    if (!teamId || !workspaceId) {
      // Action context didn't carry the workspace — defensive fallback so
      // the model gets an empty result rather than a crash on the first
      // call from a code path that hasn't been updated to populate the
      // new context fields yet.
      logger.warn("[searchWorkspaceNodes] missing teamId/workspaceId in context")
      return { results: [], truncated: false }
    }

    const scopes: Array<"code" | "write"> =
      input.scope === "both" ? ["code", "write"] : [input.scope]
    // Pull a few extra per scope so the merged-and-clipped result list
    // can't end up shorter than `input.limit` when one scope has fewer
    // matches than its quota.
    const perScopeFetch = Math.min(10, Math.max(2, input.limit))

    const merged: Array<z.infer<typeof searchResultSchema>> = []

    for (const scope of scopes) {
      try {
        const docs = await ai.retrieve({
          retriever: workspaceNodesRetriever,
          query: input.query,
          options: {
            collection: `teams/${teamId}/workspaces/${workspaceId}/${scope}`,
            limit: perScopeFetch,
          },
        })

        for (const doc of docs) {
          const meta = (doc.metadata ?? {}) as Record<string, unknown>
          // Archived nodes keep their embeddings (so unarchive doesn't
          // require re-embedding) but shouldn't surface in search.
          // Filtered post-retrieve rather than via Firestore prefilter
          // because the latter requires a composite vector index.
          if (meta.isArchived === true) continue
          const nodeId = typeof meta.id === "string" ? meta.id : ""
          if (!nodeId) continue
          const name = typeof meta.name === "string" ? meta.name : nodeId
          const type =
            meta.type === "folder" || meta.type === "file"
              ? (meta.type as "folder" | "file")
              : "file"
          const distance =
            typeof meta._distance === "number" ? meta._distance : undefined

          // Genkit's Document content is an array of Parts; the Firestore
          // retriever produces a single text part from the contentField.
          const rawText =
            typeof doc.content?.[0]?.text === "string"
              ? doc.content[0].text
              : ""
          const snippet =
            rawText.length > SNIPPET_MAX_LENGTH
              ? `${rawText.slice(0, SNIPPET_MAX_LENGTH)}…`
              : rawText

          merged.push({ nodeId, scope, name, type, snippet, distance })
        }
      } catch (err) {
        logger.warn(
          `[searchWorkspaceNodes] retrieve failed for scope=${scope}`,
          { err: String(err) }
        )
      }
    }

    // Sort by distance ascending (closer = more relevant under COSINE),
    // then take the top N. Documents without a distance (e.g. retriever
    // didn't return the field) sort to the end.
    merged.sort((a, b) => {
      const da = a.distance ?? Number.POSITIVE_INFINITY
      const db_ = b.distance ?? Number.POSITIVE_INFINITY
      return da - db_
    })

    const limited = merged.slice(0, input.limit)
    return { results: limited, truncated: merged.length > input.limit }
  }
)

// ===========================================================================
// Embed-on-write triggers
// ===========================================================================
//
// Each node write recomputes the embedding when (a) the doc has text
// content and (b) the content's SHA-256 has changed from the cached
// `embedHash` on the doc. The hash comparison is the loop guard: the
// trigger writes back `{ embedding, embedHash, embedAt }`, which would
// itself fire this trigger — but the hash matches, so we exit early.
//
// Folders and empty files are skipped (no useful text to embed); when a
// file transitions to empty, the prior embedding is cleared so stale
// vectors don't linger and pollute future searches.

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

interface NodeDocPartialShape {
  type?: unknown
  content?: unknown
  isArchived?: unknown
  embedHash?: unknown
}

/**
 * Shared handler for both `code` and `write` scope triggers. Receives
 * the `onDocumentWritten` event's "after" snapshot data + ref and
 * updates the doc in place. Returns early on every branch where
 * embedding would be a no-op.
 */
async function syncNodeEmbedding(params: {
  after?: NodeDocPartialShape
  // The "after" reference for writing the result back.
  afterRef: FirebaseFirestore.DocumentReference | undefined
  // Used purely in log messages.
  scope: "code" | "write"
  teamId: string
  workspaceId: string
  nodeId: string
}): Promise<void> {
  const { after, afterRef, scope, teamId, workspaceId, nodeId } = params

  if (!after || !afterRef) return // delete — nothing to embed

  // Folders: nothing to embed. If a file was just demoted to a folder
  // we'd want to clear the prior embedding; in this app `type` is
  // immutable on create so we don't bother with that branch.
  if (after.type !== "file") return

  const content =
    typeof after.content === "string" ? after.content.trim() : ""

  if (!content) {
    // Empty file — clear prior embedding so old vectors don't shadow
    // the now-empty doc in search results.
    if (after.embedHash) {
      try {
        await afterRef.update({
          embedding: FieldValue.delete(),
          embedHash: FieldValue.delete(),
          embedAt: FieldValue.delete(),
        })
      } catch (err) {
        logger.warn(
          `[embedNode] clear failed scope=${scope} team=${teamId} workspace=${workspaceId} node=${nodeId}`,
          { err: String(err) }
        )
      }
    }
    return
  }

  const truncated =
    content.length > MAX_EMBED_INPUT_BYTES
      ? content.slice(0, MAX_EMBED_INPUT_BYTES)
      : content
  const hash = sha256Hex(truncated)

  // Loop guard: if the embedding on disk was made from this exact text,
  // nothing changed and we'd burn an API call for no reason.
  if (after.embedHash === hash) return

  try {
    const embeddings = await ai.embed({
      embedder: NODE_EMBEDDER,
      content: truncated,
    })
    const vector = embeddings?.[0]?.embedding
    if (!Array.isArray(vector) || vector.length !== NODE_EMBEDDING_DIM) {
      logger.warn(
        `[embedNode] unexpected embedding shape scope=${scope} node=${nodeId} dim=${vector?.length}`
      )
      return
    }

    await afterRef.update({
      embedding: FieldValue.vector(vector),
      embedHash: hash,
      embedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    logger.warn(
      `[embedNode] embed failed scope=${scope} team=${teamId} workspace=${workspaceId} node=${nodeId}`,
      { err: String(err) }
    )
  }
}

/**
 * Trigger factory — produces one onDocumentWritten function per scope.
 * Both functions share `syncNodeEmbedding`; they differ only in the
 * document path pattern (Firestore triggers don't accept OR-paths, so
 * we register two thin wrappers).
 */
function makeEmbedTrigger(scope: "code" | "write") {
  return onDocumentWritten(
    {
      document: `teams/{teamId}/workspaces/{workspaceId}/${scope}/{nodeId}`,
      ...TRIGGER_OPTS,
      secrets: [geminiApiKey],
    },
    async (event) => {
      const teamId = event.params.teamId as string
      const workspaceId = event.params.workspaceId as string
      const nodeId = event.params.nodeId as string
      const after = event.data?.after?.data() as NodeDocPartialShape | undefined
      await syncNodeEmbedding({
        after,
        afterRef: event.data?.after?.ref,
        scope,
        teamId,
        workspaceId,
        nodeId,
      })
    }
  )
}

export const embedCodeNodeOnWrite = makeEmbedTrigger("code")
export const embedWriteNodeOnWrite = makeEmbedTrigger("write")

/**
 * Workspace RAG — semantic retrieval over team workspace nodes.
 *
 * Four moving parts:
 *
 *   1. An embedder (`googleAI.embedder('gemini-embedding-001')`) — 768
 *      dimensions, fits comfortably under Firestore's vector index cap.
 *
 *   2. A Firestore retriever (`workspaceNodesRetriever`) — one shared
 *      instance whose collection path is overridden per call via
 *      `options.collection` so the same retriever can serve any
 *      `teams/{teamId}/workspaces/{workspaceId}/{scope}` subcollection.
 *
 *   3. A `workspaceNodeIndexer` (Genkit `ai.defineIndexer`) — the
 *      write-side companion that takes a `Document` plus a
 *      `{ scope, teamId, workspaceId, nodeId }` option object,
 *      embeds the text, and writes the vector + content-hash back
 *      to the node's doc. Hash-guard lives inside so any caller
 *      (Firestore trigger, bulk reindex, Dev UI invocation) gets
 *      the same loop protection.
 *
 *   4. A `searchWorkspaceNodes` tool — exposed to the model in the
 *      bot's tool list. Pulls `teamId` / `workspaceId` from the
 *      action context so the model can never search outside the
 *      calling user's workspace (the model controls only the
 *      natural-language query, not the collection scope).
 *
 * Embeddings are produced server-side via two Firestore triggers
 * (one per scope — `code`, `write`) that fire on document write and
 * dispatch through the indexer. The trigger handles the upstream
 * concerns (folder skip, provider-toggle, empty-content clearing);
 * the indexer handles the embed + persist + hash-guard. Because this
 * retrieval path is Gemini-embedding-backed, both the chat tool and
 * the embed-on-write triggers respect the team's Google provider
 * toggle.
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
import { Document, z } from "genkit/beta"

import { db } from "./firebase.js"
import { ai, isAiModelProviderConfigured } from "./genkitClient.js"
import { redactText } from "./genkitMiddleware.js"
import { TRIGGER_OPTS } from "./runtimeConfig.js"
import { geminiApiKey } from "./secrets.js"
import { extractPlainText } from "./tiptapText.js"

// ===========================================================================
// Embedder + Retriever
// ===========================================================================

/** Dimension count of the embedder below — referenced by the Firestore vector
 *  index in `firestore.indexes.json`. Changing the embedder requires changing
 *  this constant AND rebuilding the index. Firestore's vector index caps at
 *  2048 dims, so this can never exceed that. */
export const NODE_EMBEDDING_DIM = 768

/**
 * Gemini embedder, pinned to 768-dim output. Chosen over the 3072-dim
 * `gemini-embedding-2` variants because (a) 768 dims is plenty for
 * workspace-scale retrieval (thousands, not millions, of nodes), (b)
 * smaller vectors mean cheaper Firestore writes/reads and faster
 * nearest-neighbor scans, and (c) 3072 exceeds Firestore's vector index
 * cap anyway.
 *
 * `outputDimensionality: NODE_EMBEDDING_DIM` is **required**, not optional
 * — the Google API returns 3072-dim vectors by default for this model
 * (it's a Matryoshka embedding model). Without this option the embed
 * call succeeds but the result is rejected by the dim guard in
 * `syncNodeEmbedding`, leaving nodes un-indexed.
 *
 * The option lives on the embedder *reference* so it applies to both
 * the write-side embed-on-trigger path AND the read-side query-embed
 * path inside `defineFirestoreRetriever` — otherwise the two would
 * produce vectors of different shapes and `findNearest()` would never
 * match.
 */
const NODE_EMBEDDER = googleAI.embedder("gemini-embedding-001", {
  outputDimensionality: NODE_EMBEDDING_DIM,
})

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
// Indexer — write-side companion to `workspaceNodesRetriever`
// ===========================================================================

/**
 * Options passed via `ai.index({ ..., options })`. Zod-validated, so we
 * intentionally avoid stuffing Firestore reference objects through here
 * — the four path components are enough to reconstruct the `DocumentReference`
 * inside the handler.
 */
const WorkspaceNodeIndexerOptionsSchema = z.object({
  scope: z.enum(["code", "write"]),
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  nodeId: z.string().min(1),
})

/**
 * Formal Genkit indexer that wraps the per-node "embed + write back to
 * Firestore" step. Two reasons to define it rather than calling
 * `ai.embed` directly:
 *
 *   1. **Dev UI visibility.** The indexer shows up as a typed,
 *      runnable action with input/option schemas — useful when
 *      debugging "why isn't this node showing up in search?" from
 *      `genkit start`.
 *   2. **Reusable from anywhere.** Any future surface (e.g. a
 *      bulk-reindex callable, a one-off backfill script) calls
 *      `ai.index(...)` instead of reaching into the Firestore-trigger
 *      handler's internals.
 *
 * The Firestore triggers (`embedCodeNodeOnWrite` / `embedWriteNodeOnWrite`)
 * remain thin adapters: they receive the document write, extract the
 * text, and call this indexer. The hash-guard and provider-toggle
 * checks live inside the indexer so they apply uniformly regardless of
 * which caller invokes it.
 *
 * `embedderInfo.label` is metadata for tooling — it doesn't change
 * the model selection (the embedder is hardwired to `NODE_EMBEDDER`
 * so the read- and write-sides produce identically-shaped vectors).
 */
export const workspaceNodeIndexer = ai.defineIndexer(
  {
    name: "workspaceNodes",
    embedderInfo: {
      label: `gemini-embedding-001 (${NODE_EMBEDDING_DIM}-dim)`,
    },
    configSchema: WorkspaceNodeIndexerOptionsSchema,
  },
  async (docs, opts) => {
    // Per-call we expect exactly one document (one node per Firestore
    // trigger fire). Looping keeps the indexer reusable for batch
    // reindexes without changing the contract.
    for (const doc of docs) {
      const afterRef = db.doc(
        `teams/${opts.teamId}/workspaces/${opts.workspaceId}/${opts.scope}/${opts.nodeId}`
      )

      // `Document` parts are tagged with `kind`; the text content is
      // joined into one string. We don't expect media parts here.
      const text = doc.text
      if (!text) {
        logger.debug(
          `[workspaceNodeIndexer] result=skip-empty-doc node=${opts.nodeId}`
        )
        continue
      }

      const truncated =
        text.length > MAX_EMBED_INPUT_BYTES
          ? text.slice(0, MAX_EMBED_INPUT_BYTES)
          : text
      const hash = sha256Hex(truncated)

      // Loop guard: if the stored hash matches the new content's hash,
      // the existing embedding is already correct and we'd burn a paid
      // API call for nothing. Mirrors `syncNodeEmbedding`'s pre-`ai.embed`
      // gate — kept *inside* the indexer so bulk-reindex callers get
      // the same protection.
      const snapshot = await afterRef.get()
      const existingHash = snapshot.get("embedHash")
      if (existingHash === hash) {
        logger.debug(
          `[workspaceNodeIndexer] result=skip-hash-match node=${opts.nodeId}`
        )
        continue
      }

      const embeddings = await ai.embed({
        embedder: NODE_EMBEDDER,
        content: truncated,
      })
      const vector = embeddings?.[0]?.embedding
      if (!Array.isArray(vector) || vector.length !== NODE_EMBEDDING_DIM) {
        logger.warn(
          `[workspaceNodeIndexer] unexpected embedding shape scope=${opts.scope} node=${opts.nodeId} dim=${vector?.length}`
        )
        continue
      }

      await afterRef.update({
        embedding: FieldValue.vector(vector),
        embedHash: hash,
        embedAt: FieldValue.serverTimestamp(),
      })
      logger.debug(
        `[workspaceNodeIndexer] result=success scope=${opts.scope} team=${opts.teamId} workspace=${opts.workspaceId} node=${opts.nodeId} bytes=${truncated.length} dim=${vector.length}`
      )
    }
  }
)

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
  googleProviderEnabled?: boolean
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

/**
 * Cosine-distance cutoff for "this result is plausibly relevant". Anything
 * above is dropped before reaching the model.
 *
 * Why a cutoff at all: `ai.retrieve(...)` always returns the top-K closest
 * vectors regardless of how far apart they are. For a workspace whose
 * content has nothing to do with the query, the closest vectors are
 * still arbitrarily far — and they'd surface to the model as "matches"
 * which it would then dutifully cite. The cutoff is the gate that turns
 * "top-K nearest" into "top-K that are actually near".
 *
 * Why 0.55 specifically: Genkit-firebase reports cosine *distance*
 * (1 - cosineSimilarity), range [0, 2]. Empirically with Gemini-768d
 * embeddings on workspace-scale corpora:
 *   - < 0.35 — strong match (same topic, often same doc)
 *   - 0.35-0.45 — related (same theme, different angle)
 *   - 0.45-0.55 — loose connection (worth surfacing as a maybe)
 *   - > 0.55 — unrelated; almost never useful to the user
 *
 * Tuned conservatively: false negatives (dropping a borderline result)
 * are recoverable — the user can refine their query. False positives
 * (irrelevant results presented as relevant) erode trust in the tool
 * and waste model tokens chasing dead ends.
 *
 * Results with `distance === undefined` are kept on the assumption that
 * the retriever path that doesn't populate distances isn't necessarily
 * returning bad data — it's just less filterable. (Should be rare; the
 * Firestore retriever consistently populates `_distance`.)
 */
const RELEVANCE_DISTANCE_THRESHOLD = 0.55

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

    // Genkit-on-Zod gotcha: `.default()` in the input schema is *not*
    // applied to the runtime input object passed to the handler. The Zod
    // schema is converted to JSON Schema for the LLM (which sees these as
    // optional), and Genkit doesn't re-parse through Zod before invoking
    // us. So when the model omits a defaulted field, we receive
    // `undefined` here — and silently produce nonsense downstream (e.g.
    // a collection path ending in `/undefined`). Default in the handler
    // too, regardless of what the schema says.
    const scope: (typeof SEARCH_SCOPES)[number] = input.scope ?? "both"
    const limit = input.limit ?? 5

    // Diagnostic breadcrumbs are at debug level so they don't show up in
    // routine `firebase functions:log` output. Crank the function's log
    // severity (or filter with `--severity DEBUG`) to surface them when
    // diagnosing a "no results" regression.
    logger.debug(
      `[searchWorkspaceNodes] enter query=${JSON.stringify(input.query)} scope=${scope} limit=${limit} team=${teamId ?? "n/a"} workspace=${workspaceId ?? "n/a"} googleEnabled=${ctx.googleProviderEnabled !== false}`
    )
    if (ctx.googleProviderEnabled === false) {
      logger.debug("[searchWorkspaceNodes] skipped because Google is disabled")
      return { results: [], truncated: false }
    }

    if (!teamId || !workspaceId) {
      // Action context didn't carry the workspace — defensive fallback so
      // the model gets an empty result rather than a crash on the first
      // call from a code path that hasn't been updated to populate the
      // new context fields yet.
      logger.warn(
        "[searchWorkspaceNodes] missing teamId/workspaceId in context"
      )
      return { results: [], truncated: false }
    }

    const scopes: Array<"code" | "write"> =
      scope === "both" ? ["code", "write"] : [scope]
    // Pull a few extra per scope so the merged-and-clipped result list
    // can't end up shorter than `limit` when one scope has fewer
    // matches than its quota.
    const perScopeFetch = Math.min(10, Math.max(2, limit))

    const merged: Array<z.infer<typeof searchResultSchema>> = []

    for (const scope of scopes) {
      const collectionPath = `teams/${teamId}/workspaces/${workspaceId}/${scope}`
      try {
        const docs = await ai.retrieve({
          retriever: workspaceNodesRetriever,
          query: input.query,
          options: {
            collection: collectionPath,
            limit: perScopeFetch,
          },
        })

        logger.debug(
          `[searchWorkspaceNodes] retrieve scope=${scope} path=${collectionPath} got=${docs.length} ids=${docs.map((d) => String((d.metadata as Record<string, unknown> | undefined)?.id ?? "?")).join(",")} archived=${docs.map((d) => String((d.metadata as Record<string, unknown> | undefined)?.isArchived ?? "?")).join(",")}`
        )

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
          const trimmed =
            rawText.length > SNIPPET_MAX_LENGTH
              ? `${rawText.slice(0, SNIPPET_MAX_LENGTH)}…`
              : rawText
          // PII scrub the snippet — workspace content may contain
          // collaborators' emails / phones, and in shared chat
          // sessions the snippet flows back into the LLM context and
          // potentially out to other team members. Same regex pair
          // the user-input middleware uses (`redactText`), kept
          // centralized so any future tightening propagates here too.
          // Applied only to the snippet (free-form prose), never to
          // structured fields like `nodeId` or `distance` where the
          // permissive phone regex would false-positive on
          // digit-heavy identifiers.
          const snippet = redactText(trimmed)

          // Omit `distance` rather than set it to undefined when the
          // retriever doesn't surface a `_distance` metadata field
          // (current default — `_distance` isn't on our `metadataFields`
          // whitelist). Firestore's admin SDK rejects writes that contain
          // any `undefined`, and tool outputs land in the persisted
          // session blob, so emitting `{ distance: undefined }` here
          // crashes the session save downstream.
          merged.push(
            typeof distance === "number"
              ? { nodeId, scope, name, type, snippet, distance }
              : { nodeId, scope, name, type, snippet }
          )
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

    // Relevance cutoff — drop matches the embedding model couldn't get
    // close to the query. `ai.retrieve()` returns top-K nearest
    // regardless of how distant, so without this filter an unrelated
    // workspace still produces "matches" the model dutifully cites.
    // Results without a distance keep the benefit of the doubt
    // (retriever just didn't populate the field) — see the constant's
    // JSDoc for why we tune conservatively.
    const relevant = merged.filter(
      (r) =>
        r.distance === undefined || r.distance <= RELEVANCE_DISTANCE_THRESHOLD
    )
    const droppedForRelevance = merged.length - relevant.length

    const limited = relevant.slice(0, limit)
    logger.debug(
      `[searchWorkspaceNodes] result merged=${merged.length} relevant=${relevant.length} droppedForRelevance=${droppedForRelevance} returned=${limited.length} truncated=${relevant.length > limit} distances=${limited.map((r) => r.distance?.toFixed(4) ?? "n/a").join(",")}`
    )
    // `truncated` is computed against the relevance-filtered set, not
    // the raw merged set — saying "truncated" because we dropped
    // irrelevant matches would mislead the model into chasing them
    // ("there's more, ask again with a narrower query!" — no, there
    // really wasn't more relevant content).
    return { results: limited, truncated: relevant.length > limit }
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
  embedding?: unknown
  embedHash?: unknown
}

const agentConfigDocPath = (teamId: string) => `teams/${teamId}/settings/agent`

async function isGoogleProviderEnabledForTeam(
  teamId: string
): Promise<boolean> {
  try {
    const snap = await db.doc(agentConfigDocPath(teamId)).get()
    const providers = snap.data()?.providers
    if (
      typeof providers !== "object" ||
      providers === null ||
      Array.isArray(providers)
    ) {
      return true
    }

    const google = (providers as Record<string, unknown>).google
    return typeof google === "boolean" ? google : true
  } catch (err) {
    logger.warn(`[embedNode] provider config lookup failed team=${teamId}`, {
      err: String(err),
    })
    return true
  }
}

async function clearNodeEmbedding(params: {
  afterRef: FirebaseFirestore.DocumentReference
  scope: "code" | "write"
  teamId: string
  workspaceId: string
  nodeId: string
  reason: string
}): Promise<void> {
  const { afterRef, scope, teamId, workspaceId, nodeId, reason } = params
  try {
    await afterRef.update({
      embedding: FieldValue.delete(),
      embedHash: FieldValue.delete(),
      embedAt: FieldValue.delete(),
    })
  } catch (err) {
    logger.warn(
      `[embedNode] clear failed scope=${scope} team=${teamId} workspace=${workspaceId} node=${nodeId} reason=${reason}`,
      { err: String(err) }
    )
  }
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

  // Diagnostic breadcrumbs — debug level so quiet by default; raise the
  // function's log severity (or filter `--severity DEBUG`) when chasing
  // an "embeddings not generating" regression.
  logger.debug(
    `[embedNode] enter scope=${scope} team=${teamId} workspace=${workspaceId} node=${nodeId} hasAfter=${Boolean(after)} afterType=${typeof after?.type === "string" ? after.type : "n/a"} contentLen=${typeof after?.content === "string" ? after.content.length : -1}`
  )

  if (!after || !afterRef) {
    logger.debug(`[embedNode] result=skip-delete node=${nodeId}`)
    return
  }

  // Folders: nothing to embed. If a file was just demoted to a folder
  // we'd want to clear the prior embedding; in this app `type` is
  // immutable on create so we don't bother with that branch.
  if (after.type !== "file") {
    logger.debug(
      `[embedNode] result=skip-folder node=${nodeId} type=${String(after.type)}`
    )
    return
  }

  const googleProviderEnabled = await isGoogleProviderEnabledForTeam(teamId)
  if (!googleProviderEnabled) {
    logger.debug(
      `[embedNode] result=skip-google-disabled team=${teamId} node=${nodeId}`
    )
    if (after.embedHash || after.embedding) {
      await clearNodeEmbedding({
        afterRef,
        scope,
        teamId,
        workspaceId,
        nodeId,
        reason: "google-provider-disabled",
      })
    }
    return
  }

  // Workspace `write` nodes persist content as JSON-stringified Tiptap;
  // `code` nodes store raw source. `extractPlainText` flattens Tiptap to
  // the textual leaves and passes non-JSON content through unchanged, so
  // both scopes get sensible embedding input from one call.
  const rawContent =
    typeof after.content === "string" ? after.content.trim() : ""
  const content = extractPlainText(rawContent).trim()

  if (!content) {
    logger.debug(
      `[embedNode] result=skip-empty-content node=${nodeId} rawContentType=${typeof after.content} rawLen=${typeof after.content === "string" ? after.content.length : -1} extractedLen=${content.length}`
    )
    // Empty file — clear prior embedding so old vectors don't shadow
    // the now-empty doc in search results.
    if (after.embedHash || after.embedding) {
      await clearNodeEmbedding({
        afterRef,
        scope,
        teamId,
        workspaceId,
        nodeId,
        reason: "empty-content",
      })
    }
    return
  }

  if (!isAiModelProviderConfigured("google")) {
    logger.warn(
      `[embedNode] skipped because Google provider secret is missing team=${teamId} workspace=${workspaceId} node=${nodeId}`
    )
    return
  }

  // Dispatch through the formal indexer. The hash-guard and the
  // length-cap live inside the indexer handler so any other caller
  // (bulk reindex, dev-UI invocation) gets the same protection. We
  // pass the raw extracted text; the indexer trims and hashes.
  try {
    await ai.index({
      indexer: workspaceNodeIndexer,
      documents: [Document.fromText(content)],
      options: { scope, teamId, workspaceId, nodeId },
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
 *
 * Trigger-level short-circuit:
 *   The trigger writes `{ embedding, embedHash, embedAt }` back to the
 *   node doc after a successful embed — and that writeback ITSELF
 *   refires this trigger. The indexer's hash-guard catches the no-op,
 *   but only after one extra Firestore read (the snapshot fetch inside
 *   the indexer). We can skip that round-trip entirely by checking the
 *   trigger event's `before`/`after` contents up here: if the content
 *   text didn't change, nothing about the embedding needs to change,
 *   regardless of which other field triggered the write (rename,
 *   archive toggle, embedding writeback). Saves one Firestore read per
 *   writeback refire — meaningful for embed-heavy workspaces where
 *   every successful embed triggers an unnecessary follow-up read.
 *
 *   CREATE events (no `before` snapshot) intentionally pass through —
 *   that's the canonical case for new content that genuinely needs
 *   indexing.
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
      const before = event.data?.before?.data() as
        | NodeDocPartialShape
        | undefined
      const after = event.data?.after?.data() as NodeDocPartialShape | undefined

      // No-op skip when the write didn't change content. Covers:
      //   • The embed writeback refire (the trigger writes
      //     embedding/embedHash/embedAt; content is identical).
      //   • Rename, archive/unarchive, any other metadata-only edit.
      //   • Idempotent re-saves of the same doc.
      //
      // CREATE has `before === undefined`; we still dispatch so newly
      // created content gets indexed. DELETE has `after === undefined`;
      // `syncNodeEmbedding` short-circuits on that internally, so we
      // let it through here too.
      if (before && after && before.content === after.content) {
        logger.debug(
          `[embedNode] trigger-skip-content-unchanged scope=${scope} team=${teamId} workspace=${workspaceId} node=${nodeId}`
        )
        return
      }

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

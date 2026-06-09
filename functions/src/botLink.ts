/**
 * Find related workspace nodes — nearest-neighbor lookup using a
 * source node's existing embedding as the query vector.
 *
 * Two surfaces, one core query:
 *
 *   1. `findRelatedNodesTool` — chat tool. Bound to the calling
 *      workspace by `BotActionContext`; the model passes only the
 *      source `{scope, nodeId}` ref.
 *
 *   2. `findRelatedNodes` callable — backs the inspector sidebar's
 *      "Related" tab. Does its own auth + membership check.
 *
 * Critically, this path NEVER calls the embedder. The source node's
 * embedding was computed once by the embed-on-write trigger
 * (`botRag.ts::makeEmbedTrigger`) and stored on the doc; we read it
 * and reuse it as the query vector. So this is cheap (one Firestore
 * read + one vector query per scope) and has no provider dependency
 * — a team that's disabled Google as a chat provider can still get
 * related-node lookups, because the embeddings already exist on disk.
 *
 * Filtering:
 *   - Exclude the source node itself (distance 0 — would otherwise
 *     always be the top hit).
 *   - Exclude archived nodes (they keep embeddings so unarchive
 *     doesn't require re-embedding, but they shouldn't surface in
 *     "Related" any more than they do in search).
 *   - Apply the same `RELEVANCE_DISTANCE_THRESHOLD = 0.55` cosine cutoff
 *     as `searchWorkspaceNodes` so the surface stays consistent — a
 *     workspace whose docs have nothing in common with the source
 *     produces an empty list, not a list of distant "matches".
 *
 * Search scope defaults to BOTH code+write so related docs surface
 * across the workspace; callers can narrow via the `scope` filter
 * (e.g. the inspector pre-bound to a code file might want to surface
 * code-only matches first).
 */

import * as logger from "firebase-functions/logger"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { z } from "genkit/beta"
import { requireVerifiedAuth } from "./auth.js"
import { getMembershipRole } from "./bot.js"
import { NODE_SCOPES } from "./domain.js"
import { db } from "./firebase.js"
import { ai } from "./genkitClient.js"
import { redactText } from "./genkitMiddleware.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import { extractPlainText } from "./tiptapText.js"
import type { WorkspaceNodeScope } from "./types.js"

// ===========================================================================
// Shared types + constants
// ===========================================================================

/**
 * `VectorValue` is declared inside `firebase-admin`'s ambient
 * `FirebaseFirestore` namespace (the same way `Timestamp` and
 * `DocumentReference` are) — not exported as a named module symbol.
 * Aliasing the ambient type lets us write `VectorValue` inline without
 * sprinkling `FirebaseFirestore.VectorValue` through every signature.
 */
type VectorValue = FirebaseFirestore.VectorValue

const SCOPE_VALUES = ["code", "write", "both"] as const
type RelatedSearchScope = (typeof SCOPE_VALUES)[number]

const RELATED_LIMIT_DEFAULT = 5
const RELATED_LIMIT_MAX = 10

/**
 * Coerce a model-supplied related-nodes limit into [1, RELATED_LIMIT_MAX].
 * The chat tool's input schema deliberately omits a hard `.min/.max` bound:
 * Genkit validates tool args before the handler runs, so an over-eager
 * `limit: 50` from the model would abort the whole turn with
 * `INVALID_ARGUMENT` (the same failure mode `searchWorkspaceNodes` hit).
 * Clamp instead — the client `onCall` path stays schema-validated, so this
 * only softens the model-driven tool call. Never throws.
 */
function clampRelatedLimit(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return RELATED_LIMIT_DEFAULT
  }
  return Math.min(RELATED_LIMIT_MAX, Math.max(1, Math.floor(raw)))
}

/**
 * Same cosine cutoff as `searchWorkspaceNodes` — anything farther is
 * "top-K nearest but not actually near", and surfacing those as
 * "Related" erodes trust in the sidebar (the user sees a list of
 * confusing matches and concludes the feature is broken). Result
 * with `distance === undefined` keep the benefit of the doubt (Firestore's
 * `findNearest` reliably populates `_distance` when requested, but if a
 * future code path skips the result field we don't want to drop
 * everything).
 */
const RELEVANCE_DISTANCE_THRESHOLD = 0.55

/** Cap on the snippet returned alongside each related node. */
const SNIPPET_MAX_LENGTH = 240

const relatedResultSchema = z.object({
  scope: z.enum(NODE_SCOPES),
  nodeId: z.string(),
  name: z.string(),
  type: z.enum(["folder", "file"]),
  snippet: z.string(),
  distance: z.number().optional(),
})

type RelatedResult = z.infer<typeof relatedResultSchema>

const relatedOutputSchema = z.object({
  results: z.array(relatedResultSchema),
  truncated: z.boolean(),
})

type RelatedOutput = z.infer<typeof relatedOutputSchema>

// ===========================================================================
// Core query — shared by tool + callable
// ===========================================================================

interface SourceNode {
  name: string
  embedding: VectorValue | null
}

async function loadSourceNode(
  teamId: string,
  workspaceId: string,
  scope: WorkspaceNodeScope,
  nodeId: string
): Promise<SourceNode | null> {
  const snap = await db
    .doc(`teams/${teamId}/workspaces/${workspaceId}/${scope}/${nodeId}`)
    .get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const name = typeof data.name === "string" ? data.name : nodeId
  // `embedding` is stored via `FieldValue.vector(arr)` so it comes back
  // as a `VectorValue`. Anything else (missing, wrong type, or a stale
  // array from before the FieldValue migration) is treated as "no
  // embedding" — the caller short-circuits to an empty result rather
  // than running an unbounded query against a missing field.
  const raw = data.embedding as unknown
  const isVectorValue =
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as { toArray?: unknown }).toArray === "function"
  return {
    name,
    embedding: isVectorValue ? (raw as VectorValue) : null,
  }
}

async function queryOneScope(opts: {
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  queryVector: VectorValue
  /** Doc id we should never return (the source) — only relevant for the
   *  scope that owns the source node. */
  selfNodeId?: string
  /** How many to fetch per scope BEFORE the self / archived filter — we
   *  pull a small surplus so the post-filter result still hits `limit`. */
  perScopeFetch: number
}): Promise<RelatedResult[]> {
  const { teamId, workspaceId, scope, queryVector, selfNodeId, perScopeFetch } =
    opts
  const collection = db.collection(
    `teams/${teamId}/workspaces/${workspaceId}/${scope}`
  )
  try {
    const snap = await collection
      .findNearest({
        vectorField: "embedding",
        queryVector,
        limit: perScopeFetch,
        distanceMeasure: "COSINE",
        distanceResultField: "_distance",
      })
      .get()
    const results: RelatedResult[] = []
    for (const doc of snap.docs) {
      if (selfNodeId && doc.id === selfNodeId) continue
      const data = doc.data() ?? {}
      if (data.isArchived === true) continue
      const name = typeof data.name === "string" ? data.name : doc.id
      const type = data.type === "folder" ? "folder" : "file"
      const rawContent = typeof data.content === "string" ? data.content : ""
      const plain = extractPlainText(rawContent).trim()
      const trimmed =
        plain.length > SNIPPET_MAX_LENGTH
          ? `${plain.slice(0, SNIPPET_MAX_LENGTH)}…`
          : plain
      const snippet = redactText(trimmed)
      const distanceRaw = data._distance
      const distance = typeof distanceRaw === "number" ? distanceRaw : undefined
      results.push(
        distance === undefined
          ? { scope, nodeId: doc.id, name, type, snippet }
          : { scope, nodeId: doc.id, name, type, snippet, distance }
      )
    }
    return results
  } catch (err) {
    // findNearest fails closed: missing vector index, invalid query
    // vector dim, or a transient Firestore error all shouldn't crash
    // the surface — return an empty per-scope result and log.
    logger.warn(
      `[findRelatedNodes] query failed scope=${scope} team=${teamId} workspace=${workspaceId}`,
      { err: String(err) }
    )
    return []
  }
}

interface RunRelatedInput {
  teamId: string
  workspaceId: string
  /** Scope of the SOURCE node (always concrete — only the search scope
   *  can be "both"). */
  sourceScope: WorkspaceNodeScope
  sourceNodeId: string
  /** Where to search: same scope as source, the other scope, or both. */
  searchScope: RelatedSearchScope
  limit: number
}

/**
 * Run the full "find related" pipeline:
 *   1. Load the source node + its embedding.
 *   2. Query nearest-neighbors in each requested scope.
 *   3. Filter self + archived (per-scope), apply the relevance cutoff
 *      across the merged set, and clip to `limit`.
 */
async function runFindRelated(input: RunRelatedInput): Promise<RelatedOutput> {
  const source = await loadSourceNode(
    input.teamId,
    input.workspaceId,
    input.sourceScope,
    input.sourceNodeId
  )
  if (!source) {
    return { results: [], truncated: false }
  }
  if (!source.embedding) {
    // No embedding yet — either the node was just created and the
    // trigger hasn't fired, or its content is empty (the trigger
    // intentionally clears the embedding in that case). Either way
    // there's nothing to compare against; surface an empty result.
    logger.debug(
      `[findRelatedNodes] source has no embedding scope=${input.sourceScope} node=${input.sourceNodeId}`
    )
    return { results: [], truncated: false }
  }

  const scopes: Array<WorkspaceNodeScope> =
    input.searchScope === "both" ? ["code", "write"] : [input.searchScope]
  // Pull a small surplus per scope so self/archived/relevance filtering
  // can't leave us short.
  const perScopeFetch = Math.min(
    RELATED_LIMIT_MAX,
    Math.max(2, input.limit + 2)
  )

  const merged = (
    await Promise.all(
      scopes.map((scope) =>
        queryOneScope({
          teamId: input.teamId,
          workspaceId: input.workspaceId,
          scope,
          queryVector: source.embedding!,
          // Only filter `self` out of the scope that owns the source.
          // A node with the same id existing in the OTHER scope would
          // be a different node entirely — Firestore ids are scoped
          // per-collection.
          selfNodeId:
            scope === input.sourceScope ? input.sourceNodeId : undefined,
          perScopeFetch,
        })
      )
    )
  ).flat()

  merged.sort((a, b) => {
    const da = a.distance ?? Number.POSITIVE_INFINITY
    const db_ = b.distance ?? Number.POSITIVE_INFINITY
    return da - db_
  })

  // Apply the same cosine cutoff as `searchWorkspaceNodes` so the two
  // surfaces feel consistent — a relevance-poor workspace stops
  // surfacing junk on both.
  const relevant = merged.filter(
    (r) =>
      r.distance === undefined || r.distance <= RELEVANCE_DISTANCE_THRESHOLD
  )

  const limited = relevant.slice(0, input.limit)
  return { results: limited, truncated: relevant.length > input.limit }
}

// ===========================================================================
// Tool — chat-driven path
// ===========================================================================

interface RelatedToolContext {
  teamId?: string
  workspaceId?: string
}

const relatedToolInputSchema = z.object({
  scope: z
    .enum(["code", "write"])
    .describe(
      "Scope of the SOURCE node — pick from the `_node ref:_` line of " +
        "the attached-context block, or a prior `searchWorkspaceNodes` " +
        "result's `scope`."
    ),
  nodeId: z
    .string()
    .min(1)
    .describe(
      "Id of the SOURCE node to find related items for. Same source as " +
        "`scope` above — the two fields come from the same ref."
    ),
  searchScope: z
    .enum(SCOPE_VALUES)
    .optional()
    .describe(
      "Where to search for related nodes: 'code', 'write', or 'both' " +
        "(default). The source's own scope is fine as the default for " +
        "most cases; pick 'both' when relations may exist in either kind."
    ),
  limit: z
    .number()
    .optional()
    .describe(
      `Maximum number of related nodes to return. Effective range is ` +
        `1–${RELATED_LIMIT_MAX} (default ${RELATED_LIMIT_DEFAULT}); ` +
        "out-of-range or fractional values are clamped, not rejected."
    ),
})

export const findRelatedNodesTool = ai.defineTool(
  {
    name: "findRelatedNodes",
    description:
      "Find workspace nodes related to a given one — uses the source " +
      "node's stored embedding to surface other nodes the workspace's " +
      "indexer thinks share topic or content. Read-only.\n\n" +
      "Use this when the user asks 'what other docs are related to this?', " +
      "'what links to this file?', or 'show me docs like X'. Prefer it " +
      "over chaining `searchWorkspaceNodes` with hand-crafted queries " +
      "when you already have a concrete source node — the embedding-based " +
      "match is more precise than guessing keywords.\n\n" +
      "Source the `scope` + `nodeId` from the attached-context block's " +
      "`_node ref:_` line, or from a prior `searchWorkspaceNodes` " +
      "result. Returns up to `limit` matches with name + snippet + " +
      "cosine distance (lower = closer).",
    inputSchema: relatedToolInputSchema,
    outputSchema: relatedOutputSchema,
  },
  async (input, { context }) => {
    const ctx = (context ?? {}) as RelatedToolContext
    const teamId = ctx.teamId
    const workspaceId = ctx.workspaceId
    if (!teamId || !workspaceId) {
      logger.warn("[findRelatedNodes] tool invoked without workspace context")
      return { results: [], truncated: false }
    }
    return runFindRelated({
      teamId,
      workspaceId,
      sourceScope: input.scope,
      sourceNodeId: input.nodeId,
      searchScope: input.searchScope ?? "both",
      limit: clampRelatedLimit(input.limit),
    })
  }
)

// ===========================================================================
// Callable — inspector sidebar "Related" tab
// ===========================================================================

interface FindRelatedNodesRequest {
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  nodeId: string
  searchScope?: RelatedSearchScope
  limit?: number
}

const findRelatedNodesRequestSchema = z.object({
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  scope: z.enum(NODE_SCOPES),
  nodeId: z.string().min(1),
  searchScope: z.enum(SCOPE_VALUES).optional(),
  limit: z.number().int().min(1).max(RELATED_LIMIT_MAX).optional(),
})

/**
 * Find related workspace nodes for the inspector sidebar. Membership
 * is required (the source node's data must already be readable by the
 * caller — any team member qualifies). No admin gate: this is
 * read-only and uses already-computed embeddings, so it carries the
 * same cost profile as a normal Firestore query.
 *
 * Returns the same shape as the chat tool so the client can share
 * rendering code between the two surfaces.
 */
export const findRelatedNodes = onCall<FindRelatedNodesRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<RelatedOutput> => {
    const auth = requireVerifiedAuth(request.auth)
    const parsed = findRelatedNodesRequestSchema.safeParse(request.data ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid findRelatedNodes input: ${parsed.error.message}`
      )
    }
    const data = parsed.data

    // Membership gate — non-members shouldn't even learn whether the
    // node exists. `getMembershipRole` throws permission-denied.
    await getMembershipRole(data.teamId, auth.uid)

    return runFindRelated({
      teamId: data.teamId,
      workspaceId: data.workspaceId,
      sourceScope: data.scope,
      sourceNodeId: data.nodeId,
      searchScope: data.searchScope ?? "both",
      limit: data.limit ?? RELATED_LIMIT_DEFAULT,
    })
  }
)

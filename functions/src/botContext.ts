/**
 * Per-turn workspace node context — loading + markdown formatting.
 *
 * The chat composer lets the user attach workspace nodes (files /
 * folders) to a turn; this module loads those nodes (plus their
 * inline-eligible attachments) from Firestore + Storage and renders
 * them as a markdown block that gets appended to the per-turn system
 * prompt.
 *
 * Extracted from `bot.ts` to keep that file focused on chat-flow
 * orchestration. The two layers are intentionally separate:
 *   - `bot.ts` decides WHICH refs to load on a given turn (from
 *     `input.contextNodes`).
 *   - This file is the pure machinery for turning a `{scope, nodeId}`
 *     ref into prompt text — independent of chat session shape,
 *     persistence, or tool-calling.
 *
 * No tools, no Genkit registry side effects — pure Firestore +
 * Storage + string assembly. That keeps the module safely importable
 * from anywhere (Firebase Functions' source analyzer doesn't have to
 * walk through the `ai` instance's circular registry like it does
 * for `genkitClient.ts`).
 */

import { z } from "genkit/beta"

import { admin, db } from "./firebase.js"

// ===========================================================================
// Constants
// ===========================================================================

/**
 * Hard cap on attached refs per turn. Caps both prompt size and
 * Firestore reads — without this a misbehaving client could attach
 * hundreds of files per turn and blow past the model's context window
 * (and our token budget).
 */
export const CONTEXT_NODE_MAX = 10

/**
 * Per-node ceiling. A single attached node never gets more inline
 * bytes than this, even when it's the only ref on the turn (which
 * keeps a 1MB workspace doc from monopolizing the prompt). The
 * per-turn budget below applies on TOP of this — the effective cap
 * for each node is `min(MAX_NODE_CONTENT_BYTES, perNodeBudget)`.
 */
const MAX_NODE_CONTENT_BYTES = 100_000

/**
 * Hard total budget on inline node content across all refs in a single
 * turn. Divided evenly among `refs.length` to compute each ref's cap,
 * then clamped by `MAX_NODE_CONTENT_BYTES` so a small ref count still
 * respects the per-node ceiling.
 *
 * 400KB ≈ 130K tokens at our `TOKEN_BYTES_PER_TOKEN = 3` heuristic,
 * leaving room (out of the middleware's `DEFAULT_MAX_INPUT_TOKENS =
 * 200_000` budget) for the system prompt, agent persona, transfer
 * roster, chat history, and the user's message. The middleware would
 * trip on heavier turns anyway; this budget is the proactive cap that
 * makes those turns less likely in the first place — and the
 * truncation it forces is graceful (head-truncated with a
 * `_(content truncated)_` marker the model sees) rather than the
 * middleware's user-visible `resource-exhausted` error.
 *
 * Worked example:
 *   - 1 ref attached: budget per ref = min(100KB, 400KB) = 100KB.
 *   - 4 refs: budget per ref = min(100KB, 100KB) = 100KB.
 *   - 10 refs: budget per ref = min(100KB, 40KB) = 40KB each.
 *
 * Pre-change behavior (10 refs × 100KB = 1MB) blew past the token
 * budget on heavy turns and surfaced as a `resource-exhausted` error.
 */
const PER_TURN_NODE_CONTENT_BUDGET_BYTES = 400_000

/**
 * Max inline content bytes per attachment. Smaller than the node cap
 * because attachments are typically supplemental — if a single
 * attachment is huge, the user probably attached the wrong thing.
 */
const MAX_ATTACHMENT_INLINE_BYTES = 50_000

const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
]

// ===========================================================================
// Schema + types — shared with bot.ts
// ===========================================================================

export const NodeRefSchema = z.object({
  scope: z.enum(["code", "write"]),
  nodeId: z.string().min(1),
})

export type NodeRef = z.infer<typeof NodeRefSchema>

interface NodeContextAttachment {
  name: string
  mimeType: string | null
  size: number | null
  content?: string
  contentTruncated?: boolean
}

interface NodeContextEntry {
  scope: "code" | "write"
  nodeId: string
  name: string
  type: "folder" | "file"
  content?: string
  contentTruncated?: boolean
  attachments: NodeContextAttachment[]
}

// ===========================================================================
// Helpers
// ===========================================================================

function isTextLikeMime(mime: string | null | undefined): boolean {
  if (!mime) return false
  return TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
}

/**
 * Resolve one attachment subdoc into the in-prompt `NodeContextAttachment`
 * shape, downloading its body when it's small + text-like.
 *
 * Extracted so the per-node fetcher can fan out attachment downloads
 * with `Promise.all` instead of awaiting them one at a time. With
 * several text attachments on a node, that's seconds of saved
 * wall-clock per turn.
 *
 * Storage downloads that fail return metadata only — the model still
 * sees the attachment exists, just without inline content. Mirrors the
 * prior behavior; nothing about the failure surfaces to the user.
 */
async function fetchAttachmentContext(
  attSnap: FirebaseFirestore.QueryDocumentSnapshot
): Promise<NodeContextAttachment> {
  const att = attSnap.data() ?? {}
  const mimeType = typeof att.mimeType === "string" ? att.mimeType : null
  const size = typeof att.size === "number" ? att.size : null
  const storagePath =
    typeof att.storagePath === "string" ? att.storagePath : null
  const displayName =
    typeof att.displayName === "string" && att.displayName
      ? att.displayName
      : "attachment"

  let attContent: string | undefined
  let attTruncated = false
  if (
    storagePath &&
    isTextLikeMime(mimeType) &&
    (size === null || size <= MAX_ATTACHMENT_INLINE_BYTES)
  ) {
    try {
      const [buffer] = await admin
        .storage()
        .bucket()
        .file(storagePath)
        .download()
      const text = buffer.toString("utf8")
      if (text.length > MAX_ATTACHMENT_INLINE_BYTES) {
        attContent = text.slice(0, MAX_ATTACHMENT_INLINE_BYTES)
        attTruncated = true
      } else {
        attContent = text
      }
    } catch {
      // Storage read failed — fall through with metadata only so the
      // model still knows the attachment exists.
    }
  }

  return {
    name: displayName,
    mimeType,
    size,
    ...(attContent !== undefined ? { content: attContent } : {}),
    ...(attTruncated ? { contentTruncated: true } : {}),
  }
}

/**
 * Resolve one `{scope, nodeId}` ref into a self-contained context entry:
 * the node's metadata + content + attachment list (with text-like
 * attachment bodies inlined under `MAX_ATTACHMENT_INLINE_BYTES`).
 *
 * Returns `null` when the node doesn't exist or is archived — callers
 * filter nulls instead of failing the whole turn, so a stale attachment
 * chip in the UI doesn't block the user's send.
 *
 * Parallelism notes:
 *   - The node doc read and the attachments-collection read are kicked
 *     off in parallel (`Promise.all`) — neither depends on the other,
 *     and Firestore handles concurrent reads cheaply.
 *   - Storage downloads for all inline-eligible attachments run in
 *     parallel via `Promise.all(...map(fetchAttachmentContext))`. The
 *     GCS SDK pools HTTP/2 connections so 10 small downloads in
 *     parallel takes about the same wall-clock as 1; doing them
 *     serially (the prior pattern) was an unnecessary tax on every
 *     attachment-bearing turn.
 *
 * If the node doesn't exist, we short-circuit and skip the attachments
 * fetch — the parallel kick-off "wastes" one attachments query in the
 * miss case, but missing nodes are rare and the saved latency on the
 * hit case (the common case) dominates.
 */
async function fetchNodeContext(
  teamId: string,
  workspaceId: string,
  ref: NodeRef,
  perNodeContentCap: number
): Promise<NodeContextEntry | null> {
  // Kick off node doc + attachments queries in parallel. Both reads are
  // independent — the node doc tells us whether the entry exists, and
  // the attachments query is bounded (handful of docs typical). The
  // attachments query against a missing node returns an empty snapshot
  // harmlessly, so racing them costs at worst one no-op read.
  const [nodeSnap, attachmentsSnap] = await Promise.all([
    db
      .doc(
        `teams/${teamId}/workspaces/${workspaceId}/${ref.scope}/${ref.nodeId}`
      )
      .get(),
    db
      .collection(
        `teams/${teamId}/workspaces/${workspaceId}/${ref.scope}/${ref.nodeId}/attachments`
      )
      .get(),
  ])

  if (!nodeSnap.exists) return null
  const data = nodeSnap.data() ?? {}
  if (data.isArchived === true) return null

  const type =
    data.type === "folder" || data.type === "file"
      ? (data.type as "folder" | "file")
      : "file"
  const name = typeof data.name === "string" ? data.name : ref.nodeId

  const rawContent = typeof data.content === "string" ? data.content : ""
  let content: string | undefined
  let contentTruncated = false
  if (rawContent.length > 0) {
    // Cap is the caller's `perNodeContentCap` (already clamped against
    // `MAX_NODE_CONTENT_BYTES` upstream — see `loadAndBuildContextBlock`).
    // We don't re-clamp here so the caller has full authority over the
    // budget; this also means a future caller passing a higher cap
    // wouldn't be silently downgraded. The ceiling is enforced in one
    // place, the call site, where the per-turn refs.length is known.
    if (rawContent.length > perNodeContentCap) {
      content = rawContent.slice(0, perNodeContentCap)
      contentTruncated = true
    } else {
      content = rawContent
    }
  }

  // Attachments — fan out the per-attachment work (metadata extraction
  // + optional Storage download) so all run concurrently. Order is
  // preserved by `Promise.all`, which matters for deterministic prompt
  // assembly downstream (`buildContextPromptBlock` lists attachments
  // in the order they arrive here).
  const attachments = await Promise.all(
    attachmentsSnap.docs.map((attSnap) => fetchAttachmentContext(attSnap))
  )

  return {
    scope: ref.scope,
    nodeId: ref.nodeId,
    name,
    type,
    ...(content !== undefined ? { content } : {}),
    ...(contentTruncated ? { contentTruncated: true } : {}),
    attachments,
  }
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown size"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Pick a code-fence length that the content can't escape. CommonMark
 * requires the closing fence to have at least as many backticks as the
 * opening, so by scanning for the longest backtick run inside `content`
 * and using one more, we guarantee no malicious file can prematurely
 * close the fence and inject text at the system-prompt level.
 *
 * Without this, a node whose body contained ``` would terminate the
 * fence and the model would see whatever followed as bare system-prompt
 * text — a high-trust position the user shouldn't be able to reach
 * through file content.
 */
function pickCodeFence(content: string): string {
  let longestRun = 0
  let currentRun = 0
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 0x60 /* ` */) {
      currentRun += 1
      if (currentRun > longestRun) longestRun = currentRun
    } else {
      currentRun = 0
    }
  }
  return "`".repeat(Math.max(3, longestRun + 1))
}

/**
 * Render a set of node-context entries as a markdown block appended to
 * the per-turn system prompt. Returns "" when no entries — the caller
 * uses the empty string to skip the join and keep the system prompt
 * byte-identical to the no-context path.
 */
function buildContextPromptBlockFromEntries(
  entries: NodeContextEntry[]
): string {
  if (entries.length === 0) return ""

  const lines: string[] = [
    "# Attached workspace context",
    "",
    "The user attached the following workspace items as context for this " +
      "turn. Treat them as ground truth when relevant. Quote sparingly; " +
      "summarize when paraphrasing is clearer.",
    "",
  ]

  for (const entry of entries) {
    const scopeLabel = entry.scope === "code" ? "Code" : "Write"
    lines.push(`## ${scopeLabel} ${entry.type}: ${entry.name}`)
    // Surface scope + nodeId so tools that take a node ref
    // (e.g. `summarizeNode`) can be invoked against an attached node.
    // The model uses these IDs to call the tool; the user just sees the
    // friendly heading above. Kept on a single subtle line so it doesn't
    // crowd the rendered prompt for the model.
    lines.push(`_node ref: scope=\`${entry.scope}\`, id=\`${entry.nodeId}\`_`)
    if (entry.type === "folder") {
      lines.push("_(folder — no inline content)_")
    } else if (entry.content) {
      const fence = pickCodeFence(entry.content)
      lines.push(fence, entry.content, fence)
      if (entry.contentTruncated) lines.push("_(content truncated)_")
    } else {
      lines.push("_(empty file)_")
    }

    if (entry.attachments.length > 0) {
      lines.push("", "### Attachments")
      for (const att of entry.attachments) {
        lines.push(
          `- **${att.name}** — ${att.mimeType ?? "unknown type"}, ${formatBytes(att.size)}`
        )
        if (att.content) {
          // Fence is sized against the raw content so even an attachment
          // body packed with backticks can't close the block prematurely.
          // Indentation here is purely cosmetic (nests under the bullet)
          // and doesn't factor into the fence-escape safety.
          const fence = pickCodeFence(att.content)
          const indented = att.content.replace(/\n/g, "\n  ")
          lines.push(`  ${fence}`, `  ${indented}`, `  ${fence}`)
          if (att.contentTruncated) lines.push("  _(content truncated)_")
        }
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ===========================================================================
// Public surface — one function: refs in, markdown block out.
// ===========================================================================

/**
 * Load every attached node-ref in parallel and render the result as a
 * markdown block appended to the per-turn system prompt. Returns "" for
 * an empty refs list so the caller can use the result with an
 * unconditional `${block}` interpolation and still get a byte-identical
 * prompt to the no-attachment path.
 *
 * Single-function shape (rather than separately exposing `load` and
 * `build`) keeps the `NodeContextEntry` shape internal to this module
 * — callers don't need to know the in-prompt entry type, just "given
 * these refs, give me the markdown".
 *
 * Concurrency notes:
 *   - Per-ref fan-out via `Promise.all` — bounded by `CONTEXT_NODE_MAX
 *     = 10` upstream, so worst-case ten concurrent `fetchNodeContext`
 *     calls. Each internally parallelizes its own Firestore reads +
 *     Storage downloads.
 *   - Saved latency vs. the prior sequential implementation: with 10
 *     attached nodes × ~50ms per node = ~500ms shaved off every
 *     attachment-bearing turn before the model is even contacted.
 *
 * Budget allocator:
 *   - Each ref's content gets `min(MAX_NODE_CONTENT_BYTES,
 *     PER_TURN_NODE_CONTENT_BUDGET_BYTES / refs.length)` inline bytes
 *     before head-truncation. So a single attached doc gets the full
 *     per-node ceiling; many attachments split the budget evenly,
 *     preventing 10 large docs × 100KB from blowing past the prompt
 *     token budget.
 *   - The divider rounds DOWN (Math.floor) to make the budget a hard
 *     ceiling — overshoots would defeat the point. With refs.length
 *     = 0 we short-circuit before doing the division (length === 0
 *     never reaches `fetchNodeContext`).
 *
 * Order is preserved (Promise.all resolves the array in input order),
 * which matters: the prompt block lists entries in attachment-chip
 * order, matching the user's leftmost-to-rightmost chip layout.
 * Missing or archived nodes are silently filtered — a stale chip from
 * a deleted file shouldn't fail the whole turn.
 */
export async function loadAndBuildContextBlock(
  teamId: string,
  workspaceId: string,
  refs: readonly NodeRef[]
): Promise<string> {
  if (refs.length === 0) return ""

  const perNodeContentCap = Math.min(
    MAX_NODE_CONTENT_BYTES,
    Math.floor(PER_TURN_NODE_CONTENT_BUDGET_BYTES / refs.length)
  )

  const entries = await Promise.all(
    refs.map((ref) =>
      fetchNodeContext(teamId, workspaceId, ref, perNodeContentCap)
    )
  )
  const present = entries.filter((e): e is NodeContextEntry => e !== null)
  return buildContextPromptBlockFromEntries(present)
}

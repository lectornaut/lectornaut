/**
 * Node summarization — demonstrates Genkit's structured-output schemas
 * across two surfaces:
 *
 *   1. `summarizeNode` callable — a one-shot RPC the inspector's
 *      "Generate" button calls. Does its own auth + membership checks.
 *
 *   2. `summarizeNodeTool` — a chat tool the bot can invoke during a
 *      conversation. Auth is already established at the chat boundary;
 *      the tool reads `teamId` / `workspaceId` from the action context
 *      (the model can't override scope), and the model passes
 *      `scope` / `nodeId` as input — typically picking from the IDs
 *      surfaced in the per-turn attached-context block.
 *
 * Both routes funnel through `runSummarize`, which:
 *
 *   - Loads the node from Firestore.
 *   - Builds the prompt from the node's name + content.
 *   - Calls `ai.generate({ output: { schema } })` so the model returns a
 *     strictly-shaped JSON object (`{ summary, keyPoints[], suggestedTags[] }`).
 *   - Genkit normalizes the provider-specific structured-output mechanism
 *     (Gemini response schema / Claude tool-use / OpenAI JSON mode) under
 *     the hood, so the call site stays provider-agnostic.
 *
 * The team's `agentConfig.model` chooses which provider does the work
 * regardless of which surface kicked it off.
 */

import { HttpsError, onCall } from "firebase-functions/v2/https"
import { z } from "genkit/beta"
import {
  getMembershipRole,
  loadTeamAgentConfig,
  requireVerifiedAuth,
} from "./bot.js"
import { db } from "./firebase.js"
import { ai, resolveModel } from "./genkitClient.js"
import { GENKIT_OPTS } from "./runtimeConfig.js"
import { anthropicApiKey, geminiApiKey, openaiApiKey } from "./secrets.js"

// ===========================================================================
// Schemas
// ===========================================================================

const SummarizeNodeInputSchema = z.object({
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  scope: z.enum(["code", "write"]),
  nodeId: z.string().min(1),
})

type SummarizeNodeInput = z.infer<typeof SummarizeNodeInputSchema>

/**
 * The structured output the model must produce. Each field's `.describe()`
 * flows into the prompt as guidance — Genkit appends "your response must
 * be a JSON object matching ..." with the field descriptions inlined,
 * so well-described schemas double as the prompt's specification.
 *
 * Length bounds are deliberately loose. Tight constraints (e.g.
 * `max(120)` on a `summary` field) sometimes produce parse-time
 * failures when the model produces a slightly-over-budget reply; the
 * caller then has to retry or downgrade to free text. Looser bounds
 * keep the structured path reliable.
 */
const SummarizeNodeOutputSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "One paragraph (2–4 sentences) capturing the document's purpose " +
        "and the most important ideas. Plain prose, no bullets."
    ),
  keyPoints: z
    .array(z.string().min(1).max(240))
    .max(5)
    .describe(
      "Three to five short bullet points listing the most important facts " +
        "from the document. Each bullet must stand on its own — readable " +
        "without reading the others. If the document is empty or too thin " +
        "to summarize, return an empty array."
    ),
  suggestedTags: z
    .array(z.string().min(1).max(40))
    .max(8)
    .describe(
      "Three to eight topic tags in kebab-case (e.g. 'auth-flow', " +
        "'sprint-planning'). Prefer specific tags over generic ones."
    ),
})

type SummarizeNodeOutput = z.infer<typeof SummarizeNodeOutputSchema>

/**
 * Wire-name of the model included in tool/callable responses for UI
 * transparency. Not part of the structured-output schema itself —
 * tacked on by callers after the model returns.
 */
interface SummarizeNodeResult extends SummarizeNodeOutput {
  model: string
}

// ===========================================================================
// Shared implementation
// ===========================================================================

/**
 * Cap the content fed to the model. Same intent as the embedding
 * truncation in `botRag.ts` — long files get a head-of-document
 * summary, which is better than failing the whole call.
 */
const MAX_CONTENT_INPUT_BYTES = 30_000

interface NodeForSummary {
  name: string
  type: "folder" | "file"
  content: string
  isArchived: boolean
}

async function loadNodeForSummary(
  input: SummarizeNodeInput
): Promise<NodeForSummary | null> {
  const snap = await db
    .doc(
      `teams/${input.teamId}/workspaces/${input.workspaceId}/${input.scope}/${input.nodeId}`
    )
    .get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const type =
    data.type === "folder" || data.type === "file"
      ? (data.type as "folder" | "file")
      : "file"
  const name = typeof data.name === "string" ? data.name : input.nodeId
  const content = typeof data.content === "string" ? data.content : ""
  const isArchived = data.isArchived === true
  return { name, type, content, isArchived }
}

/**
 * Build the user prompt fed to `ai.generate`. The schema-derived JSON
 * format hint is added by Genkit automatically; we just need to give
 * the model the *content* to summarize plus a tiny bit of context
 * (name + type) so a file named "Auth design.md" gets summarized as a
 * design doc rather than as anonymous prose.
 */
function buildSummarizePrompt(node: NodeForSummary): string {
  if (node.type === "folder") {
    return [
      `Summarize the likely purpose of this workspace folder based on its name. `,
      `The folder has no inline content of its own.`,
      ``,
      `Folder name: ${node.name}`,
    ].join("\n")
  }

  if (!node.content.trim()) {
    return [
      `Summarize this workspace file. The file currently has no content — `,
      `infer its likely purpose from the name and return a minimal `,
      `summary plus an empty keyPoints array.`,
      ``,
      `File name: ${node.name}`,
    ].join("\n")
  }

  const trimmed =
    node.content.length > MAX_CONTENT_INPUT_BYTES
      ? `${node.content.slice(0, MAX_CONTENT_INPUT_BYTES)}\n\n[...content truncated...]`
      : node.content

  return [
    `Summarize the following workspace file.`,
    ``,
    `File name: ${node.name}`,
    `Content:`,
    `"""`,
    trimmed,
    `"""`,
  ].join("\n")
}

/**
 * Core summarization. Loads the node, builds the prompt, calls the
 * model with the structured-output schema, returns the parsed payload
 * plus the wire-name of the model used.
 *
 * Throws `HttpsError` for branches the callable's wrapper would surface
 * to the client (`not-found`, `failed-precondition`, `internal`). The
 * tool wrapper catches these and converts them into a friendlier
 * tool-result shape so a missing-node mistake doesn't break the chat
 * turn — the model sees an error message and can apologize / retry.
 */
async function runSummarize(
  input: SummarizeNodeInput
): Promise<SummarizeNodeResult> {
  const node = await loadNodeForSummary(input)
  if (!node) {
    throw new HttpsError("not-found", "Node not found.")
  }
  if (node.isArchived) {
    // Archived nodes are hidden from most callers; refuse to summarize
    // so callers don't accidentally surface stale content.
    throw new HttpsError("failed-precondition", "Node is archived.")
  }

  const agentConfig = await loadTeamAgentConfig(input.teamId)
  const model = resolveModel(agentConfig.model)

  const response = await ai.generate({
    model,
    prompt: buildSummarizePrompt(node),
    // The schema is the structured-output contract — Genkit converts
    // it to the provider's JSON-output mechanism, then parses + Zod-
    // validates the response so `.output` is fully typed.
    output: { schema: SummarizeNodeOutputSchema },
    // Lower temperature for summaries — we want the model to stick
    // closely to the document, not riff on it. Override the team's
    // chat temperature (tuned for conversation) without mutating the
    // saved config.
    config: {
      temperature: Math.min(agentConfig.temperature, 0.3),
      topP: agentConfig.topP,
      maxOutputTokens: agentConfig.maxOutputTokens,
    },
  })

  const output = response.output
  if (!output) {
    // Schema validation failed — model produced something Genkit
    // couldn't reconcile against the Zod shape. Rare but worth
    // surfacing distinctly so the caller can offer a retry.
    throw new HttpsError(
      "internal",
      "Model did not produce a valid structured response. Try again."
    )
  }

  return { ...output, model: agentConfig.model }
}

// ===========================================================================
// Callable — inspector "Generate" button
// ===========================================================================

/**
 * Summarize a workspace node. Authenticated; caller must be a member of
 * the team. Uses the team's configured model — switching to Claude in
 * Settings → Agents also routes summaries through Claude.
 *
 * Returns the parsed structured object directly (no streaming).
 */
export const summarizeNode = onCall<SummarizeNodeInput>(
  {
    ...GENKIT_OPTS,
    secrets: [geminiApiKey, anthropicApiKey, openaiApiKey],
    enforceAppCheck: true,
  },
  async (request): Promise<SummarizeNodeResult> => {
    const auth = requireVerifiedAuth(request.auth)

    const parsed = SummarizeNodeInputSchema.safeParse(request.data ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid summarizeNode input: ${parsed.error.message}`
      )
    }
    const input = parsed.data

    // Team membership gate — non-members shouldn't even learn whether
    // the node exists. `getMembershipRole` throws permission-denied.
    await getMembershipRole(input.teamId, auth.uid)

    return runSummarize(input)
  }
)

// ===========================================================================
// Tool — chat-driven path
// ===========================================================================
//
// The bot calls this tool when the user asks for a structured summary
// during a chat turn (e.g. "summarize this attached doc"). The tool
// reads `teamId` / `workspaceId` from the action context so the model
// can't reach outside the calling workspace; it accepts `scope` and
// `nodeId` as input so the model can pick which attached node to
// summarize. (The chat's per-turn system prompt surfaces those IDs in
// the rendered context block — see `buildContextPromptBlock`.)

/**
 * Context shape the tool reads from `chat({ context })`. Loose-typed
 * because Genkit erases the context schema at the action boundary;
 * `bot.ts` populates these fields when constructing the chat.
 */
interface SummarizeToolContext {
  teamId?: string
  workspaceId?: string
}

const summarizeToolInputSchema = z.object({
  scope: z
    .enum(["code", "write"])
    .describe(
      "Which scope of workspace node to summarize: 'code' for code nodes, " +
        "'write' for write nodes. Match the scope the user attached or is " +
        "currently working in."
    ),
  nodeId: z
    .string()
    .min(1)
    .describe(
      "ID of the workspace node to summarize. When the user has attached a " +
        "node to this turn, pick the node ID surfaced in the attached-context " +
        "block at the top of this conversation."
    ),
})

/**
 * Tool output mirrors the callable's payload so the same Zod shape
 * powers both surfaces. The model-wire-name field gives the chat
 * receipt-style transparency about which provider produced the
 * summary.
 */
const summarizeToolOutputSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  suggestedTags: z.array(z.string()),
  model: z.string(),
  /**
   * Set when the summary couldn't be produced (missing node, archived,
   * model-output validation failure). The chat-side flow turns thrown
   * errors into structured failures here so the model can apologize
   * or retry instead of crashing the turn.
   */
  error: z
    .string()
    .optional()
    .describe(
      "Human-readable failure reason. Only set when summarization couldn't " +
        "complete — empty otherwise."
    ),
})

export const summarizeNodeTool = ai.defineTool(
  {
    name: "summarizeNode",
    description:
      "Generate a structured summary of a workspace node (file or folder). " +
      "Returns a one-paragraph summary, up to 5 key points, and up to 8 " +
      "kebab-case topic tags. Prefer this tool over writing a free-text " +
      "summary when the user asks for a summary, key points, or tags — " +
      "the structured result persists as a tool card in the chat history " +
      "and matches the inspector's 'Generate' button.\n\n" +
      "Source the `scope` + `nodeId` from either:\n" +
      "  (a) the `_node ref:_` line under each entry in the attached-" +
      "context block at the top of the conversation, when the user has " +
      "attached the node directly, OR\n" +
      "  (b) a `searchWorkspaceNodes` result — when the user references " +
      "a node by name or content but hasn't attached it, first call " +
      "`searchWorkspaceNodes` to locate it, then chain into this tool " +
      "with the matching result's `scope` and `nodeId`.",
    inputSchema: summarizeToolInputSchema,
    outputSchema: summarizeToolOutputSchema,
  },
  async (input, { context }) => {
    const ctx = (context ?? {}) as SummarizeToolContext
    const teamId = ctx.teamId
    const workspaceId = ctx.workspaceId
    if (!teamId || !workspaceId) {
      // Defensive — the chat flow always populates these. If a future
      // code path forgets, return a structured error rather than throw
      // so the model can surface it instead of crashing the turn.
      return {
        summary: "",
        keyPoints: [],
        suggestedTags: [],
        model: "",
        error: "Summarize tool was invoked without workspace context.",
      }
    }

    try {
      const result = await runSummarize({
        teamId,
        workspaceId,
        scope: input.scope,
        nodeId: input.nodeId,
      })
      return { ...result, error: undefined }
    } catch (err) {
      // `runSummarize` throws `HttpsError`s with helpful codes; convert
      // them into a populated `error` field so the model gets a clear
      // signal it can act on (apologize, ask the user for a different
      // node, etc.) without the chat turn failing.
      const code = err instanceof HttpsError ? err.code : null
      const message =
        code === "not-found"
          ? "Node not found in this workspace."
          : code === "failed-precondition"
            ? "That node is archived — restore it to summarize."
            : code === "internal"
              ? "The model couldn't produce a valid structured summary. Try again."
              : "Couldn't summarize that node."
      return {
        summary: "",
        keyPoints: [],
        suggestedTags: [],
        model: "",
        error: message,
      }
    }
  }
)

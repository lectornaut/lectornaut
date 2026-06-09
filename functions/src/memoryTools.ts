/**
 * Memory bot tools — `saveMemory` + `recallMemory`.
 *
 * Modeled on `searchWorkspaceNodesTool` (botRag.ts): the model controls only the
 * text/query, never the scope or owner — `teamId` / `workspaceId` / the acting
 * human come from `BotActionContext`. Input schemas stay PERMISSIVE and the
 * handler clamps numerics (gotcha #3: a hard `.min/.max/.enum` the model
 * violates throws `INVALID_ARGUMENT` and aborts the whole turn). Registration is
 * gated behind the team's single `memoryEnabled` toggle in `pickChatTools`.
 */

import * as logger from "firebase-functions/logger"
import { z } from "genkit/beta"
import type { BotActionContext } from "./botBuiltinTools.js"
import { MEMORY_CATEGORIES, type MemoryCategory } from "./domain.js"
import { ai } from "./genkitClient.js"
import { saveMemoryInternal } from "./memory.js"
import { recallMemoriesCore } from "./memoryRag.js"

const RECALL_TOOL_LIMIT_MIN = 1
const RECALL_TOOL_LIMIT_MAX = 10
const RECALL_TOOL_LIMIT_DEFAULT = 5

function clampRecallToolLimit(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return RECALL_TOOL_LIMIT_DEFAULT
  }
  return Math.min(
    RECALL_TOOL_LIMIT_MAX,
    Math.max(RECALL_TOOL_LIMIT_MIN, Math.floor(raw))
  )
}

function coerceCategory(raw: unknown): MemoryCategory | undefined {
  return typeof raw === "string" &&
    (MEMORY_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as MemoryCategory)
    : undefined
}

export const saveMemoryTool = ai.defineTool(
  {
    name: "saveMemory",
    description:
      "Save a durable memory worth remembering for future chats — a fact, " +
      "preference, or piece of context. Use sparingly for genuinely reusable " +
      "information the user states or confirms (e.g. 'my name is X', 'we ship " +
      "on Fridays', 'we're writing a book on databases'), NOT for one-off " +
      "chit-chat. By default a memory is PRIVATE to the user. Set `shared: " +
      "true` ONLY when the user clearly intends the WHOLE team/workspace to " +
      "remember it (e.g. 'remember for the team', 'the team is...', 'our " +
      "workspace...'); personal facts like a name or preference stay private. " +
      "Near-duplicates are merged automatically, so re-saving a known fact is " +
      "safe.",
    inputSchema: z.object({
      content: z
        .string()
        .describe(
          "The thing to remember, as a concise, self-contained statement."
        ),
      summary: z
        .string()
        .optional()
        .describe("Optional short form for list previews and prompts."),
      category: z
        .string()
        .optional()
        .describe(
          "One of: fact, preference, context, reference, conversation. " +
            "Defaults to context if omitted or unrecognized."
        ),
      importance: z
        .number()
        .optional()
        .describe(
          "0–100; higher recalls more eagerly. Defaults to 50. Out-of-range " +
            "or fractional values are clamped, not rejected."
        ),
      tags: z.array(z.string()).optional().describe("Optional short labels."),
      shared: z
        .boolean()
        .optional()
        .describe(
          "Default false (private to the user). Set true ONLY when the user " +
            "clearly wants the whole team/workspace to remember this — shared " +
            "memories are visible to every workspace member."
        ),
    }),
    outputSchema: z.object({
      saved: z.boolean(),
      merged: z.boolean().optional(),
      memoryId: z.string().optional(),
    }),
  },
  async (input, { context }) => {
    const ctx = (context ?? {}) as BotActionContext
    const teamId = ctx.teamId
    const workspaceId = ctx.workspaceId
    const ownerUid = ctx.auth?.uid ?? ""
    // No human owner (e.g. a headless run) → nothing to own the memory.
    if (!teamId || !workspaceId || !ownerUid) {
      logger.debug("[saveMemory] skipped: missing team/workspace/owner")
      return { saved: false }
    }

    const result = await saveMemoryInternal({
      teamId,
      workspaceId,
      ownerUid,
      content: input.content,
      summary: input.summary,
      tags: input.tags,
      category: coerceCategory(input.category),
      importance: input.importance,
      // Privacy-first: private unless the user explicitly wanted team-wide.
      visibility: input.shared === true ? "shared" : "private",
      source: "agent",
      agentId: ctx.activeAgentId,
    })
    if (!result) return { saved: false }
    return { saved: true, merged: result.merged, memoryId: result.memoryId }
  }
)

export const recallMemoryTool = ai.defineTool(
  {
    name: "recallMemory",
    description:
      "Search the user's durable memories for this workspace — facts and " +
      "preferences saved in earlier chats. Use when the user references " +
      "something they told you before, or before answering a question that a " +
      "remembered preference/fact would change. Returns only the user's own " +
      "memories plus the workspace's shared ones (never another member's " +
      "private memory).",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "What to recall, phrased as a search query (e.g. 'release cadence')."
        ),
      limit: z
        .number()
        .optional()
        .describe("Max results; effective range 1–10 (default 5). Clamped."),
    }),
    outputSchema: z.object({
      memories: z.array(
        z.object({
          content: z.string(),
          summary: z.string().optional(),
          category: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
      ),
    }),
  },
  async (input, { context }) => {
    const ctx = (context ?? {}) as BotActionContext
    const teamId = ctx.teamId
    const workspaceId = ctx.workspaceId
    if (!teamId || !workspaceId) return { memories: [] }

    const recalled = await recallMemoriesCore({
      teamId,
      workspaceId,
      // The acting human; "" (headless) recalls only shared memories.
      actingUid: ctx.auth?.uid ?? "",
      query: input.query,
      limit: clampRecallToolLimit(input.limit),
    })
    return {
      memories: recalled.map((m) => ({
        content: m.content,
        summary: m.summary,
        category: m.category,
        tags: m.tags,
      })),
    }
  }
)

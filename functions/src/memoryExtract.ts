/**
 * Post-generation memory extraction (spec §6.2).
 *
 * After an interactive turn resolves, ask the model — in one session-less,
 * tool-less `runStructuredGeneration` — to surface durable memories worth
 * remembering from the exchange. Survivors above a confidence threshold are
 * saved PRIVATE, `source: "agent"`, owned by the acting human, routed through
 * the same near-dup/merge path as the `saveMemory` tool. Fire-and-forget: the
 * caller never awaits this on the response path, and every failure is swallowed.
 *
 * Schema discipline (gotcha #2): the output schema is `.partial()` — a required
 * field the model omits would throw `INVALID_ARGUMENT` → opaque `INTERNAL`. We
 * default/validate every field in the handler instead.
 */

import * as logger from "firebase-functions/logger"
import { z } from "genkit/beta"
import { MEMORY_CATEGORIES, type MemoryCategory } from "./domain.js"
import type { TurnUsage } from "./genkitMiddleware.js"
import { saveMemoryInternal } from "./memory.js"
import { runStructuredGeneration } from "./structuredGeneration.js"

const EXTRACTION_CONFIDENCE_MIN = 0.7
const EXTRACTION_MAX_ITEMS = 5
// Low temperature: extraction should be faithful, not creative.
const EXTRACTION_TEMPERATURE = 0.2
const EXTRACTION_MAX_INPUT_CHARS = 6_000

const extractionItemSchema = z
  .object({
    content: z.string(),
    category: z.string(),
    importance: z.number(),
    tags: z.array(z.string()),
    confidence: z.number(),
  })
  .partial()

const extractionOutputSchema = z
  .object({
    memories: z.array(extractionItemSchema),
  })
  .partial()

const EXTRACTION_SYSTEM =
  "You extract durable, reusable MEMORIES from a single chat exchange — facts, " +
  "preferences, or context about the user/team/workspace that would help in " +
  "FUTURE, unrelated conversations. Extract only genuinely reusable information " +
  "the user stated or confirmed (e.g. 'we deploy on Fridays', 'prefers terse " +
  "answers', 'the API base is X'). Do NOT extract: one-off task details, " +
  "transient context, the assistant's own suggestions, or anything you're " +
  "unsure about. Prefer returning an empty list over a weak guess. For each " +
  "memory set `confidence` in [0,1]; `category` is one of fact, preference, " +
  "context, reference, conversation; `importance` is 0–100. Return at most 5."

function coerceCategory(raw: unknown): MemoryCategory | undefined {
  return typeof raw === "string" &&
    (MEMORY_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as MemoryCategory)
    : undefined
}

const truncate = (text: string): string =>
  text.length > EXTRACTION_MAX_INPUT_CHARS
    ? text.slice(0, EXTRACTION_MAX_INPUT_CHARS)
    : text

/**
 * Extract + persist candidate memories from one user/assistant exchange. Never
 * throws (best-effort). No-ops on an empty user message. The caller gates this
 * on `memoryEnabled` + an acting human; here we just do the work.
 */
export async function extractMemoriesFromTurn(params: {
  teamId: string
  workspaceId: string
  /** The acting human the memories are saved on behalf of. */
  ownerUid: string
  agentId?: string
  /** Model wire-name (the turn's `effectiveModel`). */
  model: string
  userMessage: string
  assistantReply: string
  onUsage?: (usage: TurnUsage) => void
}): Promise<void> {
  const userMessage = params.userMessage.trim()
  const assistantReply = params.assistantReply.trim()
  if (!params.ownerUid || !userMessage) return

  try {
    const output = await runStructuredGeneration({
      model: params.model,
      sampling: { temperature: EXTRACTION_TEMPERATURE },
      temperatureCap: EXTRACTION_TEMPERATURE,
      system: EXTRACTION_SYSTEM,
      prompt:
        `Conversation exchange to mine for durable memories:\n\n` +
        `User: ${truncate(userMessage)}\n\n` +
        `Assistant: ${truncate(assistantReply)}`,
      output: extractionOutputSchema,
      onUsage: params.onUsage,
    })

    const items = output?.memories ?? []
    let saved = 0
    for (const item of items.slice(0, EXTRACTION_MAX_ITEMS)) {
      const content = item.content?.trim()
      if (!content) continue
      const confidence =
        typeof item.confidence === "number" ? item.confidence : 0
      if (confidence < EXTRACTION_CONFIDENCE_MIN) continue

      const result = await saveMemoryInternal({
        teamId: params.teamId,
        workspaceId: params.workspaceId,
        ownerUid: params.ownerUid,
        content,
        category: coerceCategory(item.category),
        importance: item.importance,
        tags: item.tags,
        // Privacy-first: auto-extracted memories are always private + agent-sourced.
        visibility: "private",
        source: "agent",
        agentId: params.agentId,
      })
      if (result) saved++
    }

    logger.debug(
      `[extractMemories] team=${params.teamId} workspace=${params.workspaceId} candidates=${items.length} saved=${saved}`
    )
  } catch (err) {
    logger.warn("[extractMemories] failed", { err: String(err) })
  }
}

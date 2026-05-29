/**
 * Built-in chat tools (and the types they depend on).
 *
 * Four tools live here:
 *
 *   1. `rollDiceTool` — honest random die roll. Its contract IS
 *      randomness, so `Math.random()` here isn't fabrication. Doubles
 *      as the demo tool that exercises the streaming + tool-card UI
 *      end-to-end.
 *
 *   2. `browseInternetTool` — live web search. Its handler runs a
 *      nested Gemini generation with Google Search grounding turned
 *      on, so it works no matter which provider drives the chat
 *      (Claude / GPT / Gemini) — the grounding sub-call is always
 *      Gemini. Returns a synthesized answer plus the source URLs it
 *      grounded on. See its own section for why this is a tool rather
 *      than chat-level grounding.
 *
 *   3. `transferToAgentTool` — cross-agent handoff. Writes the model's
 *      requested target into the shared action context; bot.ts's
 *      post-turn step commits it to the session doc.
 *
 *   4. `askQuestionTool` — Human-in-the-Loop interrupt. Pauses the
 *      chat until the user picks an answer; the application then
 *      resumes via `respondToBotInterrupt`.
 *
 * Extracted from `bot.ts` so that file can focus on chat-flow
 * orchestration. The two types that move with the tools
 * (`BotChatMode`, `BotActionContext`) live here because they're the
 * contract tools depend on — keeping them in this module gives an
 * acyclic import graph: `bot.ts` → `botBuiltinTools.ts`, never the
 * other way.
 *
 * Workspace-aware tools (`searchWorkspaceNodes`, `summarizeNode`)
 * intentionally stay in their own files (`botRag.ts`,
 * `botSummarize.ts`) — they carry retrieval / structured-output
 * machinery that earns a dedicated home.
 */

import { googleAI } from "@genkit-ai/google-genai"
import { HttpsError } from "firebase-functions/v2/https"
import { z } from "genkit/beta"

import { ai, isAiModelProviderConfigured } from "./genkitClient.js"

// ===========================================================================
// Modes + action context — the contract tools share with the chat flow
// ===========================================================================

export const BOT_CHAT_MODES = ["auto", "agent", "manual"] as const
export type BotChatMode = (typeof BOT_CHAT_MODES)[number]

/**
 * Action context shape — what flows into Genkit's `chat({ context })` and
 * shows up as the second argument of every tool handler. Includes:
 *
 *   - `auth`     — verified Firebase identity (already gated at the
 *                  callable boundary; tools use it for uid-scoped reads).
 *   - `mode`     — current chat mode, for capability gating inside tools.
 *   - `teamId` / `workspaceId` — the workspace the chat is bound to. Used
 *                  by workspace-aware tools like `searchWorkspaceNodes`
 *                  to scope retrieval (the model can't override these).
 *
 * Add fields here when introducing context-aware features.
 */
export interface BotActionContext {
  auth?: { uid: string }
  mode: BotChatMode
  teamId: string
  workspaceId: string
  /**
   * Custom-agent ids the model is allowed to transfer the conversation
   * to via `transferToAgent`. Excludes the currently-active agent (and
   * the synthetic `_default`, which is represented by the empty
   * string `""` so the model has a way to ask for the team default
   * persona). Populated by the dispatcher when at least one OTHER
   * active agent exists; absent/empty means "no transfer targets" and
   * `transferToAgent` isn't exposed to the model that turn.
   */
  availableTransferAgentIds?: string[]
  /**
   * Wire-name of the model currently driving the chat. Used by
   * admin-authored `promptTemplate` custom tools whose stored `model`
   * override is null (= "follow the chat's current model"). Populated
   * by the dispatcher with the post-clamp `effectiveModel`, so an
   * admin-disabled provider can't sneak back in via a sub-tool.
   * Absent on legacy code paths that haven't been updated to pass it
   * — handlers fall back to a hardcoded default model in that case.
   */
  effectiveModel?: string
  /**
   * OUTPUT slot — the tool handler writes `.agentId` here when the model
   * decides to hand off. The dispatcher reads it after
   * `streamChatToClient` completes and, if present, persists the new
   * agent id on the session doc with a follow-up write. Multiple
   * transfer calls in one turn: last wins (handler overwrites).
   *
   * Wrapped in a container object (rather than a flat
   * `requestedTransferAgentId` string field) because Genkit's tool
   * runner shallow-clones the context before passing it to handlers
   * (see `basicTool` / `multipartTool` in
   * `@genkit-ai/ai/lib/tool.js`: `context: { ...runOptions.context }`).
   * A primitive top-level mutation would land on the clone and never
   * reach the original `actionContext` the dispatcher inspects —
   * so the transfer would silently no-op. The shallow clone preserves
   * nested object references, so mutating
   * `ctx.transferRequest.agentId` propagates back to the original.
   * The dispatcher must initialize `transferRequest: {}` for the
   * mutation surface to exist.
   *
   * `""` is a deliberate signalling value meaning "transfer back to
   * the team default persona" — distinguishable from `undefined` (no
   * transfer requested) so the dispatcher can clear an existing agent
   * binding instead of leaving it stuck.
   */
  transferRequest?: { agentId?: string }
  /**
   * Whether the node-CRUD tools (`botNodeTools.ts`) may run this turn.
   * Computed by the dispatcher as the INTERSECTION of two membership
   * roles — the active agent's AND the driving user's — both needing
   * `MANAGE_WORKSPACE_CONTENT`. False (or absent) means the write tools
   * weren't even registered; the handlers re-check it as defense in
   * depth so a stray registration can never bypass the gate.
   */
  canManageNodes?: boolean
  /**
   * Whether the node-READ tool (`readNode`) may run this turn — the same
   * agent×user intersection but on the lighter `READ_WORKSPACE` capability
   * (held by guests too). Lets an agent read full file content without the
   * edit rights `canManageNodes` requires. Re-checked in the handler.
   */
  canReadNodes?: boolean
  /**
   * The acting agent's id and display name. Set whenever a custom/built-in
   * agent (added to the team as a member) is driving the turn. Node-CRUD
   * tools record these as the actor on every mutation — `createdBy` /
   * `updatedBy` on the node and `actor.agentId` in the audit log — so an
   * agent edit reads as "by <agent>", on behalf of the chatting user.
   */
  activeAgentId?: string
  activeAgentName?: string
}

// ===========================================================================
// rollDice — demo tool (template for real tools)
// ===========================================================================
//
// The tool's input/output is Zod-validated, which doubles as the schema
// the model sees: tighter constraints (enums, min/max) get baked into the
// model's tool catalog and steer it toward valid calls. The handler runs
// server-side inside the Genkit chat loop — the model receives only the
// `outputSchema` shape, never the implementation.
//
// It's deliberately demo-grade (mirroring the public Genkit example at
// https://examples.genkit.dev/tool-calling). It proves out the streaming +
// UI plumbing end-to-end and serves as the template for real
// workspace-aware tools (e.g. "search this team's nodes", "open node X").
//
// A die roll's whole contract IS randomness, so a `Math.random()`-backed
// implementation is honest by design and needs no demo/disclaimer tag.

export const rollDiceTool = ai.defineTool(
  {
    name: "rollDice",
    description: "Roll a six-sided die. Returns an integer from 1 to 6.",
    inputSchema: z.object({}),
    outputSchema: z.number().int().min(1).max(6),
  },
  async () => Math.floor(Math.random() * 6) + 1
)

// ===========================================================================
// browseInternet — live web search via Gemini's Google Search grounding
// ===========================================================================
//
// Why a tool that makes its OWN model call, instead of flipping
// `googleSearch` on the main chat:
//
//   - `googleSearch` is a Gemini-plugin config key, not a cross-provider
//     Genkit primitive. The team's chat may run on Claude or GPT (see
//     `BOT_AGENT_MODEL_REGISTRY`); those plugins use `.passthrough()`
//     and would silently DROP the key — grounding would look wired up
//     but do nothing. Isolating the call to a pinned Gemini model makes
//     web search work regardless of the team's selected chat model.
//
//   - It must be a discrete, model-elected tool ("search when you don't
//     know / when asked"), not always-on chat grounding. Combining
//     `googleSearch` with the turn's function-calling tool catalog in a
//     single Gemini request is also restricted, so the sub-call keeps
//     them cleanly separated.
//
// Capability axis: registration in `pickChatTools` gates on the team's
// `tools.browseInternet` toggle AND the server having a Gemini key
// (`isAiModelProviderConfigured("google")`) — deliberately NOT the
// team's `providers.google` chat-policy toggle, so a Claude-only team
// can still enable web search. The handler re-checks the key so a
// direct Dev-UI invocation degrades gracefully instead of throwing.

/**
 * Gemini model the grounding sub-call always uses. Pinned (rather than
 * reusing the chat's `effectiveModel`) because:
 *   - the chat model may not be a Gemini model at all, and
 *   - grounding behavior is model-specific, so a known-good,
 *     search-capable, low-cost model keeps results predictable.
 * Must be a `gemini-*` wire-name that supports the `googleSearch` tool
 * (2.x+; the legacy 1.5 `googleSearchRetrieval` form is not used here).
 */
const WEB_SEARCH_MODEL = "gemini-2.5-flash"

/** Hard cap on returned citations — keeps the persisted tool output and
 *  the model's follow-up context bounded even when grounding returns a
 *  long chunk list. */
const MAX_WEB_SOURCES = 8

const browseInternetInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "What to look up, phrased as a focused web search query. Include " +
        "the specifics that matter (names, versions, dates) — e.g. " +
        "'Vue 3.5 defineModel release date' rather than 'tell me about Vue'."
    ),
})

const browseInternetSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
})

const browseInternetOutputSchema = z.object({
  /**
   * `true` when the grounded answer below came back from a live search.
   * `false` when web search couldn't run (no server Gemini key, or the
   * grounding call failed) — in that case `answer` is a plain-language
   * explanation the model should relay, and `sources` is empty.
   */
  ok: z.boolean(),
  /** Synthesized answer when `ok`; an explanation of why not otherwise. */
  answer: z.string(),
  /** Web pages the answer was grounded on. Empty when `ok` is false. */
  sources: z.array(browseInternetSourceSchema),
  /** ISO-8601 timestamp of when the search ran — lets the model say how
   *  fresh the information is. */
  retrievedAt: z.string(),
})

/**
 * Shape we read off the raw Gemini response (`GenerateResponse.custom`,
 * which the Google plugin sets to the provider's `GenerateContentResponse`).
 * Typed loosely + read defensively: grounding metadata is best-effort, so
 * a shape mismatch degrades to "no sources", never a throw.
 */
interface GeminiGroundingShape {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string }
      }>
    }
  }>
}

function extractGroundingSources(
  custom: unknown
): Array<z.infer<typeof browseInternetSourceSchema>> {
  const candidates = (custom as GeminiGroundingShape | undefined)?.candidates
  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  const sources: Array<z.infer<typeof browseInternetSourceSchema>> = []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    const url = chunk.web?.uri
    if (typeof url !== "string" || url.length === 0) continue
    if (seen.has(url)) continue
    seen.add(url)
    // Title can be missing on a chunk; fall back to the URL so the
    // output schema's required `title` is always a non-empty string
    // (and never `undefined`, which would crash the session-doc write).
    const title =
      typeof chunk.web?.title === "string" && chunk.web.title.length > 0
        ? chunk.web.title
        : url
    sources.push({ title, url })
    if (sources.length >= MAX_WEB_SOURCES) break
  }
  return sources
}

export const browseInternetTool = ai.defineTool(
  {
    name: "browseInternet",
    description:
      "Search the live internet for current, factual information via " +
      "Google Search. Call this when answering needs knowledge you don't " +
      "have or can't be sure is current — recent events, present-day " +
      "facts and figures, prices, release notes, library/API docs, " +
      "anything past your training cutoff — OR whenever the user " +
      "explicitly asks you to search the web or look something up online. " +
      "Prefer a single focused query. Returns a synthesized answer plus " +
      "the source URLs it grounded on; cite those sources in your reply " +
      "and tell the user when the information was retrieved. Read-only — " +
      "it fetches information, it never takes actions.",
    inputSchema: browseInternetInputSchema,
    outputSchema: browseInternetOutputSchema,
  },
  async (input) => {
    const retrievedAt = new Date().toISOString()

    // Belt-and-suspenders: `pickChatTools` already gates registration on
    // this, but a Dev-UI / direct invocation bypasses that gate. Return a
    // narratable result instead of throwing so the model can explain the
    // limitation to the user.
    if (!isAiModelProviderConfigured("google")) {
      return {
        ok: false,
        answer:
          "Web search is unavailable: the server has no Gemini API key " +
          "configured, which this tool needs to reach Google Search.",
        sources: [],
        retrievedAt,
      }
    }

    try {
      const response = await ai.generate({
        // `googleAI.model(...)` (not `resolveModel`) so `config` is typed
        // against the Gemini config schema — `googleSearch` only exists
        // there. The pinned model is always Gemini regardless of the
        // chat's provider.
        model: googleAI.model(WEB_SEARCH_MODEL),
        config: {
          // Empty object, NOT `true`. The Google AI plugin forwards this
          // value verbatim as the wire `google_search` tool field (it
          // only coerces `true`→`{}` for `googleSearchRetrieval`/
          // `urlContext`, not for `googleSearch`), and the Gemini API
          // rejects a boolean there — `google_search` must be an object.
          googleSearch: {},
          // Factual task — keep it grounded and bounded.
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
        prompt:
          "You are a web research assistant with live Google Search " +
          "access. Search the web and answer the query below using " +
          "current, factual information. Be concise and specific. If " +
          "the sources conflict or the answer is uncertain, say so " +
          "plainly rather than guessing.\n\nQuery: " +
          input.query,
      })

      const answer = response.text.trim()
      const sources = extractGroundingSources(response.custom)

      if (!answer) {
        return {
          ok: false,
          answer:
            "The web search returned no usable answer for that query. " +
            "Try rephrasing it with more specific terms.",
          sources,
          retrievedAt,
        }
      }

      return { ok: true, answer, sources, retrievedAt }
    } catch (error) {
      // Network / quota / model errors shouldn't crash the chat turn —
      // surface a narratable failure the model can relay.
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        answer: `Web search failed before returning a result (${message}).`,
        sources: [],
        retrievedAt,
      }
    }
  }
)

// ===========================================================================
// transferToAgent — cross-agent handoff (multi-agent network glue)
// ===========================================================================
//
// Lets a custom agent hand the conversation off to another team agent
// (or back to the team default). The transfer takes effect on the
// NEXT user turn — Genkit's native prompt-as-tool pattern would let
// the new agent reply within the same turn, but that requires a fully
// connected prompt graph with cyclic refs the beta SDK doesn't cleanly
// support. Signalling via the shared action context sidesteps the
// cycle: the dispatcher reads `context.transferRequest.agentId`
// after the turn finishes and writes the new id on the session doc.
//
// The handler validates against `context.availableTransferAgentIds`
// so the model can't transfer to an agent that doesn't exist (or to
// itself). Validation errors throw — Genkit surfaces the message to
// the model as a tool error, and it can choose a different target or
// just keep going.
//
// `""` as a `agentId` means "team default persona" — separate from
// `undefined` so the model has a concrete way to ask for the default
// even when it doesn't know any custom agent's id. The dispatcher
// translates this to a `null` activeAgentId on the doc.

export const transferToAgentTool = ai.defineTool(
  {
    name: "transferToAgent",
    description:
      "Hand off the conversation to a different team agent. Call this " +
      "when the user's request is better suited to another agent " +
      "available on the team. Use the agent's id from the list given " +
      "in your system prompt (or the empty string '' to transfer back " +
      "to the team's default assistant). The handoff happens in this " +
      "same turn — the new agent will reply to the user's message " +
      "immediately after this tool call. Do not produce any text " +
      "alongside the call (a transfer preamble would just clutter the " +
      "new agent's reply); just call the tool.",
    inputSchema: z.object({
      agentId: z
        .string()
        .describe(
          "Id of the agent to transfer to, or '' for the team default. " +
            "Must be one of the ids listed in the system prompt."
        ),
      reason: z
        .string()
        .min(1)
        .describe(
          "Short explanation of why this transfer helps — surfaced to " +
            "the user as part of your reply."
        ),
    }),
    outputSchema: z.string(),
  },
  async (input, { context }) => {
    const ctx = context as BotActionContext | undefined
    const allowed = ctx?.availableTransferAgentIds ?? []
    if (!allowed.includes(input.agentId)) {
      // Throw so Genkit surfaces an error part to the model; it can
      // then pick a valid id from the system prompt or abandon the
      // transfer. The list is in the error message so the model has
      // the information it needs to retry without guessing.
      throw new HttpsError(
        "invalid-argument",
        `Unknown transfer target "${input.agentId}". Available ids: ` +
          (allowed.length === 0
            ? "(no other agents available)"
            : allowed
                .map((id) => (id === "" ? "'' (team default)" : `"${id}"`))
                .join(", "))
      )
    }
    if (ctx?.transferRequest) {
      // Last-call-wins: a model that makes two transfer calls in one
      // turn ends up on whichever target the second call named.
      //
      // We mutate the nested container (not a top-level field) because
      // Genkit shallow-clones `context` before invoking the handler.
      // See `BotActionContext.transferRequest` for the full rationale.
      ctx.transferRequest.agentId = input.agentId
    }
    // Returned string flows back to the model as the tool's output;
    // the model typically narrates it ("Transferring you to X
    // because…") so the user sees a smooth handoff in the chat.
    const label =
      input.agentId === "" ? "the team's default assistant" : input.agentId
    return (
      `Handoff requested to ${label}. The user's next message will be ` +
      `handled by them. Briefly explain the transfer in your reply.`
    )
  }
)

// ===========================================================================
// Interrupts — Human-in-the-Loop
// ===========================================================================
//
// `defineInterrupt` is Genkit's HITL primitive: instead of running a
// handler, calling the tool *pauses* the chat and surfaces the request
// back to the application. The user supplies the response via
// `chat.sendStream({ resume: { respond: [askQuestion.respond(part, ans)] } })`,
// at which point the model's generation continues with the answer
// folded into context.
//
// The interrupt tool's `outputSchema` describes what the *user* sends
// back (what the model will see as the tool's "result"), not what a
// handler returns — there is no handler.

/**
 * Mutable set populated by `defineInterruptTool` on each registration.
 * Exported as a `ReadonlySet` so consumers can iterate but can't
 * accidentally mutate it from outside this module.
 *
 * Previously this was hardcoded `new Set<string>(["askQuestion"])` and
 * had to be updated by hand alongside every new `ai.defineInterrupt`
 * call — a footgun: forgetting to update meant the chat loop wouldn't
 * recognize the new interrupt and the client would render it as a
 * spinner forever. The auto-derived set ties registration and lookup
 * together so the two can't drift.
 */
const _interruptToolNames = new Set<string>()
export const INTERRUPT_TOOL_NAMES: ReadonlySet<string> = _interruptToolNames

/**
 * Wrapper around `ai.defineInterrupt` that records the tool's name in
 * `INTERRUPT_TOOL_NAMES` as a side effect of registration. Use this
 * for every new interrupt tool instead of calling `ai.defineInterrupt`
 * directly — the chat loop's pending-interrupt detection
 * (`findPendingInterruptParts` in bot.ts, `INTERRUPT_TOOL_NAMES.has`
 * checks in the streaming + persistence layer) depends on every
 * interrupt name being in the set.
 *
 * Generics are inferred from `spec.inputSchema` and `spec.outputSchema`
 * so the returned interrupt action keeps its full typed
 * `respond(part, value)` signature — a thin wrapper instead of a
 * typing landmine.
 */
function defineInterruptTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  spec: Parameters<typeof ai.defineInterrupt<I, O>>[0]
) {
  _interruptToolNames.add(spec.name)
  return ai.defineInterrupt(spec)
}

const askQuestionInputSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe("The clarifying question to put to the user."),
  choices: z
    .array(z.string().min(1))
    .min(1)
    .describe("Concrete options the user can pick. Two to five short answers."),
  allowOther: z
    .boolean()
    .optional()
    .describe(
      "Whether the user may type a free-form answer instead of picking " +
        "one of `choices`. Prefer `true`: set it `false` only when " +
        "`choices` are genuinely exhaustive (e.g. yes/no, or a closed set " +
        "where no other answer is possible). Whenever the options are just " +
        "the likely answers and the user's real situation might not be " +
        "covered, enable it so they aren't forced into an ill-fitting choice."
    ),
})

const askQuestionOutputSchema = z.object({
  answer: z
    .string()
    .min(1)
    .describe(
      "The user's answer — either one of `choices` or, if `allowOther` " +
        "was true, a free-form string."
    ),
})

export const askQuestionTool = defineInterruptTool({
  name: "askQuestion",
  description:
    "Ask the user a clarifying question with a small set of choices. " +
    "Use this when you need a decision from the user to proceed and " +
    "guessing would be worse than asking. Offer the most likely answers as " +
    "`choices`, and unless those choices are truly exhaustive, set " +
    "`allowOther: true` so the user can give a custom answer when none of " +
    "them fit. The chat pauses until the user responds; you'll see their " +
    "answer as the tool's output and can continue from there.",
  inputSchema: askQuestionInputSchema,
  outputSchema: askQuestionOutputSchema,
})

/**
 * AI config generators — turn a plain-English admin prompt into a
 * ready-to-save agent or custom-tool configuration.
 *
 * Two callables, both structured-output `ai.generate` calls (same shape
 * as `botSummarize.ts`'s `output: { schema }` path):
 *
 *   1. `generateTeamAgentConfig`      — Settings → Agents "Prompt" tab.
 *   2. `generateTeamCustomToolConfig` — Settings → Custom tools "Prompt" tab.
 *
 * Both:
 *   - Require an authenticated owner/admin (same gate as create/update —
 *     non-admins can't save the result, so they shouldn't be able to burn
 *     model tokens generating it).
 *   - Use the team's configured model via `resolveModel` so switching the
 *     provider in Settings also routes generation through it.
 *   - NORMALIZE the model's output server-side before returning: clamp
 *     every string to its domain bound and coerce names into the
 *     `/^[a-z][a-zA-Z0-9_]*$/` identifier shape the create/update schemas
 *     enforce. This guarantees the generated draft is always valid and
 *     directly saveable — the client merges it into the editor draft and
 *     the existing Save path accepts it without a second round-trip.
 *
 * The model never sees team data; it only sees the admin's prompt plus
 * the static instructions below. The output is a *draft* — admins review
 * and tweak it in the "Configure" tab before saving.
 */

import { HttpsError, onCall } from "firebase-functions/v2/https"
import { z } from "genkit/beta"
import { getMembershipRole, requireVerifiedAuth } from "./bot.js"
import { loadTeamAgentConfig } from "./botAgentConfig.js"
import { ai, resolveModel } from "./genkitClient.js"
import { aiMiddlewares } from "./genkitMiddleware.js"
import { GENKIT_OPTS } from "./runtimeConfig.js"
import { anthropicApiKey, geminiApiKey, openaiApiKey } from "./secrets.js"
import type { IMembershipRole } from "./types.js"

// ===========================================================================
// Shared helpers
// ===========================================================================

const ADMIN_ROLES: ReadonlyArray<IMembershipRole> = ["owner", "admin"]

/**
 * Admin gate — mirrors `assertAdminRole` in `teamAgents.ts` /
 * `teamCustomTools.ts`. Inlined (rather than imported) because those
 * helpers are module-private; the policy is identical: only owners and
 * admins can author agents/tools, so only they may generate one.
 */
async function assertAdminRole(teamId: string, uid: string): Promise<void> {
  const role = await getMembershipRole(teamId, uid)
  if (!role || !ADMIN_ROLES.includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only team owners and admins can generate configurations."
    )
  }
}

/** Hard cap on the admin's prompt — keeps token cost predictable. */
const PROMPT_MAX = 4000

function readPrompt(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpsError("invalid-argument", "A prompt string is required.")
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new HttpsError("invalid-argument", "Prompt cannot be empty.")
  }
  return trimmed.slice(0, PROMPT_MAX)
}

function readTeamId(raw: unknown): string {
  if (typeof raw !== "string" || !raw) {
    throw new HttpsError("invalid-argument", "teamId is required.")
  }
  return raw
}

const clampText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : ""

/**
 * Coerce a free-text label into the lowercase camelCase identifier the
 * domain schemas require (`/^[a-z][a-zA-Z0-9_]*$/`). The model is asked
 * to produce valid identifiers, but it occasionally returns
 * "Look up customer" or "3D model" — sanitizing here means the generated
 * draft is always saveable rather than tripping the create-callable's
 * regex on Save.
 */
function toIdentifier(raw: unknown, fallback: string, max: number): string {
  const source = typeof raw === "string" ? raw : ""
  // Split on any non-alphanumeric run, then camelCase the words.
  const words = source
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
  if (words.length === 0 || words[0] === "") return fallback
  const camel =
    words[0].toLowerCase() +
    words
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("")
  // Drop any leading character that isn't a letter (e.g. a leading digit),
  // then strip anything outside the allowed identifier alphabet.
  const cleaned = camel.replace(/^[^a-zA-Z]+/, "").replace(/[^a-zA-Z0-9_]/g, "")
  if (!cleaned || !/^[a-z]/.test(cleaned)) return fallback
  return cleaned.slice(0, max)
}

// ===========================================================================
// Bounds (mirror the canonical create-schema bounds so generated drafts
// validate on Save). Keep in sync with AGENT_BOUNDS / TOOL_BOUNDS in
// teamAgents.ts / teamCustomTools.ts and botAgentBounds on the client.
// ===========================================================================

const AGENT_BOUNDS = {
  name: 40,
  description: 200,
  avatarSeed: 40,
  systemPromptBase: 4000,
  promptSuffix: 2000,
} as const

const TOOL_BOUNDS = {
  name: 40,
  displayName: 60,
  description: 500,
  avatarSeed: 40,
  fieldsMax: 10,
  fieldName: 40,
  fieldDescription: 200,
  httpUrl: 2048,
  httpHeaderName: 80,
  httpHeaderValue: 1000,
  httpHeadersMax: 20,
  httpBody: 8000,
  httpResponseBytesDefault: 16384,
  httpTimeoutMsDefault: 10000,
  constantValue: 8000,
  promptTemplate: 4000,
  workspaceSearchLimitDefault: 5,
  workspaceSearchFilter: 200,
} as const

// ===========================================================================
// Generation config — moderate temperature for a little creativity while
// keeping the structured shape stable. Independent of the team's chat
// temperature (which is tuned for conversation, not config drafting).
// ===========================================================================

const GENERATION_TEMPERATURE = 0.7
const MIN_OUTPUT_TOKENS = 2048

/** Resolve the model + per-call generation config from the team's settings. */
async function resolveGenerationContext(teamId: string) {
  const agentConfig = await loadTeamAgentConfig(teamId)
  return {
    model: resolveModel(agentConfig.model),
    modelWireName: agentConfig.model,
    config: {
      temperature: GENERATION_TEMPERATURE,
      topP: agentConfig.topP,
      maxOutputTokens: Math.max(agentConfig.maxOutputTokens, MIN_OUTPUT_TOKENS),
    },
  }
}

// ===========================================================================
// Agent generation
// ===========================================================================

const generatedAgentZod = z.object({
  name: z
    .string()
    .describe(
      "Short, human-friendly agent name (max 40 chars), e.g. 'Researcher' " +
        "or 'Release Notes Writer'. Title Case, no quotes."
    ),
  description: z
    .string()
    .describe(
      "One sentence (max 200 chars) describing what this agent specializes " +
        "in, so teammates know when to pick it."
    ),
  avatarSeed: z
    .string()
    .describe(
      "A single short word used to seed a generative avatar. Usually the " +
        "agent's name or a closely related word. May be empty."
    ),
  systemPromptBase: z
    .string()
    .describe(
      "The agent's full system prompt (max 4000 chars). Write in the second " +
        "person ('You are ...'). Define the persona, tone, scope, and any " +
        "constraints. Be specific and directly actionable for the model."
    ),
  promptSuffixes: z
    .object({
      auto: z
        .string()
        .describe(
          "Extra guidance appended in 'auto' mode (model decides when to " +
            "use tools). Empty unless mode-specific guidance genuinely helps."
        ),
      agent: z
        .string()
        .describe(
          "Extra guidance for 'agent' mode (autonomous multi-step work). " +
            "Empty unless useful."
        ),
      manual: z
        .string()
        .describe(
          "Extra guidance for 'manual' mode (user drives each step). Empty " +
            "unless useful."
        ),
    })
    .describe("Per-chat-mode suffixes appended after the system prompt."),
  tools: z
    .object({
      getWeather: z.boolean().describe("Current weather lookups."),
      rollDice: z.boolean().describe("Random dice rolls."),
      askQuestion: z
        .boolean()
        .describe("Ask the user a clarifying question mid-turn."),
      searchWorkspaceNodes: z
        .boolean()
        .describe("Search the team's workspace notes and files."),
      summarizeNode: z
        .boolean()
        .describe("Summarize a workspace file or folder."),
    })
    .describe(
      "Which built-in tools this agent should be able to call. Enable only " +
        "the ones relevant to its purpose. For most knowledge-work agents, " +
        "enable searchWorkspaceNodes and summarizeNode; enable getWeather " +
        "or rollDice only when clearly relevant to the described purpose."
    ),
})

const AGENT_SYSTEM_INSTRUCTIONS =
  "You configure custom AI agents for Lectornaut, a team workspace whose " +
  "members chat with an AI assistant. A team admin will describe the agent " +
  "(persona) they want. Produce a single, complete, ready-to-use agent " +
  "configuration that matches the requested intent. Write a strong, " +
  "specific system prompt — this is the most important field. Keep the name " +
  "and description concise. Only enable tools that serve the agent's stated " +
  "purpose. Do not invent capabilities the tools don't provide."

interface GeneratedAgentConfig {
  name: string
  description: string
  avatarSeed: string
  systemPromptBase: string
  promptSuffixes: { auto: string; agent: string; manual: string }
  tools: {
    getWeather: boolean
    rollDice: boolean
    askQuestion: boolean
    searchWorkspaceNodes: boolean
    summarizeNode: boolean
  }
  model: string
}

interface GenerateConfigRequest {
  teamId: string
  prompt: string
}

export const generateTeamAgentConfig = onCall<GenerateConfigRequest>(
  {
    ...GENKIT_OPTS,
    secrets: [geminiApiKey, anthropicApiKey, openaiApiKey],
    enforceAppCheck: true,
  },
  async (request): Promise<GeneratedAgentConfig> => {
    const auth = requireVerifiedAuth(request.auth)
    const teamId = readTeamId(request.data?.teamId)
    const prompt = readPrompt(request.data?.prompt)

    await assertAdminRole(teamId, auth.uid)

    const { model, modelWireName, config } =
      await resolveGenerationContext(teamId)

    const response = await ai.generate({
      model,
      system: AGENT_SYSTEM_INSTRUCTIONS,
      prompt,
      output: { schema: generatedAgentZod },
      config,
      use: aiMiddlewares(),
    })

    const output = response.output
    if (!output) {
      throw new HttpsError(
        "internal",
        "The model didn't return a valid configuration. Try rephrasing your prompt."
      )
    }

    return {
      name: clampText(output.name, AGENT_BOUNDS.name).trim() || "New agent",
      description: clampText(output.description, AGENT_BOUNDS.description),
      avatarSeed: clampText(output.avatarSeed, AGENT_BOUNDS.avatarSeed),
      systemPromptBase:
        clampText(output.systemPromptBase, AGENT_BOUNDS.systemPromptBase) ||
        "You are a focused assistant.",
      promptSuffixes: {
        auto: clampText(output.promptSuffixes?.auto, AGENT_BOUNDS.promptSuffix),
        agent: clampText(
          output.promptSuffixes?.agent,
          AGENT_BOUNDS.promptSuffix
        ),
        manual: clampText(
          output.promptSuffixes?.manual,
          AGENT_BOUNDS.promptSuffix
        ),
      },
      tools: {
        getWeather: output.tools?.getWeather !== false,
        rollDice: output.tools?.rollDice !== false,
        askQuestion: output.tools?.askQuestion !== false,
        searchWorkspaceNodes: output.tools?.searchWorkspaceNodes !== false,
        summarizeNode: output.tools?.summarizeNode !== false,
      },
      model: modelWireName,
    }
  }
)

// ===========================================================================
// Custom-tool generation
// ===========================================================================

const generatedFieldZod = z.object({
  name: z
    .string()
    .describe(
      "Field name as a lowercase camelCase identifier (letters, digits, " +
        "underscores; starts with a lowercase letter), e.g. 'customerId'."
    ),
  type: z
    .enum(["string", "number", "boolean"])
    .describe("The field's primitive type."),
  description: z
    .string()
    .describe("What this field means — shown to the model (max 200 chars)."),
  required: z
    .boolean()
    .describe("Whether the model must always provide this field."),
})

/**
 * Flat action shape the model fills. Deliberately NOT a discriminated
 * union: a flat object with all fields present is far more reliable across
 * Gemini / Claude / OpenAI structured-output backends than a `oneOf`.
 * `normalizeAction` collapses it to the strict `ICustomToolAction` based
 * on `kind`, discarding the irrelevant fields and applying numeric
 * defaults the model never sees.
 */
const generatedActionZod = z.object({
  kind: z
    .enum(["httpWebhook", "constant", "promptTemplate", "workspaceSearch"])
    .describe(
      "How the tool runs. Prefer 'constant', 'promptTemplate', or " +
        "'workspaceSearch'. Choose 'httpWebhook' ONLY when the admin " +
        "explicitly references an external HTTP API endpoint."
    ),
  url: z
    .string()
    .describe("httpWebhook only: the endpoint URL. Empty for other kinds."),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .describe("httpWebhook only: HTTP method. Default POST."),
  headers: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .describe("httpWebhook only: request headers. Empty array if none."),
  bodyTemplate: z
    .string()
    .describe(
      "httpWebhook only: request body. May reference inputs with " +
        "{{fieldName}}. Empty for GET or other kinds."
    ),
  constantValue: z
    .string()
    .describe(
      "constant only: a JSON string the tool always returns, e.g. " +
        '\'{ "status": "ok" }\'. Empty for other kinds.'
    ),
  prompt: z
    .string()
    .describe(
      "promptTemplate only: the sub-prompt to run. Reference inputs with " +
        "{{fieldName}}. Empty for other kinds."
    ),
  scope: z
    .enum(["code", "write", "any"])
    .describe(
      "workspaceSearch only: restrict to 'code' nodes, 'write' nodes, or " +
        "'any'. Use 'any' when unsure."
    ),
  filterHint: z
    .string()
    .describe(
      "workspaceSearch only: a short topic hint baked into the search, e.g. " +
        "'onboarding docs'. Empty for other kinds."
    ),
})

const generatedToolZod = z.object({
  name: z
    .string()
    .describe(
      "Wire name the model calls — lowercase camelCase identifier (letters, " +
        "digits, underscores; starts lowercase), e.g. 'lookupCustomer'."
    ),
  displayName: z
    .string()
    .describe("Human-friendly label shown in lists (max 60 chars)."),
  description: z
    .string()
    .describe(
      "Written FOR THE MODEL (max 500 chars): when to call this tool and " +
        "what it returns. Clear descriptions improve tool selection."
    ),
  avatarSeed: z
    .string()
    .describe("A short word to seed the avatar. Usually the display name."),
  inputFields: z
    .array(generatedFieldZod)
    .describe("Parameters the model passes when calling (up to 10)."),
  outputFields: z
    .array(generatedFieldZod)
    .describe("Documents what the tool returns to the model (up to 10)."),
  action: generatedActionZod.describe("How the tool executes."),
})

const TOOL_SYSTEM_INSTRUCTIONS =
  "You configure custom tools for Lectornaut, a team workspace whose AI " +
  "assistant can call admin-authored tools during chats. A team admin will " +
  "describe the tool they want. Produce a single, complete, ready-to-use " +
  "tool configuration. The model-facing description and the input/output " +
  "field definitions are the most important parts — make them precise. " +
  "Choose the simplest action 'kind' that satisfies the intent: prefer " +
  "'constant' for stubs/canned data, 'promptTemplate' for LLM-derived " +
  "answers, and 'workspaceSearch' for canned searches over the team's " +
  "content. Only choose 'httpWebhook' when the admin clearly references an " +
  "external API. Field names and the tool name must be lowercase camelCase " +
  "identifiers."

type NormalizedAction =
  | {
      kind: "httpWebhook"
      url: string
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
      headers: { name: string; value: string }[]
      bodyTemplate: string
      maxResponseBytes: number
      timeoutMs: number
    }
  | { kind: "constant"; value: string }
  | { kind: "promptTemplate"; prompt: string; model: string | null }
  | {
      kind: "workspaceSearch"
      scope: "code" | "write" | null
      defaultLimit: number
      filterHint: string
    }

interface NormalizedField {
  name: string
  type: "string" | "number" | "boolean"
  description: string
  required: boolean
}

interface GeneratedToolConfig {
  name: string
  displayName: string
  description: string
  avatarSeed: string
  inputSchema: { fields: NormalizedField[] }
  outputSchema: { fields: NormalizedField[] }
  action: NormalizedAction
  model: string
}

type RawAction = z.infer<typeof generatedActionZod>
type RawField = z.infer<typeof generatedFieldZod>

function normalizeFields(raw: RawField[] | undefined): NormalizedField[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, TOOL_BOUNDS.fieldsMax).map((field, index) => ({
    name: toIdentifier(field?.name, `field${index + 1}`, TOOL_BOUNDS.fieldName),
    type:
      field?.type === "number" || field?.type === "boolean"
        ? field.type
        : "string",
    description: clampText(field?.description, TOOL_BOUNDS.fieldDescription),
    required: field?.required === true,
  }))
}

function normalizeAction(raw: RawAction | undefined): NormalizedAction {
  const kind = raw?.kind
  switch (kind) {
    case "httpWebhook":
      return {
        kind: "httpWebhook",
        url: clampText(raw?.url, TOOL_BOUNDS.httpUrl),
        method:
          raw?.method === "GET" ||
          raw?.method === "PUT" ||
          raw?.method === "PATCH" ||
          raw?.method === "DELETE"
            ? raw.method
            : "POST",
        headers: Array.isArray(raw?.headers)
          ? raw.headers
              .slice(0, TOOL_BOUNDS.httpHeadersMax)
              .map((h) => ({
                name: clampText(h?.name, TOOL_BOUNDS.httpHeaderName),
                value: clampText(h?.value, TOOL_BOUNDS.httpHeaderValue),
              }))
              .filter((h) => h.name.length > 0)
          : [],
        bodyTemplate: clampText(raw?.bodyTemplate, TOOL_BOUNDS.httpBody),
        maxResponseBytes: TOOL_BOUNDS.httpResponseBytesDefault,
        timeoutMs: TOOL_BOUNDS.httpTimeoutMsDefault,
      }
    case "promptTemplate": {
      const prompt = clampText(raw?.prompt, TOOL_BOUNDS.promptTemplate)
      return {
        kind: "promptTemplate",
        // `prompt` is required (min 1) by the create schema; fall back to a
        // generic instruction so the generated draft stays saveable.
        prompt: prompt || "Respond to the request using the provided inputs.",
        model: null,
      }
    }
    case "workspaceSearch":
      return {
        kind: "workspaceSearch",
        scope:
          raw?.scope === "code" || raw?.scope === "write" ? raw.scope : null,
        defaultLimit: TOOL_BOUNDS.workspaceSearchLimitDefault,
        filterHint: clampText(
          raw?.filterHint,
          TOOL_BOUNDS.workspaceSearchFilter
        ),
      }
    case "constant":
    default: {
      const value = clampText(raw?.constantValue, TOOL_BOUNDS.constantValue)
      return { kind: "constant", value: value || '{ "ok": true }' }
    }
  }
}

export const generateTeamCustomToolConfig = onCall<GenerateConfigRequest>(
  {
    ...GENKIT_OPTS,
    secrets: [geminiApiKey, anthropicApiKey, openaiApiKey],
    enforceAppCheck: true,
  },
  async (request): Promise<GeneratedToolConfig> => {
    const auth = requireVerifiedAuth(request.auth)
    const teamId = readTeamId(request.data?.teamId)
    const prompt = readPrompt(request.data?.prompt)

    await assertAdminRole(teamId, auth.uid)

    const { model, modelWireName, config } =
      await resolveGenerationContext(teamId)

    const response = await ai.generate({
      model,
      system: TOOL_SYSTEM_INSTRUCTIONS,
      prompt,
      output: { schema: generatedToolZod },
      config,
      use: aiMiddlewares(),
    })

    const output = response.output
    if (!output) {
      throw new HttpsError(
        "internal",
        "The model didn't return a valid configuration. Try rephrasing your prompt."
      )
    }

    const name = toIdentifier(output.name, "customTool", TOOL_BOUNDS.name)
    return {
      name,
      displayName:
        clampText(output.displayName, TOOL_BOUNDS.displayName) || name,
      description:
        clampText(output.description, TOOL_BOUNDS.description) ||
        "Describe when the model should call this tool.",
      avatarSeed: clampText(output.avatarSeed, TOOL_BOUNDS.avatarSeed),
      inputSchema: { fields: normalizeFields(output.inputFields) },
      outputSchema: { fields: normalizeFields(output.outputFields) },
      action: normalizeAction(output.action),
      model: modelWireName,
    }
  }
)

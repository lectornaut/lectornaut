/**
 * Team agent configuration — types, defaults, normalization, callables.
 *
 * Each team has one agent config doc at
 *   teams/{teamId}/settings/agent
 *
 * All workspaces in the team share that config — the bot is a team-level
 * concern, not a per-workspace one. The doc is read on every chat turn
 * (one extra Firestore read per send — negligible against model latency)
 * and used to drive:
 *   - provider availability (Google / Anthropic / OpenAI)
 *   - the model passed to `session.chat({ model })`
 *   - the system prompt (base + per-mode suffix)
 *   - generation knobs (temperature, topP, topK, maxOutputTokens)
 *   - tool exposure (each side-effecting tool can be flipped off)
 *   - title/preview truncation lengths used by the SessionStore on save
 *
 * Missing or partially-set docs fall back to `DEFAULT_BOT_AGENT_CONFIG`
 * field-by-field, so teams without a config doc keep working without a
 * migration. Only owners + admins can write the doc; every team member
 * can read it.
 *
 * Extracted from `bot.ts` because the config types + normalization +
 * CRUD callables are a self-contained concern (~700 lines) that the
 * chat flow only uses through `loadTeamAgentConfig` and a handful of
 * type imports. Keeping it separate makes bot.ts about chat
 * orchestration, not config plumbing.
 */

import { FieldValue } from "firebase-admin/firestore"
import { HttpsError, onCall } from "firebase-functions/v2/https"
import { z } from "genkit/beta"
import { requireVerifiedAuth } from "./auth.js"
import { getMembershipRole } from "./bot.js"
import { BOT_CHAT_MODES, type BotChatMode } from "./botBuiltinTools.js"
import { AI_PROVIDERS, BOT_AGENT_MODELS, type BotAgentModel } from "./domain.js"
import { db } from "./firebase.js"
import { assertAiModelProviderConfigured } from "./genkitClient.js"
import { isAdminRole } from "./permissions.js"
import { CALLABLE_OPTS } from "./runtimeConfig.js"
import { aiProviderSecrets } from "./secrets.js"

// ===========================================================================
// Title / preview truncation defaults
// ===========================================================================
//
// These live here because they're the canonical "default truncation"
// values used by `DEFAULT_BOT_AGENT_CONFIG`. The SessionStore in bot.ts
// imports them back when its options-object defaults need to fall back
// to the same numbers — a tiny circular import that resolves cleanly
// because the access is deferred (class field initializer, not module
// top-level).

export const TITLE_MAX_LENGTH = 80
export const PREVIEW_MAX_LENGTH = 200

// ===========================================================================
// Mode config (per-chat-mode behavior)
// ===========================================================================

interface BotChatModeConfig {
  /** Appended to SYSTEM_PROMPT_BASE — steers the model's behavior. */
  promptSuffix: string
}

/**
 * Per-mode default prompt suffixes. These are also the defaults that
 * `DEFAULT_BOT_AGENT_CONFIG.promptSuffixes` falls back to, so teams
 * inherit reasonable copy out of the box. Modes differ only in prompt
 * style — every tool is available in every mode (tool access is no
 * longer mode-gated; see `pickChatTools`).
 */
export const MODE_CONFIG: Record<BotChatMode, BotChatModeConfig> = {
  auto: {
    promptSuffix:
      "Default mode: answer concisely. Call a tool when it directly " +
      "advances the user's request, otherwise just reply with text. If " +
      "the request is ambiguous, prefer asking the user a clarifying " +
      "question via `askQuestion` over guessing. If the user asks for " +
      "something you don't have a tool for but a teammate agent listed " +
      "above does (e.g., creating or editing a document), call " +
      "`transferToAgent` — never tell the user to do it themselves or " +
      "copy-paste from chat when a teammate can do the job.",
  },
  agent: {
    promptSuffix:
      "Agent mode: be proactive. Prefer calling tools to gather concrete " +
      "data over guessing, and chain multiple tool calls when a question " +
      "needs them. Briefly narrate what you're doing and why. When you " +
      "need a decision from the user before continuing, ask via " +
      "`askQuestion` — don't pick on their behalf. Treat " +
      "`transferToAgent` as part of your toolkit: when the user asks " +
      "for an action a listed teammate can perform and you cannot, hand " +
      "off proactively rather than declining or asking the user to do " +
      "it themselves.",
  },
  manual: {
    promptSuffix:
      "Manual mode: stay conversational and let the user lead. Prefer " +
      "explaining, suggesting, and discussing; reach for a tool only when " +
      "the user explicitly asks rather than acting on your own initiative. " +
      "Ask clarifying questions via `askQuestion` whenever it would help " +
      "the discussion.",
  },
}

// ===========================================================================
// Provider + model registry
// ===========================================================================

const BOT_MODEL_PROVIDERS = AI_PROVIDERS

export type BotModelProvider = (typeof BOT_MODEL_PROVIDERS)[number]

/**
 * Single source of truth for every model the chat may dispatch to —
 * each entry pairs the wire-name with the provider that handles it,
 * removing the prior split between a names array and a separate
 * `{name → provider}` record that had to be kept in sync by hand.
 *
 * Picked manually so a typo in the settings UI can't route a chat to
 * a non-existent or private model; the Zod enum on the update path
 * enforces the same set.
 *
 * Prefix conventions are also load-bearing — `resolveModel(name)` in
 * `genkitClient.ts` dispatches by prefix (`gemini-*`, `claude-*`,
 * `gpt-*`, `grok-*`, `deepseek-*`). Adding a model here that doesn't
 * match one of those prefixes will throw at chat time. To add a new
 * family, extend `resolveModel` first, then this list.
 */
const BOT_AGENT_MODEL_REGISTRY = [
  // Google Gemini
  { id: "gemini-3.5-flash", provider: "google" },
  { id: "gemini-3.1-pro-preview", provider: "google" },
  // Anthropic Claude
  { id: "claude-opus-4-8", provider: "anthropic" },
  { id: "claude-sonnet-4-6", provider: "anthropic" },
  // OpenAI
  { id: "gpt-5.1", provider: "openai" },
  // xAI Grok
  { id: "grok-3", provider: "xai" },
  // DeepSeek
  { id: "deepseek-chat", provider: "deepseek" },
  { id: "deepseek-reasoner", provider: "deepseek" },
] as const satisfies ReadonlyArray<{
  id: BotAgentModel
  provider: BotModelProvider
}>

// `BOT_AGENT_MODELS` + `BotAgentModel` are the single source in
// @lectornaut/shared/domain; re-exported so this module stays the server's
// import surface for them. The registry above pairs each shared model with a
// provider; its `satisfies` keeps every registry id a real model. Keep the
// registry in step with the shared list — every model needs a provider entry.
export { BOT_AGENT_MODELS, type BotAgentModel }

const DEFAULT_BOT_AGENT_MODEL: BotAgentModel = BOT_AGENT_MODELS[0]

/**
 * Wire-name → provider record derived from the registry at module load.
 * Type assertion is sound because the registry's `satisfies` constraint
 * already proved every `provider` is a valid `BotModelProvider`.
 */
const BOT_MODEL_PROVIDER_BY_MODEL: Record<BotAgentModel, BotModelProvider> =
  Object.fromEntries(
    BOT_AGENT_MODEL_REGISTRY.map((entry) => [entry.id, entry.provider])
  ) as Record<BotAgentModel, BotModelProvider>

const DEFAULT_BOT_AGENT_PROVIDERS: Record<BotModelProvider, boolean> = {
  google: true,
  anthropic: true,
  openai: true,
  xai: true,
  deepseek: true,
}

export type BotAgentModelToggles = Record<BotAgentModel, boolean>

const DEFAULT_BOT_AGENT_MODEL_TOGGLES: BotAgentModelToggles =
  BOT_AGENT_MODELS.reduce((acc, model) => {
    acc[model] = true
    return acc
  }, {} as BotAgentModelToggles)

// ===========================================================================
// Tool toggles
// ===========================================================================

/**
 * Names of tools whose per-team and per-agent toggles gate registration
 * in `pickChatTools`. Shared with `teamAgents.ts` so `TeamAgentDoc.tools`
 * carries the exact same keys — preventing a per-agent record from
 * having a stale key the chat dispatcher would ignore (or a missing
 * key it expected to find).
 *
 * `customAgents` is intentionally NOT in this set: it's a feature
 * flag, not a tool name, and lives only on the team-level
 * `BotAgentToolToggles` (see below). Per-agent docs don't carry it.
 */
export const CHAT_TOOL_NAMES = [
  "rollDice",
  "browseInternet",
  "askQuestion",
  "searchWorkspaceNodes",
  "listWorkspaceNodes",
  "summarizeNode",
  "compareNodes",
  "findRelatedNodes",
] as const
export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number]

/**
 * Per-tool registration toggles for the team config. Includes every
 * `ChatToolName` plus the team-wide `customAgents` + `customTools`
 * feature flags.
 */
export interface BotAgentToolToggles extends Record<ChatToolName, boolean> {
  /**
   * Team-wide gate for the agent node-WRITE tools (`NODE_WRITE_TOOLS` in
   * `botNodeTools.ts`). A capability gate over a block, not a single
   * `ChatToolName` — so it's NOT in `CHAT_TOOL_NAMES` and never reaches
   * `pickChatTools`. Instead the dispatcher registers the write tools
   * only when this is on AND the active agent's per-agent `manageContent`
   * is on AND `canManageNodes` (the user×agent `MANAGE_WORKSPACE_CONTENT`
   * intersection) holds. Off here strips the write tools — and the
   * matching system-prompt directive — for every agent. Normalized to
   * `true` on read so teams predating this field keep node editing.
   */
  manageContent: boolean
  /**
   * Team-wide gate for the node-READ tool (`NODE_READ_TOOLS` = `readNode`),
   * which returns a file's full content. Sibling of `manageContent` but
   * gated on the lighter `READ_WORKSPACE` membership (held by guests too),
   * so an agent can read workspace content without edit rights. Same
   * block-gate semantics; normalized to `true` on read.
   */
  readContent: boolean
  /**
   * Team-wide gate for the entire custom-agents feature. When false,
   * dispatch silently substitutes the team default persona even for
   * sessions that have an `activeAgentId` pinned.
   */
  customAgents: boolean
  /**
   * Team-wide gate for custom (user-authored) workflows (Settings →
   * Workflows). When false, members/admins can't create new custom
   * workflows; predefined workflows are unaffected. Normalized missing →
   * `true`.
   */
  customWorkflows: boolean
  /**
   * Team-wide gate for admin-authored custom tools. When false,
   * `listTeamCustomTools` is skipped on the dispatch path and no
   * `defineTool`-built custom tools are registered with Genkit that
   * turn — equivalent to "the team has opted out of admin-authored
   * tools as a category."
   */
  customTools: boolean
}

// ===========================================================================
// BotAgentConfig — the canonical "effective config" shape
// ===========================================================================

export interface BotAgentConfig {
  /** Provider availability policy for this team. */
  providers: Record<BotModelProvider, boolean>
  /**
   * Per-model availability toggles. Combined with `providers` (AND): a
   * model only shows up in the picker when its provider AND its
   * per-model toggle are both true.
   */
  models: BotAgentModelToggles
  model: BotAgentModel
  /** [0, 2]; lower = more deterministic. */
  temperature: number
  /** [0, 1]; nucleus sampling cutoff. */
  topP: number
  /** [1, 100]; top-K sampling cutoff. */
  topK: number
  /** Hard cap on the model's reply length, in tokens. */
  maxOutputTokens: number
  /**
   * Whether to ask reasoning-capable models to emit chain-of-thought
   * ("thinking") before the answer, surfaced as collapsible <thinking>
   * blocks in chat. Only effective for models that support it (see
   * `modelSupportsThinking` in bot.ts); others ignore it. Team-scoped.
   */
  thinking: boolean
  /**
   * When true, each turn pre-retrieves the workspace nodes most relevant to
   * the user's message and folds compact snippets into the system prompt
   * (retrieval-augmented grounding), independent of the model's own
   * `searchWorkspaceNodes` tool calls. Costs one embedding lookup per
   * message; off by default. Team-scoped.
   */
  autoContext: boolean
  /**
   * The single master switch for the Memory subsystem. When false the whole
   * subsystem is dormant: no pre-generation recall injection, no post-generation
   * extraction, and the `saveMemory` / `recallMemory` tools are not registered.
   * Existing memories stay readable/deletable for governance. Team-scoped;
   * defaults to `true` (see `DEFAULT_BOT_AGENT_CONFIG`). Individual memories are
   * still private to their author until explicitly shared, so on-by-default
   * doesn't widen who sees anything — it just lets agents use memory.
   */
  memoryEnabled: boolean
  /** Pre-selected mode for new chats; the composer can override per-turn. */
  defaultMode: BotChatMode
  /** Workspace-level system prompt; mode-specific suffix appended at runtime. */
  systemPromptBase: string
  /** One suffix per chat mode — appended after `systemPromptBase`. */
  promptSuffixes: Record<BotChatMode, string>
  /** Per-tool feature flags. Disabled tools are simply not registered. */
  tools: BotAgentToolToggles
  /** Truncation length for the auto-derived chat title (set on creation). */
  titleMaxLength: number
  /** Truncation length for the sidebar preview (re-derived every save). */
  previewMaxLength: number
}

const DEFAULT_BOT_AGENT_CONFIG: BotAgentConfig = {
  providers: { ...DEFAULT_BOT_AGENT_PROVIDERS },
  models: { ...DEFAULT_BOT_AGENT_MODEL_TOGGLES },
  model: DEFAULT_BOT_AGENT_MODEL,
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  // 4096 is a sane default for 2025-era chat models: large enough for
  // most structured replies (multi-paragraph answers, tool-rich
  // narrations, longer markdown) without leaving room for the model
  // to drift into runaway essays. Modern providers support far more
  // (Claude Opus 4.5 → 64K, Gemini 2.5 Pro → 65K+, GPT-4o → 16K) so
  // teams can raise this in Settings → Agents up to the
  // `BOT_AGENT_BOUNDS.maxOutputTokens.max = 65536` ceiling.
  maxOutputTokens: 4096,
  // Reasoning-capable models emit <thinking> by default; teams can turn
  // this off in Settings → AI to trim latency and token cost.
  thinking: true,
  // Automatic RAG grounding is opt-in — it adds an embedding lookup per
  // message, so teams enable it deliberately in Settings → AI.
  autoContext: false,
  // Memory is ON by default so agents recall + save context out of the box. A
  // team can turn it off in Settings → AI; individual memories are still
  // private to their author until shared, so this doesn't widen visibility.
  memoryEnabled: true,
  defaultMode: "auto",
  systemPromptBase:
    "You are a helpful AI assistant embedded in this team's " +
    "collaborative workspace, which holds two kinds of nodes: 'write' " +
    "(rich-text documents) and 'code' (source files) organized in " +
    "folders. When a question touches team-specific facts, ground your " +
    "answer in the workspace — call `searchWorkspaceNodes` before " +
    "answering instead of guessing, and say so plainly when you can't " +
    "find a relevant node. Write replies in Markdown and keep them " +
    "concise.",
  promptSuffixes: {
    auto: MODE_CONFIG.auto.promptSuffix,
    agent: MODE_CONFIG.agent.promptSuffix,
    manual: MODE_CONFIG.manual.promptSuffix,
  },
  tools: {
    rollDice: true,
    browseInternet: true,
    askQuestion: true,
    searchWorkspaceNodes: true,
    listWorkspaceNodes: true,
    summarizeNode: true,
    compareNodes: true,
    findRelatedNodes: true,
    manageContent: true,
    readContent: true,
    customAgents: true,
    customWorkflows: true,
    customTools: true,
  },
  titleMaxLength: TITLE_MAX_LENGTH,
  previewMaxLength: PREVIEW_MAX_LENGTH,
}

const cloneDefaultBotAgentConfig = (): BotAgentConfig => ({
  ...DEFAULT_BOT_AGENT_CONFIG,
  providers: { ...DEFAULT_BOT_AGENT_CONFIG.providers },
  models: { ...DEFAULT_BOT_AGENT_CONFIG.models },
  promptSuffixes: { ...DEFAULT_BOT_AGENT_CONFIG.promptSuffixes },
  tools: { ...DEFAULT_BOT_AGENT_CONFIG.tools },
})

/**
 * Bounds enforced both client-side (slider min/max) and server-side
 * (zod refines). Centralizing here keeps the two sides honest — change
 * a bound and both error messages move together.
 */
const BOT_AGENT_BOUNDS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  topK: { min: 1, max: 100 },
  maxOutputTokens: { min: 256, max: 65536 },
  systemPromptBase: { max: 4000 },
  promptSuffix: { max: 2000 },
  titleMaxLength: { min: 20, max: 200 },
  previewMaxLength: { min: 50, max: 500 },
} as const

const botAgentConfigUpdateSchema = z.object({
  // Keep keys in step with AI_PROVIDERS — an omitted provider here is
  // silently stripped from the update, so the admin toggle never persists.
  providers: z
    .object({
      google: z.boolean(),
      anthropic: z.boolean(),
      openai: z.boolean(),
      xai: z.boolean(),
      deepseek: z.boolean(),
    })
    .partial()
    .optional(),
  models: z.record(z.enum(BOT_AGENT_MODELS), z.boolean()).optional(),
  model: z.enum(BOT_AGENT_MODELS).optional(),
  temperature: z
    .number()
    .min(BOT_AGENT_BOUNDS.temperature.min)
    .max(BOT_AGENT_BOUNDS.temperature.max)
    .optional(),
  topP: z
    .number()
    .min(BOT_AGENT_BOUNDS.topP.min)
    .max(BOT_AGENT_BOUNDS.topP.max)
    .optional(),
  topK: z
    .number()
    .int()
    .min(BOT_AGENT_BOUNDS.topK.min)
    .max(BOT_AGENT_BOUNDS.topK.max)
    .optional(),
  maxOutputTokens: z
    .number()
    .int()
    .min(BOT_AGENT_BOUNDS.maxOutputTokens.min)
    .max(BOT_AGENT_BOUNDS.maxOutputTokens.max)
    .optional(),
  thinking: z.boolean().optional(),
  autoContext: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  defaultMode: z.enum(BOT_CHAT_MODES).optional(),
  systemPromptBase: z
    .string()
    .max(BOT_AGENT_BOUNDS.systemPromptBase.max)
    .optional(),
  promptSuffixes: z
    .object({
      auto: z.string().max(BOT_AGENT_BOUNDS.promptSuffix.max),
      agent: z.string().max(BOT_AGENT_BOUNDS.promptSuffix.max),
      manual: z.string().max(BOT_AGENT_BOUNDS.promptSuffix.max),
    })
    .partial()
    .optional(),
  tools: z
    .object({
      rollDice: z.boolean(),
      browseInternet: z.boolean(),
      askQuestion: z.boolean(),
      searchWorkspaceNodes: z.boolean(),
      listWorkspaceNodes: z.boolean(),
      summarizeNode: z.boolean(),
      compareNodes: z.boolean(),
      findRelatedNodes: z.boolean(),
      manageContent: z.boolean(),
      readContent: z.boolean(),
      customAgents: z.boolean(),
      customWorkflows: z.boolean(),
      customTools: z.boolean(),
    })
    .partial()
    .optional(),
  titleMaxLength: z
    .number()
    .int()
    .min(BOT_AGENT_BOUNDS.titleMaxLength.min)
    .max(BOT_AGENT_BOUNDS.titleMaxLength.max)
    .optional(),
  previewMaxLength: z
    .number()
    .int()
    .min(BOT_AGENT_BOUNDS.previewMaxLength.min)
    .max(BOT_AGENT_BOUNDS.previewMaxLength.max)
    .optional(),
})

type BotAgentConfigUpdate = z.infer<typeof botAgentConfigUpdateSchema>

const agentConfigDocPath = (teamId: string) => `teams/${teamId}/settings/agent`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasEnabledProvider(
  providers: Record<BotModelProvider, boolean>
): boolean {
  return BOT_MODEL_PROVIDERS.some((provider) => providers[provider])
}

function normalizeProviderToggles(
  raw: unknown
): Record<BotModelProvider, boolean> {
  const rawProviders = isRecord(raw) ? raw : {}
  const providers: Record<BotModelProvider, boolean> = {
    ...DEFAULT_BOT_AGENT_PROVIDERS,
  }

  for (const provider of BOT_MODEL_PROVIDERS) {
    if (typeof rawProviders[provider] === "boolean") {
      providers[provider] = rawProviders[provider]
    }
  }

  return hasEnabledProvider(providers)
    ? providers
    : { ...DEFAULT_BOT_AGENT_PROVIDERS }
}

function firstModelForEnabledProviders(
  providers: Record<BotModelProvider, boolean>
): BotAgentModel {
  return (
    BOT_AGENT_MODELS.find(
      (model) => providers[BOT_MODEL_PROVIDER_BY_MODEL[model]]
    ) ?? DEFAULT_BOT_AGENT_CONFIG.model
  )
}

/**
 * Pick the first model that's available under BOTH the provider toggles
 * and the per-model toggles. Falls back to the first model whose
 * provider is enabled (ignoring the per-model toggle) so an
 * over-restrictive `models` map can never strand the team with no
 * resolvable model — chat would otherwise fail at dispatch time.
 */
function firstAvailableModel(
  providers: Record<BotModelProvider, boolean>,
  models: BotAgentModelToggles
): BotAgentModel {
  return (
    BOT_AGENT_MODELS.find(
      (model) => providers[BOT_MODEL_PROVIDER_BY_MODEL[model]] && models[model]
    ) ?? firstModelForEnabledProviders(providers)
  )
}

function hasEnabledModel(
  providers: Record<BotModelProvider, boolean>,
  models: BotAgentModelToggles
): boolean {
  return BOT_AGENT_MODELS.some(
    (model) => providers[BOT_MODEL_PROVIDER_BY_MODEL[model]] && models[model]
  )
}

/**
 * Clamp a per-turn model override against the team's current
 * provider/model allowlist. Returns:
 *   - `requested` when it's a known wire-name AND both its provider
 *     and per-model toggles are on under `agentConfig`
 *   - `agentConfig.model` otherwise (no override, unknown id, or one
 *     the team policy no longer allows)
 */
export function resolveEffectiveModel(
  requested: BotAgentModel | undefined,
  agentConfig: BotAgentConfig
): BotAgentModel {
  if (!requested) return agentConfig.model
  if (!(BOT_AGENT_MODELS as readonly string[]).includes(requested)) {
    return agentConfig.model
  }
  const providerEnabled =
    agentConfig.providers[BOT_MODEL_PROVIDER_BY_MODEL[requested]]
  const modelEnabled = agentConfig.models[requested]
  if (providerEnabled && modelEnabled) return requested
  return agentConfig.model
}

function normalizeModelToggles(raw: unknown): BotAgentModelToggles {
  const rawModels = isRecord(raw) ? raw : {}
  const models: BotAgentModelToggles = { ...DEFAULT_BOT_AGENT_MODEL_TOGGLES }

  for (const model of BOT_AGENT_MODELS) {
    if (typeof rawModels[model] === "boolean") {
      models[model] = rawModels[model] as boolean
    }
  }

  if (!BOT_AGENT_MODELS.some((model) => models[model])) {
    return { ...DEFAULT_BOT_AGENT_MODEL_TOGGLES }
  }
  return models
}

function assertEnabledProvidersConfigured(
  providers: Record<BotModelProvider, boolean>
): void {
  for (const provider of BOT_MODEL_PROVIDERS) {
    if (providers[provider]) {
      assertAiModelProviderConfigured(provider)
    }
  }
}

// ===========================================================================
// Zod-based per-field normalizer
// ===========================================================================

const clampedNumber = (min: number, max: number, fallback: number) =>
  z
    .number()
    .finite()
    .catch(fallback)
    .transform((v) => Math.min(Math.max(v, min), max))

const clampedInt = (min: number, max: number, fallback: number) =>
  z
    .number()
    .finite()
    .catch(fallback)
    .transform((v) => Math.min(Math.max(Math.round(v), min), max))

const cappedString = (max: number, fallback: string) =>
  z
    .string()
    .catch(fallback)
    .transform((v) => v.slice(0, max))

const cappedToolToggle = (fallback: boolean) => z.boolean().catch(fallback)

const botAgentConfigDocSchema = z
  .object({
    temperature: clampedNumber(
      BOT_AGENT_BOUNDS.temperature.min,
      BOT_AGENT_BOUNDS.temperature.max,
      DEFAULT_BOT_AGENT_CONFIG.temperature
    ),
    topP: clampedNumber(
      BOT_AGENT_BOUNDS.topP.min,
      BOT_AGENT_BOUNDS.topP.max,
      DEFAULT_BOT_AGENT_CONFIG.topP
    ),
    topK: clampedInt(
      BOT_AGENT_BOUNDS.topK.min,
      BOT_AGENT_BOUNDS.topK.max,
      DEFAULT_BOT_AGENT_CONFIG.topK
    ),
    maxOutputTokens: clampedInt(
      BOT_AGENT_BOUNDS.maxOutputTokens.min,
      BOT_AGENT_BOUNDS.maxOutputTokens.max,
      DEFAULT_BOT_AGENT_CONFIG.maxOutputTokens
    ),
    thinking: cappedToolToggle(DEFAULT_BOT_AGENT_CONFIG.thinking),
    autoContext: cappedToolToggle(DEFAULT_BOT_AGENT_CONFIG.autoContext),
    memoryEnabled: cappedToolToggle(DEFAULT_BOT_AGENT_CONFIG.memoryEnabled),
    defaultMode: z
      .enum(BOT_CHAT_MODES)
      .catch(DEFAULT_BOT_AGENT_CONFIG.defaultMode),
    systemPromptBase: cappedString(
      BOT_AGENT_BOUNDS.systemPromptBase.max,
      DEFAULT_BOT_AGENT_CONFIG.systemPromptBase
    ),
    promptSuffixes: z
      .object({
        auto: cappedString(
          BOT_AGENT_BOUNDS.promptSuffix.max,
          DEFAULT_BOT_AGENT_CONFIG.promptSuffixes.auto
        ),
        agent: cappedString(
          BOT_AGENT_BOUNDS.promptSuffix.max,
          DEFAULT_BOT_AGENT_CONFIG.promptSuffixes.agent
        ),
        manual: cappedString(
          BOT_AGENT_BOUNDS.promptSuffix.max,
          DEFAULT_BOT_AGENT_CONFIG.promptSuffixes.manual
        ),
      })
      .catch({ ...DEFAULT_BOT_AGENT_CONFIG.promptSuffixes }),
    tools: z
      .object({
        rollDice: cappedToolToggle(DEFAULT_BOT_AGENT_CONFIG.tools.rollDice),
        browseInternet: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.browseInternet
        ),
        askQuestion: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.askQuestion
        ),
        searchWorkspaceNodes: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.searchWorkspaceNodes
        ),
        listWorkspaceNodes: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.listWorkspaceNodes
        ),
        summarizeNode: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.summarizeNode
        ),
        compareNodes: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.compareNodes
        ),
        findRelatedNodes: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.findRelatedNodes
        ),
        manageContent: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.manageContent
        ),
        readContent: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.readContent
        ),
        customAgents: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.customAgents
        ),
        customWorkflows: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.customWorkflows
        ),
        customTools: cappedToolToggle(
          DEFAULT_BOT_AGENT_CONFIG.tools.customTools
        ),
      })
      .catch({ ...DEFAULT_BOT_AGENT_CONFIG.tools }),
    titleMaxLength: clampedInt(
      BOT_AGENT_BOUNDS.titleMaxLength.min,
      BOT_AGENT_BOUNDS.titleMaxLength.max,
      DEFAULT_BOT_AGENT_CONFIG.titleMaxLength
    ),
    previewMaxLength: clampedInt(
      BOT_AGENT_BOUNDS.previewMaxLength.min,
      BOT_AGENT_BOUNDS.previewMaxLength.max,
      DEFAULT_BOT_AGENT_CONFIG.previewMaxLength
    ),
  })
  .passthrough()

function applyAgentConfigOverrides(
  raw: Record<string, unknown> | undefined
): BotAgentConfig {
  if (!raw) return cloneDefaultBotAgentConfig()

  const providers = normalizeProviderToggles(raw.providers)
  const models = normalizeModelToggles(raw.models)
  const configuredModel =
    typeof raw.model === "string" &&
    (BOT_AGENT_MODELS as readonly string[]).includes(raw.model)
      ? (raw.model as BotAgentModel)
      : DEFAULT_BOT_AGENT_CONFIG.model
  const isConfiguredModelAvailable =
    providers[BOT_MODEL_PROVIDER_BY_MODEL[configuredModel]] &&
    models[configuredModel]
  const model = isConfiguredModelAvailable
    ? configuredModel
    : firstAvailableModel(providers, models)

  const parsed = botAgentConfigDocSchema.parse(raw)

  return {
    providers,
    models,
    model,
    temperature: parsed.temperature,
    topP: parsed.topP,
    topK: parsed.topK,
    maxOutputTokens: parsed.maxOutputTokens,
    thinking: parsed.thinking,
    autoContext: parsed.autoContext,
    memoryEnabled: parsed.memoryEnabled,
    defaultMode: parsed.defaultMode,
    systemPromptBase: parsed.systemPromptBase,
    promptSuffixes: parsed.promptSuffixes,
    tools: parsed.tools,
    titleMaxLength: parsed.titleMaxLength,
    previewMaxLength: parsed.previewMaxLength,
  }
}

/**
 * Load the effective agent config for a team. Exported so sibling
 * sub-flows (e.g. `botSummarize.ts`) can use the team's chosen model +
 * generation knobs without duplicating the Firestore read + merge
 * logic.
 */
export async function loadTeamAgentConfig(
  teamId: string
): Promise<BotAgentConfig> {
  const snap = await db.doc(agentConfigDocPath(teamId)).get()
  if (!snap.exists) return cloneDefaultBotAgentConfig()
  return applyAgentConfigOverrides(snap.data())
}

// ===========================================================================
// CRUD callables — read & update team agent config
// ===========================================================================
//
// Read is open to any team member (the config drives chat behavior they
// experience). Write is restricted to owners + admins, so a regular
// member can't change the model or strip safety-relevant prompt text.
//
// Both callables return the FULL effective config — partially-set docs
// get filled with defaults server-side via `applyAgentConfigOverrides`,
// so the client never has to worry about which fields are present.

interface GetTeamAgentConfigRequest {
  teamId: string
}

interface GetTeamAgentConfigResponse {
  config: BotAgentConfig
  /** True when the team has an explicit doc (vs relying on defaults). */
  hasOverrides: boolean
}

export const getTeamAgentConfig = onCall<GetTeamAgentConfigRequest>(
  { ...CALLABLE_OPTS, enforceAppCheck: true },
  async (request): Promise<GetTeamAgentConfigResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }

    await getMembershipRole(teamId, auth.uid)

    const snap = await db.doc(agentConfigDocPath(teamId)).get()
    const config = applyAgentConfigOverrides(snap.data())

    return { config, hasOverrides: snap.exists }
  }
)

interface UpdateTeamAgentConfigRequest {
  teamId: string
  /** Partial — only sent fields are updated, the rest fall through to defaults. */
  updates: BotAgentConfigUpdate
}

interface UpdateTeamAgentConfigResponse {
  config: BotAgentConfig
}

export const updateTeamAgentConfig = onCall<UpdateTeamAgentConfigRequest>(
  {
    ...CALLABLE_OPTS,
    secrets: aiProviderSecrets,
    enforceAppCheck: true,
  },
  async (request): Promise<UpdateTeamAgentConfigResponse> => {
    const auth = requireVerifiedAuth(request.auth)
    const { teamId, updates } = request.data ?? {}

    if (typeof teamId !== "string" || !teamId) {
      throw new HttpsError("invalid-argument", "teamId is required.")
    }

    const role = await getMembershipRole(teamId, auth.uid)
    if (!isAdminRole(role)) {
      throw new HttpsError(
        "permission-denied",
        "Only team owners and admins can change agent settings."
      )
    }

    const parsed = botAgentConfigUpdateSchema.safeParse(updates ?? {})
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        `Invalid agent config: ${parsed.error.message}`
      )
    }

    const ref = db.doc(agentConfigDocPath(teamId))
    const existingSnap = await ref.get()
    const currentConfig = applyAgentConfigOverrides(existingSnap.data())
    const nextProviders = {
      ...currentConfig.providers,
      ...(parsed.data.providers ?? {}),
    }
    const nextModels: BotAgentModelToggles = {
      ...currentConfig.models,
      ...(parsed.data.models ?? {}),
    }

    if (!hasEnabledProvider(nextProviders)) {
      throw new HttpsError(
        "invalid-argument",
        "At least one AI provider must stay enabled."
      )
    }
    if (!hasEnabledModel(nextProviders, nextModels)) {
      throw new HttpsError(
        "invalid-argument",
        "At least one model must stay available."
      )
    }
    assertEnabledProvidersConfigured(nextProviders)

    let nextModel = parsed.data.model ?? currentConfig.model
    const isNextModelAvailable =
      nextProviders[BOT_MODEL_PROVIDER_BY_MODEL[nextModel]] &&
      nextModels[nextModel]
    if (!isNextModelAvailable) {
      if (parsed.data.model) {
        throw new HttpsError(
          "invalid-argument",
          "Selected model is unavailable — provider disabled or model toggled off."
        )
      }
      nextModel = firstAvailableModel(nextProviders, nextModels)
    }

    const updatesToWrite: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.providers || parsed.data.models) {
      updatesToWrite.providers = nextProviders
      updatesToWrite.models = nextModels
      updatesToWrite.model = nextModel
    } else if (parsed.data.model) {
      updatesToWrite.model = nextModel
    }

    await ref.set(
      {
        ...updatesToWrite,
        teamId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      },
      { merge: true }
    )

    const snap = await ref.get()
    return { config: applyAgentConfigOverrides(snap.data()) }
  }
)

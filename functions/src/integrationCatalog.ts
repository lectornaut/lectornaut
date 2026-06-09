/**
 * Unified integration catalog (server).
 *
 * Adapts the three code-resident catalogs — built-in agents
 * (`builtInAgents.ts`), built-in tools (the `CHAT_TOOL_NAMES` whose handlers
 * live in `botBuiltinTools.ts` and siblings), and workflow presets
 * (`workflowPresets.ts`) — behind ONE provider keyed by `(type, sourceKey)`.
 *
 * This is the seam a future marketplace plugs into: a "published" catalog
 * source would expose the same `CatalogEntry` shape from a remote/team doc,
 * and the install pipeline (`installIntegration` in `integrations.ts`) would
 * treat it identically. Nothing here is per-team — it's the static, shippable
 * "what can be installed" list. Per-team install/enable STATE lives in the
 * per-nature stores: agent + tool docs in `teams/{teamId}/integrations`,
 * workflow instances in `teams/{teamId}/workspaces/{workspaceId}/workflows`.
 *
 * `spec` semantics by type (mirrors `integrationSchema` in the client):
 *   - agent  → carries the full persona (`agentSpec`); built-in agent docs are
 *     thin references that resolve their persona from here at dispatch.
 *   - tool   → NO spec. A built-in tool's behavior is an `ai.defineTool`
 *     closure resolved by `sourceKey` (== its wire-name) in `bot.ts`. The
 *     catalog carries only display metadata.
 *   - workflow → carries materialization defaults; installing a preset copies
 *     these into a full, editable workflow instance (today's behavior).
 */

import {
  BUILT_IN_AGENTS,
  type BuiltInAgentDefinition,
} from "./builtInAgents.js"
import type { IntegrationType } from "./domain.js"
import type { WorkspaceNodeScope } from "./types.js"
import { WORKFLOW_PRESETS } from "./workflowPresets.js"

export type { IntegrationType }

/** Persona payload for an agent catalog entry (resolved for built-in agents). */
export interface AgentCatalogSpec {
  systemPromptBase: string
  promptSuffixes: { auto: string; agent: string; manual: string }
  tools: Record<string, boolean>
  customTools: Record<string, boolean>
}

/** Defaults copied into a materialized workflow instance at install. */
export interface WorkflowCatalogDefaults {
  targetScope: WorkspaceNodeScope | null
  instructions: string
  additionalPrompt: string
  trigger:
    | {
        type: "schedule"
        schedule: { type: "weekly"; dayOfWeek: number; atMinuteUTC: number }
      }
    | { type: "event"; scope: WorkspaceNodeScope; debounceMinutes?: number }
  updateMode: "automatic" | "require_review"
}

interface CatalogEntryBase {
  key: string
  source: "builtin"
  name: string
  description: string
  avatarSeed: string
}

export type CatalogEntry =
  | (CatalogEntryBase & { type: "agent"; agentSpec: AgentCatalogSpec })
  | (CatalogEntryBase & { type: "tool" })
  | (CatalogEntryBase & {
      type: "workflow"
      workflowDefaults: WorkflowCatalogDefaults
    })

// ─── Built-in tool display metadata ──────────────────────────────────────────
// The 8 model-callable built-in tools (== CHAT_TOOL_NAMES). Their handlers are
// code; only display text is data. Keep the key set in sync with
// `botAgentConfig.ts::CHAT_TOOL_NAMES` and the client `BOT_TOOL_CATALOG`.

interface ToolDisplay {
  name: string
  description: string
  avatarSeed: string
}

const BUILTIN_TOOL_DISPLAY: Record<string, ToolDisplay> = {
  rollDice: {
    name: "Roll dice",
    description: "Roll one or more dice and return the results.",
    avatarSeed: "roll-dice",
  },
  browseInternet: {
    name: "Browse the internet",
    description:
      "Live web search via Google Search grounding. Runs on the server " +
      "Gemini key regardless of the team's chat model.",
    avatarSeed: "browse-internet",
  },
  askQuestion: {
    name: "Ask a question",
    description:
      "Pause the chat to ask the user a clarifying question before " +
      "continuing.",
    avatarSeed: "ask-question",
  },
  searchWorkspaceNodes: {
    name: "Search workspace",
    description:
      "Semantic search (RAG) over the workspace's nodes to ground answers " +
      "in the team's content.",
    avatarSeed: "search-workspace",
  },
  listWorkspaceNodes: {
    name: "List workspace nodes",
    description:
      "Enumerate workspace nodes by name — a directory listing for acting " +
      "over many or all nodes.",
    avatarSeed: "list-workspace",
  },
  summarizeNode: {
    name: "Summarize node",
    description:
      "Produce a structured summary (overview + key points + tags) of a " +
      "workspace node.",
    avatarSeed: "summarize-node",
  },
  compareNodes: {
    name: "Compare nodes",
    description:
      "Load 2–5 workspace nodes and produce a structured contrast — " +
      "agreements, disagreements, and unique points.",
    avatarSeed: "compare-nodes",
  },
  findRelatedNodes: {
    name: "Find related nodes",
    description:
      "Nearest-neighbor lookup that reuses a source node's embedding to " +
      "surface related nodes.",
    avatarSeed: "find-related",
  },
}

/**
 * The built-in tool wire-names (== `CHAT_TOOL_NAMES`). Each is both the
 * catalog `sourceKey` AND the wire-name the model invokes. Kept here as the
 * catalog's own copy so the catalog doesn't depend on `botAgentConfig.ts`.
 */
export const BUILTIN_TOOL_KEYS: ReadonlyArray<string> =
  Object.keys(BUILTIN_TOOL_DISPLAY)

// ─── Catalog assembly ────────────────────────────────────────────────────────

function agentEntry(def: BuiltInAgentDefinition): CatalogEntry {
  return {
    type: "agent",
    key: def.id,
    source: "builtin",
    name: def.name,
    description: def.description,
    avatarSeed: def.avatarSeed,
    agentSpec: {
      systemPromptBase: def.systemPromptBase,
      promptSuffixes: { ...def.promptSuffixes },
      tools: { ...def.tools },
      // Built-ins default to "every custom tool enabled" via the `!== false`
      // dispatch check — no per-built-in customTools editor exists.
      customTools: {},
    },
  }
}

const AGENT_ENTRIES: CatalogEntry[] = BUILT_IN_AGENTS.map(agentEntry)

const TOOL_ENTRIES: CatalogEntry[] = BUILTIN_TOOL_KEYS.map((key) => ({
  type: "tool",
  key,
  source: "builtin",
  ...BUILTIN_TOOL_DISPLAY[key],
}))

const WORKFLOW_ENTRIES: CatalogEntry[] = WORKFLOW_PRESETS.map((preset) => ({
  type: "workflow",
  key: preset.key,
  source: "builtin",
  name: preset.name,
  description: preset.description,
  avatarSeed: preset.avatarSeed,
  workflowDefaults: {
    targetScope: preset.defaultTargetScope,
    instructions: preset.instructions,
    additionalPrompt: preset.additionalPrompt ?? "",
    trigger: preset.defaultTrigger,
    updateMode: preset.defaultUpdateMode,
  },
}))

/** The full installable catalog across all three types. */
export const INTEGRATION_CATALOG: ReadonlyArray<CatalogEntry> = [
  ...AGENT_ENTRIES,
  ...TOOL_ENTRIES,
  ...WORKFLOW_ENTRIES,
]

const CATALOG_BY_TYPE_KEY: ReadonlyMap<string, CatalogEntry> = new Map(
  INTEGRATION_CATALOG.map((entry) => [`${entry.type}:${entry.key}`, entry])
)

/** All catalog entries, optionally filtered by type (narrowed when filtered). */
export function listCatalog(): CatalogEntry[]
export function listCatalog<T extends IntegrationType>(
  type: T
): Extract<CatalogEntry, { type: T }>[]
export function listCatalog(type?: IntegrationType): CatalogEntry[] {
  return type
    ? INTEGRATION_CATALOG.filter((entry) => entry.type === type)
    : [...INTEGRATION_CATALOG]
}

/** Resolve one catalog entry by `(type, sourceKey)`, or undefined (narrowed). */
export function getCatalogEntry<T extends IntegrationType>(
  type: T,
  sourceKey: string
): Extract<CatalogEntry, { type: T }> | undefined
export function getCatalogEntry(
  type: IntegrationType,
  sourceKey: string
): CatalogEntry | undefined {
  return CATALOG_BY_TYPE_KEY.get(`${type}:${sourceKey}`)
}

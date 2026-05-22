/**
 * Built-in agent registry (server-side mirror of
 * `src/data/builtInAgents.ts`).
 *
 * Keeps the two registries shape-aligned: ids match across client and
 * server, system prompts and tool subsets are duplicated so neither
 * side has to import the other (server can't import client; client
 * shouldn't carry server-only fields). Drift is a real risk — to
 * avoid it, keep the file structure identical and edit them together
 * in the same change.
 *
 * The runtime contract:
 *
 *   - `listBuiltInAgents(toggles, teamId)` is called by `bot.ts` on
 *     every chat turn alongside `listTeamAgents`. Its output is
 *     concatenated into the available-agents list passed to
 *     `resolveActiveAgent` and `buildTransferRoster`.
 *
 *   - The team config's `builtInAgents` map gates inclusion: a missing
 *     key (= newly-added preset on an existing team) normalizes to
 *     `true`, so admins opt out, not in.
 *
 *   - Hydrated records carry `enabled: true` and `archivedAt: null`
 *     unconditionally. The "disabled" state for a built-in is
 *     represented purely by the team config's toggle being `false` —
 *     there's no doc to put `enabled: false` on.
 */

import { admin } from "./firebase.js"
import type { TeamAgentDoc } from "./teamAgents.js"

interface TeamAgentToolToggles {
  getWeather: boolean
  rollDice: boolean
  browseInternet: boolean
  askQuestion: boolean
  searchWorkspaceNodes: boolean
  summarizeNode: boolean
}

interface TeamAgentPromptSuffixes {
  auto: string
  agent: string
  manual: string
}

export interface BuiltInAgentDefinition {
  id: string
  name: string
  description: string
  avatarSeed: string
  systemPromptBase: string
  promptSuffixes: TeamAgentPromptSuffixes
  tools: TeamAgentToolToggles
}

const ALL_TOOLS_ENABLED: TeamAgentToolToggles = {
  getWeather: true,
  rollDice: true,
  browseInternet: true,
  askQuestion: true,
  searchWorkspaceNodes: true,
  summarizeNode: true,
}

/**
 * Source of truth for the shipped presets. Keep IDs + prompts
 * synchronized with `src/data/builtInAgents.ts`.
 */
export const BUILT_IN_AGENTS: ReadonlyArray<BuiltInAgentDefinition> = [
  {
    id: "_researcher",
    name: "Researcher",
    description:
      "Pulls grounded answers from the workspace. Cites sources from " +
      "the team's notes and files.",
    avatarSeed: "researcher",
    systemPromptBase:
      "You are a research assistant. Ground every claim in the team's " +
      "workspace nodes. Quote short snippets verbatim, name the source " +
      "node by title when you do, and when you can't find a relevant " +
      "node say so explicitly rather than inventing one. Prefer calling " +
      "`searchWorkspaceNodes` BEFORE answering whenever the question " +
      "touches on team-specific facts.",
    promptSuffixes: {
      auto: "",
      agent:
        "Chain multiple `searchWorkspaceNodes` calls when one query " +
        "isn't enough — different angles, synonyms, or sub-questions.",
      manual: "",
    },
    tools: {
      ...ALL_TOOLS_ENABLED,
      getWeather: false,
      rollDice: false,
    },
  },
  {
    id: "_writer",
    name: "Writer",
    description:
      "Long-form drafting persona. Structured output with clear " +
      "headings, transitions, and a single argumentative spine.",
    avatarSeed: "writer",
    systemPromptBase:
      "You are a long-form writing assistant. When the user asks for a " +
      "draft, produce a structured document: short opening, clear " +
      "section headings, paragraphs that flow with explicit " +
      "transitions, and a closing that synthesizes — not a bulleted " +
      "outline unless the user explicitly asked for one. Keep prose " +
      "concrete; avoid filler.",
    promptSuffixes: {
      auto: "",
      agent: "",
      manual:
        "Manual mode: you may still draft text on request — drafts are " +
        "discussion artifacts, not actions on the user's behalf.",
    },
    tools: {
      ...ALL_TOOLS_ENABLED,
      getWeather: false,
      rollDice: false,
    },
  },
  {
    id: "_summarizer",
    name: "Summarizer",
    description:
      "Terse bullet-point summaries. Pairs with `summarizeNode` for " +
      "structured node digests.",
    avatarSeed: "summarizer",
    systemPromptBase:
      "You are a summarization assistant. Your defaults are: short " +
      "opening sentence stating the gist, then 3–7 bullets covering " +
      "the most decision-relevant facts, then a one-line takeaway. Use " +
      "`summarizeNode` for attached workspace nodes — its structured " +
      "output (overview + key points + tags) is exactly the shape the " +
      "user wants. Cut adjectives; keep nouns and numbers.",
    promptSuffixes: {
      auto: "",
      agent:
        "When the user attaches multiple nodes, summarize each, then " +
        "produce a meta-summary that contrasts them.",
      manual: "",
    },
    tools: {
      ...ALL_TOOLS_ENABLED,
      getWeather: false,
      rollDice: false,
    },
  },
  {
    id: "_code",
    name: "Code helper",
    description:
      "Programming-focused persona. Reads files, suggests changes, " +
      "and uses fenced code blocks with language tags.",
    avatarSeed: "code-helper",
    systemPromptBase:
      "You are a programming assistant. Default to short, direct " +
      "answers; reach for fenced code blocks (with the language tag) " +
      "instead of prose when showing implementations. When the user " +
      "asks about their workspace code, search workspace nodes for the " +
      "relevant file first — don't guess at paths or symbol names. " +
      "Prefer minimal diffs over rewrites; explain the WHY in a " +
      "sentence above the code.",
    promptSuffixes: {
      auto: "",
      agent:
        "Be willing to chain searches: find a file by name, then read " +
        "its content, then propose the smallest diff that works.",
      manual:
        "Manual mode: explain and suggest, but don't claim to have " +
        "edited or run anything.",
    },
    tools: {
      ...ALL_TOOLS_ENABLED,
      getWeather: false,
      rollDice: false,
    },
  },
] as const

export const BUILT_IN_AGENTS_BY_ID: Readonly<
  Record<string, BuiltInAgentDefinition>
> = Object.freeze(
  Object.fromEntries(BUILT_IN_AGENTS.map((agent) => [agent.id, agent]))
)

export function isBuiltInAgentId(agentId: string | null | undefined): boolean {
  return typeof agentId === "string" && agentId.startsWith("_")
}

/**
 * Hydrate a definition into the canonical `TeamAgentDoc` shape, so
 * downstream code (resolveActiveAgent / buildTransferRoster /
 * buildAgentSystemPrompt) treats it identically to a Firestore-backed
 * custom agent.
 */
export function hydrateBuiltInAgent(
  teamId: string,
  definition: BuiltInAgentDefinition
): TeamAgentDoc {
  const now = admin.firestore.Timestamp.now()
  return {
    id: definition.id,
    teamId,
    name: definition.name,
    description: definition.description,
    avatarSeed: definition.avatarSeed,
    systemPromptBase: definition.systemPromptBase,
    promptSuffixes: { ...definition.promptSuffixes },
    tools: { ...definition.tools },
    // Built-in presets default to "every custom tool enabled" — admins
    // can't currently customize the customTools map for built-ins
    // (no per-built-in editor exists; the only knobs are the on/off
    // toggles in `agentConfig.builtInAgents`). An empty map relies on
    // the `!== false` dispatch check to mean "all enabled."
    customTools: {},
    enabled: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdByUid: "",
  }
}

/**
 * Filter + hydrate the team's enabled built-ins into the same shape
 * `listTeamAgents` returns. Designed to be concatenated with the
 * custom-agents list before passing to `resolveActiveAgent`.
 *
 * `toggles` carries the team's saved on/off map. A missing key
 * normalizes to "enabled" — same convention used elsewhere so a
 * newly-shipped preset rolls out without migration. Pass an empty
 * object `{}` (the post-normalization default for teams with no
 * config doc) and all presets show up.
 */
export function listBuiltInAgents(
  teamId: string,
  toggles: Record<string, boolean> | undefined
): TeamAgentDoc[] {
  return BUILT_IN_AGENTS.filter((agent) => toggles?.[agent.id] !== false).map(
    (agent) => hydrateBuiltInAgent(teamId, agent)
  )
}

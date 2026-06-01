/**
 * Built-in agent registry — fixed-id preset personas shipped with the
 * app. Mirrors the server-side registry in
 * `functions/src/builtInAgents.ts` (keep both in sync — the wire-name
 * `id`s must match for cross-client/server agent resolution).
 *
 * Each entry is shaped like a partial `ITeamAgent` so the merge with
 * the team's custom agent collection is a straight concatenation: the
 * sidebar/composer pickers and the transfer roster builder both treat
 * built-ins and customs interchangeably. The shape difference (no
 * `teamId`, no real Timestamps) is filled in at hydration time
 * (`hydrateBuiltInAgent` below) so consumers always see an
 * `ITeamAgent` they can render without special-casing.
 *
 * Lifecycle:
 *   - Built-ins are never "archived" or "deleted" — there's no doc to
 *     write. The team-config toggle (`agentConfig.builtInAgents[id]`)
 *     is the only on/off control.
 *   - Disabled built-ins are filtered out of pickers + dispatch in the
 *     same place customs are (`teamAgentsStore.selectableAgents`), so
 *     the lifecycle gates feel uniform to admins.
 *
 * Adding a new preset:
 *   1. Append an entry here (pick a `_`-prefixed id that won't collide
 *      with user-created agent ids).
 *   2. Mirror it in `functions/src/builtInAgents.ts`.
 *   3. Add a default-true entry under `builtInAgents` in
 *      `helpers/defaults.ts::defaultBotAgentConfig` so existing teams
 *      pick it up automatically.
 *   4. Add an i18n key under `settings.agents.builtInAgents.<id>.*`.
 */

import type { ITeamAgent } from "@/types/domain"
import { Timestamp } from "firebase/firestore"

/**
 * The mandatory subset of `ITeamAgent` each built-in carries
 * statically. Everything else (`teamId`, `enabled`, `archivedAt`,
 * timestamps) is filled in at hydration time so the runtime shape
 * matches what custom agents produce.
 */
export interface IBuiltInAgentDefinition {
  /**
   * Fixed wire-name. Must start with `_` to avoid colliding with
   * Firestore-generated custom-agent ids. Also doubles as the i18n
   * lookup key (`settings.agents.builtInAgents.<id>.*`).
   */
  id: string
  /** Default display name when no i18n string is present. */
  name: string
  description: string
  /** Avatar seed — see `vue-boring-avatars`. */
  avatarSeed: string
  /** System prompt that REPLACES the team default when this agent runs. */
  systemPromptBase: string
  /** Per-mode suffix appended after `systemPromptBase`. */
  promptSuffixes: ITeamAgent["promptSuffixes"]
  /** Per-tool subset — intersected with team-level toggles at dispatch. */
  tools: ITeamAgent["tools"]
}

const ALL_TOOLS_ENABLED: ITeamAgent["tools"] = {
  rollDice: true,
  browseInternet: true,
  askQuestion: true,
  searchWorkspaceNodes: true,
  listWorkspaceNodes: true,
  summarizeNode: true,
  compareNodes: true,
  findRelatedNodes: true,
  // Real per-agent gates for the node tools (consumed at dispatch,
  // intersected with the team toggle + membership) — unlike the three
  // "type alignment only" gates below. `manageContent` → write tools;
  // `readContent` → readNode.
  manageContent: true,
  readContent: true,
  // Per-agent value is ignored by dispatch (team-level toggle is canonical),
  // but the field is required on the schema. Same convention used by
  // `teamAgentsStore.DEFAULT_TOOL_TOGGLES`.
  customAgents: true,
  customWorkflows: true,
  customTools: true,
  // Team feature gate (inspector summary button) — carried for type
  // alignment only; never consumed per-agent.
  summarizeNodeInspector: true,
}

/**
 * The shipped presets. Order here is the order they render in pickers
 * — keep customer-facing ones first.
 */
export const BUILT_IN_AGENTS: ReadonlyArray<IBuiltInAgentDefinition> = [
  {
    id: "_researcher",
    name: "Researcher",
    description: "Grounded, cited workspace answers.",
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
      // No die rolls while researching.
      rollDice: false,
    },
  },
  {
    id: "_writer",
    name: "Writer",
    description: "Structured long-form drafts.",
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
      rollDice: false,
    },
  },
  {
    id: "_summarizer",
    name: "Summarizer",
    description: "Terse bullet-point summaries.",
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
      rollDice: false,
    },
  },
  {
    id: "_code",
    name: "Code helper",
    description: "Code edits with explained diffs.",
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
      rollDice: false,
    },
  },
] as const

/**
 * Wire-name for the team's **Default agent** — the persona a workflow runs
 * as when "Run as a specific agent" is off. Mirrors the server's
 * `DEFAULT_AGENT_ID` (`functions/src/agents.ts`). Starts with `_` so
 * `isBuiltInAgentId` recognizes it.
 */
export const DEFAULT_AGENT_ID = "_default"

/**
 * The Default agent definition. Deliberately kept OUT of `BUILT_IN_AGENTS`
 * (so it never shows in the chat composer's picker, which represents the
 * default as `null`) but merged into `BUILT_IN_AGENTS_BY_ID` so lookups —
 * e.g. rendering a workflow's "Default" selection — resolve it. The
 * workflow editor surfaces it explicitly as the top "Default" option.
 * Keep in sync with `DEFAULT_AGENT_DEFINITION` in
 * `functions/src/builtInAgents.ts`.
 */
export const DEFAULT_AGENT_DEFINITION: IBuiltInAgentDefinition = {
  id: DEFAULT_AGENT_ID,
  name: "Default",
  description:
    "Runs the workflow itself and hands off to a specialist agent when " +
    "one is better suited.",
  avatarSeed: "default",
  systemPromptBase:
    "You are the team's default automation agent. You run unattended as " +
    "part of a scheduled or triggered workflow, so there is no human to " +
    "ask — assess the provided context and the workflow's instructions, " +
    "then carry the task out end to end with the tools available to you. " +
    "You can read and edit workspace content. If a task would be handled " +
    "better by a specialist agent, or you hit something you can't do " +
    "yourself (a tool reports you lack permission, or it needs domain " +
    "expertise you don't have), hand off with `transferToAgent` to the " +
    "most suitable agent instead of stopping. Prefer the smallest, safest " +
    "change that satisfies the instructions; when torn between options, " +
    "pick the one most consistent with the existing content.",
  promptSuffixes: {
    auto: "",
    agent:
      "Chain tools as needed to finish the job. If you're blocked or a " +
      "specialist would do better, transfer to that agent and let them " +
      "continue rather than leaving the task half-done.",
    manual: "",
  },
  tools: {
    ...ALL_TOOLS_ENABLED,
    // No die rolls in an unattended automation.
    rollDice: false,
  },
}

/**
 * O(1) lookup map. The `_`-prefixed ids never collide with custom
 * agent ids (Firestore auto-ids are 20-char base64), so a single
 * id-keyed map can resolve both — caller decides by prefix or by
 * which map hit. Includes the Default agent so workflow UIs can resolve
 * a `_default` selection even though it isn't a togglable preset.
 */
export const BUILT_IN_AGENTS_BY_ID: Readonly<
  Record<string, IBuiltInAgentDefinition>
> = Object.freeze(
  Object.fromEntries(
    [...BUILT_IN_AGENTS, DEFAULT_AGENT_DEFINITION].map((agent) => [
      agent.id,
      agent,
    ])
  )
)

/**
 * Hydrate a built-in definition into a full `ITeamAgent` so consumers
 * can render it next to custom agents without branching. `teamId` is
 * threaded through because the rest of the codebase expects every
 * agent record to be team-scoped (e.g. avatar route logging,
 * activity panels).
 *
 * The synthetic `archivedAt: null` + `enabled: true` mirror the values
 * a real custom-agent doc would carry; the upstream filter
 * (`selectableAgents`) does the actual gating via the
 * `agentConfig.builtInAgents` toggle map.
 */
export function hydrateBuiltInAgent(
  teamId: string,
  definition: IBuiltInAgentDefinition
): ITeamAgent {
  const now = Timestamp.now()
  return {
    id: definition.id,
    teamId,
    name: definition.name,
    description: definition.description,
    avatarSeed: definition.avatarSeed,
    systemPromptBase: definition.systemPromptBase,
    promptSuffixes: { ...definition.promptSuffixes },
    tools: { ...definition.tools },
    // Built-in presets carry an empty customTools map — admins
    // currently have no editor surface to configure per-built-in
    // custom-tool overrides (only the team-level Switch toggles them
    // on/off). Empty `{}` relies on the dispatch-time `!== false`
    // check to mean "all enabled."
    customTools: {},
    enabled: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdByUid: "",
  }
}

/**
 * Convenience predicate. The `_` prefix is the load-bearing convention
 * — collisions with auto-generated ids are statistically impossible
 * (Firestore IDs start with [-A-Za-z0-9]) but the underscore makes
 * intent obvious to readers of dispatch code.
 */
export function isBuiltInAgentId(agentId: string | null | undefined): boolean {
  return typeof agentId === "string" && agentId.startsWith("_")
}

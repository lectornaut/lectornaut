/**
 * Team agent types.
 *
 * Custom-agent CRUD + lifecycle moved to the unified integrations surface
 * (`integrations.ts`, `teams/{teamId}/integrations`, `type == "agent"`). What
 * remains here is the canonical normalized `TeamAgentDoc` shape that the
 * dispatch machinery still speaks — `bot.ts` (persona + transfer roster),
 * `agents.ts` (`resolveActiveAgent`), and `builtInAgents.ts`
 * (`hydrateBuiltInAgent`) all map their inputs to/from this shape.
 */

interface TeamAgentToolToggles {
  rollDice: boolean
  browseInternet: boolean
  askQuestion: boolean
  searchWorkspaceNodes: boolean
  listWorkspaceNodes: boolean
  summarizeNode: boolean
  compareNodes: boolean
  findRelatedNodes: boolean
  manageContent: boolean
  readContent: boolean
}

interface TeamAgentPromptSuffixes {
  auto: string
  agent: string
  manual: string
}

/**
 * The normalized agent record dispatch consumes. Built-in personas are
 * hydrated into this shape from the code catalog; custom agents are mapped
 * into it from their integration doc (see `agentIntegrationToDoc` in
 * `bot.ts`). `enabled` × `archivedAt` form the lifecycle: active / disabled /
 * archived (deprecate-but-run) / deleted.
 */
interface TeamAgentDoc {
  id: string
  teamId: string
  name: string
  description: string
  avatarSeed: string
  systemPromptBase: string
  promptSuffixes: TeamAgentPromptSuffixes
  tools: TeamAgentToolToggles
  customTools: Record<string, boolean>
  enabled: boolean
  archivedAt: FirebaseFirestore.Timestamp | null
  createdAt: FirebaseFirestore.Timestamp
  updatedAt: FirebaseFirestore.Timestamp
  createdByUid: string
}

export type { TeamAgentDoc }

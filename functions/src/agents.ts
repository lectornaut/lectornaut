/**
 * Agent dispatch — selects which "agent" persona handles a chat turn,
 * and exposes cross-agent transfer to the model.
 *
 * Two flavors of agent switching:
 *
 *   1. **Persona swap (user-driven)**. The composer / sidebar surface
 *      a picker; the chosen agent flows through
 *      `SendBotMessageRequest.activeAgentId`, gets persisted on the
 *      session doc by `FirestoreBotSessionStore`, and sticks across
 *      turns + reloads. Re-opening a chat rehydrates the picker from
 *      the doc — same pattern as `lastModel`.
 *
 *   2. **Cross-agent transfer (model-driven)**. When at least one
 *      OTHER active agent exists, the dispatcher exposes a
 *      `transferToAgent` tool ([bot.ts](./bot.ts)) and appends a
 *      directive to the system prompt enumerating valid targets
 *      (`buildTransferDirective` below). If the model decides a
 *      different persona is better suited, it calls the tool with
 *      that agent's id; the tool handler writes the request into the
 *      shared action context, and the flow's post-turn step
 *      (`commitTransferIfRequested` in bot.ts) updates the session
 *      doc's `activeAgentId`. The new persona handles the *next*
 *      user message — true in-turn continuation (where Agent B's
 *      reply streams into the same bubble Agent A started) would
 *      need Genkit's prompt-as-tool pattern (cyclic graph, beta API
 *      limitations) and is deferred.
 *
 * Both flavors share the same persistence surface: `activeAgentId`
 * on the session doc is the source of truth, and the snapshot-driven
 * resync in `useBotChat` keeps the composer badge in sync regardless
 * of which side triggered the switch.
 */

import type { TeamAgentDoc } from "./teamAgents.js"

/**
 * Local mirror of `BOT_CHAT_MODES` from `bot.ts`. We re-declare instead
 * of importing to avoid a circular dependency (bot.ts imports from
 * agents.ts). Keep this in sync with the enum in `bot.ts` —
 * fortunately there are only ever a handful of modes so drift is easy
 * to catch in code review.
 */
type BotChatMode = "auto" | "agent" | "manual"

/**
 * Sentinel id for "no custom agent — use the team default persona".
 * Reserved at the dispatch layer; never written to Firestore. The
 * client treats `activeAgentId: null` and `activeAgentId: DEFAULT_AGENT_ID`
 * identically, but we use `null` on the wire to keep the persisted
 * value cleaner (no need to special-case a magic string in indexes).
 */
export const DEFAULT_AGENT_ID = "_default"

/**
 * Resolve which agent should handle the current turn. Returns the agent
 * record when one is dispatchable; returns `null` to mean "use the
 * team default persona".
 *
 * Lookup precedence:
 *   1. `requestedId` — the per-turn override from the composer (or
 *      sidebar avatar click). The client passes the agent it's
 *      currently displaying in the active-agent badge.
 *   2. `sessionPersistedId` — the value persisted on the session doc
 *      from the previous turn. Picks up the "sticky agent" across
 *      reloads (and across transfers committed by previous turns).
 *   3. `null` — default persona.
 *
 * State semantics — what causes a fallback to null (= default):
 *   - **deleted** (id not found in `availableAgents`): the agent's
 *     Firestore doc was hard-deleted. The session keeps its stale
 *     `activeAgentId` and the client renders a "Deleted" badge; the
 *     server silently dispatches the team default.
 *   - **disabled** (`agent.enabled === false`): admin flipped the
 *     row toggle off. Same fallback as deleted; client renders a
 *     "Disabled" badge. Re-enabling re-binds future turns
 *     automatically because the session doc never lost the id.
 *
 * State semantics — what KEEPS the agent dispatching:
 *   - **archived** (`agent.archivedAt` set, `enabled === true`):
 *     the archive flow now means "deprecate but keep running for
 *     ongoing chats". The agent is hidden from pickers but stays
 *     dispatchable. Client renders an "Archived" badge so the user
 *     sees that the persona is being phased out.
 *   - **active** (`enabled === true` AND `archivedAt === null`):
 *     the mainline case. Returns the agent record.
 *
 * Disabled trumps archived when both apply (no display difference at
 * the dispatch boundary — disabled is just a stronger gate).
 */
export function resolveActiveAgent(args: {
  requestedId: string | null | undefined
  sessionPersistedId: string | null | undefined
  availableAgents: TeamAgentDoc[]
}): TeamAgentDoc | null {
  const candidate = normalizeAgentId(
    args.requestedId ?? args.sessionPersistedId ?? null
  )
  if (!candidate) return null

  const match = args.availableAgents.find((agent) => agent.id === candidate)
  if (!match) return null
  // Disabled gates the agent out of dispatch even though archived
  // agents stay dispatchable. The order of these checks is load-
  // bearing: an agent that's both disabled AND archived is treated
  // as disabled (the stronger gate wins).
  if (match.enabled === false) return null
  // Note: archived agents fall through. Their behavior is identical
  // to active agents at the dispatch layer — the "archived" label
  // exists for *user-facing* deprecation signaling, not for cutting
  // off ongoing conversations.
  return match
}

/**
 * Build the system prompt for a turn given the resolved active agent
 * (or `null` for the team default). When an agent is active, its
 * persona *replaces* the team's `systemPromptBase` rather than
 * appending — keeps each agent's persona auditable end-to-end in one
 * field instead of layered concatenation that can subtly override.
 *
 * The mode suffix is still appended after the base (whether team or
 * agent), so an agent's "agent mode" suffix steers tool-use behavior
 * the same way the team default would.
 */
export function buildAgentSystemPrompt(args: {
  agent: TeamAgentDoc | null
  teamBaseSystem: string
  teamModeSuffix: string
  mode: BotChatMode
  /**
   * Other active agents the current one can transfer to via the
   * `transferToAgent` tool. When non-empty, the system prompt gains a
   * directive enumerating them so the model knows what targets it can
   * pass to the tool. Empty/undefined disables the directive
   * regardless of whether `transferToAgent` is in the tool list.
   *
   * The active agent itself is excluded by the caller (transfer to
   * self would be a no-op the model shouldn't be tempted to attempt).
   * The synthetic team-default is included as `id: ""` so the model
   * can transfer back even when no real agent is the "default" yet.
   */
  otherAgents?: ReadonlyArray<{
    id: string
    name: string
    description: string
  }>
}): string {
  const { agent, teamBaseSystem, teamModeSuffix, mode, otherAgents } = args
  const directive = buildTransferDirective(otherAgents)
  const base = !agent
    ? // Default persona — replicate the team's prior behavior exactly.
      teamModeSuffix
      ? `${teamBaseSystem}\n\n${teamModeSuffix}`
      : teamBaseSystem
    : agent.promptSuffixes?.[mode]
      ? `${agent.systemPromptBase}\n\n${agent.promptSuffixes[mode]}`
      : agent.systemPromptBase
  return directive ? `${base}\n\n${directive}` : base
}

/**
 * Produce the transfer directive paragraph appended to an agent's
 * system prompt. Two flavors depending on whether transfer targets
 * exist:
 *
 *   - **Targets available**: enumerates each one (id + label +
 *     description) so the model can match the user's request against
 *     the roster and pick the right `agentId` to pass to
 *     `transferToAgent`. Closes with an anti-hallucination clause
 *     reminding the model that narrating a handoff is meaningless
 *     unless the tool actually runs.
 *
 *   - **No targets**: emits a short negative directive ("you are the
 *     only agent — don't claim to transfer") instead of nothing.
 *     The hazard this guards against: models trained on multi-agent
 *     transcripts learn the narrative pattern *"let me hand you off
 *     to X"* and will produce it in prose even when no transfer tool
 *     exists. Without this clause, the model emits a fake handoff,
 *     the user's session-doc `activeAgentId` stays null (no tool
 *     fired → no commit), and the composer badge stays on Default
 *     while the user sits waiting for an agent that will never
 *     answer — a confusing "broken handoff" experience.
 *
 * Always returns a non-empty string now (was previously `""` in the
 * no-targets case). Callers can drop their ternary guard.
 */
export function buildTransferDirective(
  otherAgents?: ReadonlyArray<{
    id: string
    name: string
    description: string
  }>
): string {
  if (!otherAgents || otherAgents.length === 0) {
    // No transfer targets in this turn — the `transferToAgent` tool
    // is NOT wired into the model's catalog (see
    // [bot.ts:1290-1298]). Still emit a guard so the model doesn't
    // narrate a transfer in prose: from the user's side an
    // un-committed handoff looks broken (badge stays on Default,
    // session doc unchanged), and we have no recovery path because
    // the tool the model didn't call also doesn't exist on this turn.
    return (
      "You are the only agent available to handle this conversation. " +
      "Do not tell the user you are transferring, routing, or handing " +
      "them off to another agent or specialist — there is no other " +
      "agent to receive the handoff, and a transfer can only happen " +
      "via a tool call (which is not available this turn). Answer the " +
      "user's question yourself; if it's outside your expertise, say " +
      "so plainly rather than gesturing at a handoff that won't happen."
    )
  }
  const roster = otherAgents
    .map((agent) => {
      // Use the id verbatim — the model needs the exact string to call
      // `transferToAgent`. Wrap in backticks so the model treats it as
      // a literal and doesn't paraphrase. Empty id = team default.
      const idLabel =
        agent.id === "" ? "`''` (team default)" : `\`${agent.id}\``
      const description = agent.description.trim()
        ? ` — ${agent.description.trim()}`
        : ""
      return `- ${agent.name} (id: ${idLabel})${description}`
    })
    .join("\n")
  return (
    "You can transfer the conversation to a teammate agent when a " +
    "different persona is better suited to the user's request. Call " +
    "`transferToAgent({ agentId, reason })` with one of these ids:\n\n" +
    `${roster}\n\n` +
    "Only transfer when the new persona is materially better-suited — " +
    "don't bounce the user around for marginal improvements. Your " +
    "current turn finishes normally; the new agent picks up on the " +
    "user's next message.\n\n" +
    "Critical: the handoff only happens when you actually call " +
    "`transferToAgent`. Do not tell the user you are transferring, " +
    "routing, or handing them off unless you are calling the tool in " +
    "the same turn. Narrating a transfer without the tool call leaves " +
    "the user stranded on the current agent with no visible state " +
    "change — they see the sentence, but nothing else happens. If you " +
    "decide NOT to transfer, just answer the question; do not invent " +
    "a handoff as a polite deflection."
  )
}

/**
 * Normalize the client-facing `activeAgentId` value. The wire format
 * accepts `null`, `undefined`, or a real id; we never want
 * `DEFAULT_AGENT_ID` to land in Firestore because it's a dispatch
 * sentinel — strip it here and store/treat as `null` instead.
 */
function normalizeAgentId(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === DEFAULT_AGENT_ID) return null
  return value
}

/**
 * Same normalization, exported for callable inputs and the
 * `FirestoreBotSessionStore` to share a single source of truth on what
 * gets persisted (real ids only — never the sentinel).
 */
export const normalizeActiveAgentIdForStorage = normalizeAgentId

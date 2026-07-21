/**
 * botChatStream — the pure reducer that turns a bot-chat stream into the
 * client's rendered message view-model.
 *
 * This module owns the **view-model** (`BotChatMessage` and its segments)
 * and the **chunk reducer** (`applyStreamChunk`) that the `useBotChat`
 * composable drives as `sendBotMessage.stream(...)` / `respondToBotInterrupt`
 * emit `SendBotMessageStreamChunk`s. It is deliberately Vue-free:
 *
 *   - It mutates the agent message **in place**. Object identity is
 *     load-bearing for the chat renderer (its markdown parse cache keys on
 *     the message object), and Vue's reactivity is Proxy-based, so mutating
 *     a property works identically whether the array element is a reactive
 *     proxy or a plain object. The composable passes `messages.value`; a
 *     test passes a plain array. Same code path.
 *   - It returns out-of-band **effects** (`sessionId`, `agentTransfer`)
 *     rather than writing reactive refs. The Vue layer is the only place
 *     that knows about `sessionId.value` / `activeAgentId.value`, so it
 *     keeps the "only write if changed" guards; this module just reports
 *     what the chunk implied.
 *
 * Keeping the reducer pure makes the chunk-routing, the tool-call dedupe,
 * the ref-fallback result matching, and the `transferToAgent` pivot
 * unit-testable without mounting a component.
 */

import type { SendBotMessageStreamChunk } from "@/composables/useFunctions"

export type BotChatRole = "user" | "agent"

/**
 * Tool invocation captured on an agent message.
 *
 * `output` is `undefined` in two states:
 *   - During streaming, when a normal tool is still running on the
 *     server (rare — execution is fast).
 *   - When `isInterrupt` is true, meaning the chat is paused waiting
 *     for the user to fill in a form. The renderer uses the flag to
 *     pick between a "Running…" spinner and an interactive prompt.
 *
 * `ref` correlates the toolCall stream event with its matching
 * toolResult event (and with the resume callable's input).
 */
export interface BotChatToolCall {
  ref?: string
  name: string
  input?: unknown
  output?: unknown
  /**
   * Set when this is a paused Human-in-the-Loop interrupt awaiting user
   * input. Cleared once the user submits an answer (the segment then
   * carries the answer as `output`).
   */
  isInterrupt?: boolean
}

/**
 * One slice of an agent message: either a text run or a tool invocation.
 * The renderer walks segments in order and switches between markdown
 * bubbles and tool-call cards. User messages stay flat (no segments) —
 * they're always a single text run.
 */
export type BotChatSegment =
  { kind: "text"; text: string } | { kind: "tool"; tool: BotChatToolCall }

export interface BotChatMessage {
  // Stable client-side id for `v-for :key` and parse-tree memoization in
  // the chat view. Not persisted — every snapshot reconcile mints fresh
  // ids, which is fine because the array is rebuilt wholesale at that
  // point and the WeakMap parse cache resets along with it.
  id: string
  role: BotChatRole
  content: string
  /**
   * `"error"` when this agent turn ended in a server-side graceful
   * fallback (turn deadline, tool budget, missing tool, invalid tool
   * args). Set live by the stream chunk that carried the fallback text,
   * and on reconcile from the persisted message. The chat surface renders
   * these as failure bubbles instead of normal replies. Never set on user
   * messages.
   */
  status?: "error"
  /** Present on agent messages with tool calls; absent for plain text. */
  segments?: BotChatSegment[]
  /**
   * Firebase uid of the human who sent this message. Only populated for
   * user-role messages — agent turns have no human author. Drives
   * per-sender avatar rendering so shared/public sessions, where
   * multiple admins can post, attribute each turn to the right person.
   * Undefined on legacy messages (saved before authorship was tracked
   * server-side); the UI falls back to the session's `ownerUid` then.
   */
  authorUid?: string
}

/**
 * Out-of-band signals a chunk implied that live outside the message
 * view-model — the composable applies them to its reactive refs.
 *
 * Both are reported as facts ("the chunk carried this"), not commands:
 * the Vue layer keeps the "write only if changed" guards because it owns
 * the refs being compared against.
 */
export interface BotChatStreamEffects {
  /**
   * Present when the chunk carried a session id. The server pins it on
   * the very first chunk of a brand-new chat; the composable flips the
   * URL early so the chat is linkable before the reply finishes.
   */
  sessionId?: string
  /**
   * Present when a `transferToAgent` tool call implied an active-agent
   * pivot. `agentId: null` is the "back to the team default persona"
   * sentinel. The whole key being **absent** means "no transfer this
   * chunk" — distinct from `{ agentId: null }`.
   */
  agentTransfer?: { agentId: string | null }
}

/**
 * Construct a fresh `BotChatMessage`, deep-cloning segments so reactive
 * mutations on this instance don't leak back into the caller's object
 * (e.g. server snapshot data passed into
 * `messages.value = serverMessages.map(createMessage)`). The `tool`
 * spread copies `isInterrupt` automatically so paused HITL prompts
 * round-trip correctly through Firestore reconciles.
 */
export const createMessage = (m: {
  role: BotChatRole
  content: string
  status?: "error"
  segments?: BotChatSegment[]
  authorUid?: string
}): BotChatMessage => ({
  id: crypto.randomUUID(),
  role: m.role,
  content: m.content,
  status: m.status,
  authorUid: m.authorUid,
  segments: m.segments
    ? m.segments.map((s) =>
        s.kind === "text"
          ? { kind: "text", text: s.text }
          : { kind: "tool", tool: { ...s.tool } }
      )
    : undefined,
})

/**
 * Detect whether a tool call is a `transferToAgent` pivot and, if so,
 * resolve the target persona.
 *
 * Returns `null` when the call is not a transfer (any other tool, or a
 * malformed payload). Returns `{ agentId }` when it is — where `""`, the
 * server's "transfer back to the team default persona" sentinel (matches
 * `normalizeActiveAgentIdForStorage`), maps to `null`.
 *
 * Kept separate from the segment push so the composable can pivot its
 * composer badge the instant the model emits the toolRequest — long
 * before the server's post-turn `SessionStore.save` writes `activeAgentId`
 * to Firestore and the snapshot makes it back (~100–400ms of round-trip).
 */
export const detectAgentTransfer = (call: {
  name: string
  input?: unknown
}): { agentId: string | null } | null => {
  if (call.name !== "transferToAgent") return null
  if (!call.input || typeof call.input !== "object") return null
  const rawAgentId = (call.input as { agentId?: unknown }).agentId
  if (typeof rawAgentId !== "string") return null
  return { agentId: rawAgentId === "" ? null : rawAgentId }
}

/**
 * Append a streamed text delta to the agent message at `agentIndex`,
 * growing the trailing text segment in place so its identity stays
 * stable. Keeping segment identity stable lets Vue's reactive diff skip
 * nodes that didn't change (the markdown parse cache keys off the message
 * object, not the segment, but stable segments still help the diff).
 *
 * No-op when the slot isn't an agent message (defensive against a
 * mid-stream array reconcile) or carries no `segments` array.
 */
const appendStreamText = (
  messages: BotChatMessage[],
  agentIndex: number,
  text: string
): void => {
  const agent = messages[agentIndex]
  if (agent?.role !== "agent") return
  agent.content += text
  const segments = agent.segments
  if (!segments) return
  const last = segments[segments.length - 1]
  if (last && last.kind === "text") {
    last.text += text
  } else {
    segments.push({ kind: "text", text })
  }
}

/**
 * Splice a tool call into the agent message at `agentIndex` and report
 * any active-agent pivot it implied.
 *
 * The transfer is detected **first**, unconditionally — it must fire even
 * if the slot guard or the dedupe below short-circuit the segment push,
 * because the composer badge pivot is independent of whether the card
 * renders. Dedupe keys on `ref` (always present in practice): the server
 * sweeps `final.messages` after the live stream and may resend events.
 */
const applyStreamToolCall = (
  messages: BotChatMessage[],
  agentIndex: number,
  call: {
    ref?: string
    name: string
    input?: unknown
    isInterrupt?: boolean
  }
): { agentId: string | null } | null => {
  const transfer = detectAgentTransfer(call)

  const agent = messages[agentIndex]
  if (agent?.role !== "agent") return transfer
  const segments = agent.segments
  if (!segments) return transfer
  if (
    call.ref &&
    segments.some((s) => s.kind === "tool" && s.tool.ref === call.ref)
  ) {
    return transfer
  }
  segments.push({
    kind: "tool",
    tool: {
      ref: call.ref,
      name: call.name,
      input: call.input,
      output: undefined,
      // Pass through the HITL flag so the renderer draws an interactive
      // form instead of a spinner. `applyStreamToolResult` will drop the
      // flag when an answer lands.
      ...(call.isInterrupt ? { isInterrupt: true } : {}),
    },
  })
  return transfer
}

/**
 * Resolve a tool's result onto its pending call card in place, flipping
 * it from "running" to "done" without unmounting.
 *
 * Matches by `ref` first (precise); falls back to "newest pending tool
 * segment with the same name" when `ref` is missing. A result with no
 * matching call (shouldn't happen in practice) pushes a synthetic
 * completed card so nothing is lost.
 */
const applyStreamToolResult = (
  messages: BotChatMessage[],
  agentIndex: number,
  result: {
    ref?: string
    name: string
    output?: unknown
  }
): void => {
  const agent = messages[agentIndex]
  if (agent?.role !== "agent") return
  const segments = agent.segments
  if (!segments) return
  const target =
    (result.ref &&
      segments.find(
        (s): s is Extract<BotChatSegment, { kind: "tool" }> =>
          s.kind === "tool" && s.tool.ref === result.ref
      )) ||
    [...segments]
      .reverse()
      .find(
        (s): s is Extract<BotChatSegment, { kind: "tool" }> =>
          s.kind === "tool" &&
          s.tool.name === result.name &&
          s.tool.output === undefined
      )
  if (target) {
    // Mutate output in place so the existing tool-card component
    // transitions from "running" to "done" without unmounting. If this
    // was a paused interrupt, the answer lands here and we drop the flag
    // so the form is replaced by the completed-card view.
    target.tool.output = result.output
    delete target.tool.isInterrupt
  } else {
    segments.push({
      kind: "tool",
      tool: {
        ref: result.ref,
        name: result.name,
        output: result.output,
      },
    })
  }
}

/**
 * Apply one `SendBotMessageStreamChunk` to the agent message at
 * `agentIndex`, mutating its text/segments in place and returning the
 * out-of-band effects the chunk implied.
 *
 * `agentIndex` is resolved against `messages` on every call (rather than
 * captured as a reference) so a mid-stream array reconcile that rebuilds
 * the slot is picked up transparently. Any combination of chunk fields
 * may be present — they're routed independently, matching the server's
 * "any subset set" contract.
 */
export const applyStreamChunk = (
  messages: BotChatMessage[],
  agentIndex: number,
  chunk: SendBotMessageStreamChunk
): BotChatStreamEffects => {
  const effects: BotChatStreamEffects = {}
  if (chunk.sessionId) effects.sessionId = chunk.sessionId
  if (chunk.chunk) appendStreamText(messages, agentIndex, chunk.chunk)
  if (chunk.status === "error") {
    // The turn ended in a server-side graceful fallback — flip the
    // streaming bubble to its failure rendering in place (same identity
    // rules as the text append above).
    const agent = messages[agentIndex]
    if (agent?.role === "agent") agent.status = "error"
  }
  if (chunk.toolCall) {
    const transfer = applyStreamToolCall(messages, agentIndex, chunk.toolCall)
    if (transfer) effects.agentTransfer = transfer
  }
  if (chunk.toolResult)
    applyStreamToolResult(messages, agentIndex, chunk.toolResult)
  return effects
}

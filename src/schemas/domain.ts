import { z } from "zod"
import {
  timestampHydratedSchema,
  timestampInputSchema,
  timestampSchema,
} from "./_primitives"

/**
 * Domain schemas — the canonical Firestore document shapes for users, teams,
 * workspaces, and their preferences.
 *
 * Each entity exports a read schema and (where applicable) a write schema:
 *   - `fooSchema` (read): strict, Timestamp instances only. Consumed by
 *     the `zodConverter` inside `firebase-helpers.ts`.
 *   - `fooWriteSchema` (write): loosens Timestamp fields to accept FieldValue
 *     sentinels like `serverTimestamp()`, and makes id fields optional since
 *     payloads may or may not carry them.
 *
 * Note: this file intentionally exports only schema values, not inferred
 * TypeScript types. The `src/types/*.ts` modules remain the canonical home
 * for the `I*` interfaces during PR 2 — they become `z.infer` aliases in PR 3.
 */

// ─── Billing ─────────────────────────────────────────────────────────────────

export const billingPlanKeySchema = z.enum([
  "personal",
  "professional",
  "business",
  "enterprise",
])

export const billingIntervalSchema = z.enum(["month", "year"])

export const teamBillingSchema = z.object({
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  stripeScheduleId: z.string().nullable(),
  planKey: billingPlanKeySchema.nullable(),
  interval: billingIntervalSchema.nullable(),
  priceId: z.string().nullable(),
  quantity: z.number().nullable(),
  status: z.string().nullable(),
  currentPeriodEnd: z.number().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  lastInvoiceId: z.string().nullable(),
  lastInvoiceStatus: z.string().nullable(),
  lastStripeEventId: z.string().nullable(),
  lastStripeEventCreated: z.number().nullable(),
  isEntitled: z.boolean(),
  updatedAt: timestampSchema.optional(),
})

// ─── User / UserProfile ──────────────────────────────────────────────────────

export const userProfileSchema = z.object({
  uid: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  photoURL: z.string().nullable(),
  username: z.string().nullable(),
  isPublic: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

/**
 * `IUser` is aliased to `IUserProfile` in the existing domain types, so the
 * user-doc schema is the same as the profile schema. Exposed under both names
 * for parity with `src/types/domain.ts`.
 */
export const userSchema = userProfileSchema

export const userWriteSchema = userProfileSchema.extend({
  uid: z.string().optional(),
  createdAt: timestampInputSchema,
  updatedAt: timestampInputSchema,
})

// ─── User preferences ────────────────────────────────────────────────────────

export const userPreferencesSchema = z.object({
  currentTeamId: z.string().nullable(),
  onboarding: z.boolean(),
  updatedAt: timestampSchema.optional(),
})

export const userPreferencesWriteSchema = userPreferencesSchema.extend({
  updatedAt: timestampInputSchema.optional(),
})

// ─── Team ────────────────────────────────────────────────────────────────────

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  photoURL: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  billing: teamBillingSchema.partial().nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const teamWriteSchema = teamSchema.extend({
  id: z.string().optional(),
  billing: teamBillingSchema
    .extend({ updatedAt: timestampInputSchema.optional() })
    .partial()
    .nullable()
    .optional(),
  createdAt: timestampInputSchema,
  updatedAt: timestampInputSchema,
})

// ─── Workspace ───────────────────────────────────────────────────────────────

export const workspaceSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  photoURL: z.string().nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const workspaceWriteSchema = workspaceSchema.extend({
  id: z.string().optional(),
  teamId: z.string().optional(),
  createdAt: timestampInputSchema,
  updatedAt: timestampInputSchema,
})

// ─── Membership-scoped preferences ───────────────────────────────────────────

export const membershipPreferencesSchema = z.object({
  currentWorkspaceId: z.string().nullable(),
  updatedAt: timestampSchema.optional(),
})

export const membershipPreferencesWriteSchema =
  membershipPreferencesSchema.extend({
    updatedAt: timestampInputSchema.optional(),
  })

// ─── Username claims ─────────────────────────────────────────────────────────

export const usernameClaimSchema = z.object({
  entityType: z.enum(["user", "team"]),
  entityId: z.string(),
  createdAt: timestampSchema.optional(),
})

// ─── Hydration variants (for useLocalHydration) ──────────────────────────────

/**
 * Hydration variants accept BOTH real Timestamp instances AND their
 * JSON-serialized form (`{ seconds, nanoseconds }`) as input, and produce
 * a real Timestamp on output via `timestampHydratedSchema`'s `.transform()`.
 *
 * This is needed because `JSON.stringify(Timestamp)` strips the class
 * identity, so anything written to localStorage round-trips as a plain
 * object. Without these variants, cached optimistic state would either
 * fail validation (too strict) or silently hold a plain object where a
 * Timestamp is expected (current bug).
 *
 * Output types are structurally identical to the non-hydration variants —
 * callers can treat `userHydrationSchema` and `userSchema` as producing
 * the same `IUser` shape.
 */

export const userHydrationSchema = userProfileSchema.extend({
  createdAt: timestampHydratedSchema,
  updatedAt: timestampHydratedSchema,
})

export const userPreferencesHydrationSchema = userPreferencesSchema.extend({
  updatedAt: timestampHydratedSchema.optional(),
})

export const membershipPreferencesHydrationSchema =
  membershipPreferencesSchema.extend({
    updatedAt: timestampHydratedSchema.optional(),
  })

export const workspaceHydrationSchema = workspaceSchema.extend({
  createdAt: timestampHydratedSchema,
  updatedAt: timestampHydratedSchema,
})

export const workspacesHydrationSchema = z.array(workspaceHydrationSchema)

// ─── Bot Session ─────────────────────────────────────────────────────────────

/**
 * Bot chat session visibility:
 *   - private: only the owner can read/write (default).
 *   - shared:  any team member can read; only owner + team admins can write.
 *   - public:  anyone with the URL can read (deferred — schema-only for now).
 */
export const botSessionVisibilitySchema = z.enum([
  "private",
  "shared",
  "public",
])

/**
 * Flat client-facing role for messages stored on the session doc.
 * Different from Genkit's internal MessageData (which uses "model" not
 * "agent" and supports multipart content): we denormalize a simple
 * `{role, content}` array on save so the client can render directly
 * from the snapshot without parsing the SessionData blob.
 */
export const botChatRoleSchema = z.enum(["user", "agent"])

/**
 * Tool invocation captured on an agent message. `input` is the JSON the
 * model passed to the tool; `output` is what the tool returned. `output`
 * may be `undefined` while a call is still pending (only happens during
 * streaming — persisted messages always have it set). `ref` correlates
 * the request half with the response half across Genkit's internal
 * model→tool→model round-trip.
 */
export const botToolCallSchema = z.object({
  ref: z.string().optional(),
  name: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  /**
   * When true, this tool call paused the chat for human input
   * (Genkit's `defineInterrupt` primitive). The UI renders an
   * interactive form instead of a "Running…" spinner. Cleared once
   * `output` is set, since the interrupt has been resolved by then.
   */
  isInterrupt: z.boolean().optional(),
})

/**
 * One slice of an agent message. Genkit messages are multipart (text +
 * tool requests/responses interleaved), and we mirror that on the wire
 * so the chat UI can render tool calls as cards inline with text. User
 * messages are always a single text segment.
 */
export const botMessageSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("tool"), tool: botToolCallSchema }),
])

export const botSessionMessageSchema = z.object({
  role: botChatRoleSchema,
  /** Concatenated text — used for sidebar previews and as a fallback. */
  content: z.string(),
  /**
   * Structured parts. Present on agent messages that include tool calls,
   * absent for plain text-only messages (and all legacy messages saved
   * before this field existed). When absent, the renderer falls back to
   * a single `content` text bubble.
   */
  segments: z.array(botMessageSegmentSchema).optional(),
  /**
   * The Firebase uid of the human who sent this message. Only populated
   * for user-role messages (agent messages have no human author). Drives
   * per-message avatar rendering in shared/public sessions where the
   * session's `ownerUid` is no longer a safe proxy — admins can also
   * post into shared chats, so the owner-uid heuristic would falsely
   * attribute their turns to the chat creator.
   *
   * Absent on legacy messages saved before this field existed; the UI
   * falls back to the session's `ownerUid` for those.
   */
  authorUid: z.string().optional(),
})

/**
 * Bot chat session metadata. The full Genkit `SessionData` blob lives in
 * `data` and is round-tripped opaquely by the server-side `SessionStore`.
 * The other fields are derived on each save so the history sidebar can
 * render without parsing the blob client-side.
 *
 * Sessions written before the visibility field existed have no value on
 * disk — the schema's `.default("private")` keeps them owner-only at the
 * type layer without a data migration.
 */
// ─── Workspace agent (bot) config ────────────────────────────────────────────

export const botAgentProviderSchema = z.enum(["google", "anthropic", "openai"])

export const botAgentProviderTogglesSchema = z.object({
  google: z.boolean(),
  anthropic: z.boolean(),
  openai: z.boolean(),
})

/**
 * Models the bot can be pinned to, spanning all three providers. Mirrors
 * the server-side allowlist in `functions/src/bot.ts` (`BOT_AGENT_MODELS`)
 * — keep the two in sync. The UI catalog (label/description/provider
 * per model) lives in `helpers/defaults.ts`. Wire-name prefixes are
 * load-bearing — the server's `resolveModel()` dispatches by prefix
 * (`gemini-*` → Google, `claude-*` → Anthropic, `gpt-*` → OpenAI).
 */
export const botAgentModelSchema = z.enum([
  // Google Gemini
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  // Anthropic Claude
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  // OpenAI
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
])

/**
 * Per-model availability toggles. Layered on top of `providers`: a model
 * is *available* iff its provider is enabled AND its toggle is true.
 * The server normalizes missing keys to `true` on read, so a newly-added
 * model id starts enabled even for teams whose config doc predates it.
 */
export const botAgentModelTogglesSchema = z.record(
  botAgentModelSchema,
  z.boolean()
)

/**
 * Per-tool feature flags. Disabled tools are simply not registered with
 * the chat — the model never sees them in its tool catalog.
 */
export const botAgentToolTogglesSchema = z.object({
  getWeather: z.boolean(),
  rollDice: z.boolean(),
  /**
   * Interrupt tool. When false, the bot can't pause to ask the user a
   * clarifying question — useful for non-interactive workflows.
   */
  askQuestion: z.boolean(),
  /**
   * Semantic search over workspace nodes (RAG). Read-only so it's
   * exposed in every mode, including `manual`. Disable to keep chats
   * grounded only in the user's explicitly-attached context.
   */
  searchWorkspaceNodes: z.boolean(),
  /**
   * Structured-output summarization of a workspace node from chat.
   * Read-only so it's exposed in every mode. Mirrors the inspector's
   * "Generate summary" button — disable to remove the chat-driven
   * route only (the inspector button keeps working).
   */
  summarizeNode: z.boolean(),
})

/**
 * The bot's chat-mode options. Mirrors `BOT_CHAT_MODES` on the server
 * and `BotChatMode` on the client; duplicated here so the agent config
 * type carries it cleanly without a circular import.
 */
export const botAgentDefaultModeSchema = z.enum(["auto", "agent", "manual"])

/**
 * Effective workspace agent config — every field is required because
 * the server fills missing fields with defaults before returning. The
 * UI form binds against this shape.
 */
export const botAgentConfigSchema = z.object({
  providers: botAgentProviderTogglesSchema,
  models: botAgentModelTogglesSchema,
  model: botAgentModelSchema,
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  topK: z.number().int().min(1).max(100),
  maxOutputTokens: z.number().int().min(256).max(65536),
  defaultMode: botAgentDefaultModeSchema,
  systemPromptBase: z.string().max(4000),
  promptSuffixes: z.object({
    auto: z.string().max(2000),
    agent: z.string().max(2000),
    manual: z.string().max(2000),
  }),
  tools: botAgentToolTogglesSchema,
  titleMaxLength: z.number().int().min(20).max(200),
  previewMaxLength: z.number().int().min(50).max(500),
})

export const botSessionSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  workspaceId: z.string(),
  ownerUid: z.string(),
  title: z.string().optional(),
  preview: z.string().optional(),
  messageCount: z.number().optional(),
  /**
   * Denormalized flat list of user/agent messages. Populated on every
   * SessionStore.save so clients can subscribe to the doc and render
   * the conversation in real-time without unpacking the SessionData
   * blob. Empty array is valid (a session with no messages yet).
   */
  messages: z.array(botSessionMessageSchema).optional(),
  visibility: botSessionVisibilitySchema.default("private"),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
  /** Set when archived; null/undefined when active. */
  archivedAt: timestampSchema.nullable().optional(),
  /**
   * Composite key `${ownerUid}:${scope}:${nodeId}` for single-equality
   * Firestore queries against the chat's pinned node. Written once on
   * session creation when launched from a node inspector tab; never
   * overwritten. The pinned node itself lives as a normal entry inside
   * `contextNodes` — this string only exists to power
   * `findBotSessionByPinnedNode`'s indexed lookup.
   */
  pinnedNodeKey: z.string().optional(),
  /**
   * Complete chip set the user has attached to this chat. Re-written
   * on every send so detaches propagate to the doc. Includes the
   * pinned node, if any. Empty array means "no attachments this turn";
   * `undefined` on a session doc means the chip list isn't known yet
   * (cold-load race or pre-feature doc) and the UI shows no chips.
   */
  contextNodes: z
    .array(
      z.object({
        scope: z.enum(["code", "write"]),
        nodeId: z.string(),
      })
    )
    .optional(),
  /**
   * Most recent turn's mode. Written by `FirestoreBotSessionStore.save`
   * on every save and overwritten by subsequent turns. Drives the
   * mode filter in the history sidebar; absent on sessions created
   * before the field was introduced — treat as "unknown" in filters,
   * not as a specific mode.
   */
  lastMode: z.enum(["auto", "agent", "manual"]).optional(),
  /**
   * Most recent turn's model. Written by `FirestoreBotSessionStore.save`
   * on every save and overwritten by subsequent turns. Used to rehydrate
   * the composer's model picker when the user re-opens a chat, so the
   * conversation continues on whichever model the last turn ran on
   * (rather than snapping back to the team's admin default each visit).
   * Absent on sessions created before the field was introduced — the
   * client falls back to the team's default model in that case. The
   * server validates against the team's current provider/model allowlist
   * before writing, so a model an admin has since disabled cannot be
   * persisted further (the next send falls back to the team default
   * and overwrites this field accordingly).
   */
  lastModel: botAgentModelSchema.optional(),
})

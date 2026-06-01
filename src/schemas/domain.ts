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
 * callers can treat a hydration schema and its base schema as producing
 * the same output shape.
 */

export const userPreferencesHydrationSchema = userPreferencesSchema.extend({
  updatedAt: timestampHydratedSchema.optional(),
})

export const membershipPreferencesHydrationSchema =
  membershipPreferencesSchema.extend({
    updatedAt: timestampHydratedSchema.optional(),
  })

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
  // Anthropic Claude
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  // OpenAI
  "gpt-5",
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
  rollDice: z.boolean(),
  /**
   * Live web search via Gemini's Google Search grounding. Its own
   * capability axis: the tool's handler always grounds through Gemini,
   * so it works regardless of the team's selected chat model — it only
   * needs the server-side Gemini key (surfaced in the UI as using
   * Google under the hood). Read-only, so it's exposed in every mode.
   */
  browseInternet: z.boolean(),
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
  /**
   * Multi-document comparison (`compareNodes` in
   * `functions/src/botCompare.ts`). Loads 2–5 workspace nodes and
   * produces a structured contrast — overview, points of agreement,
   * points of disagreement, per-node unique contributions. Read-only,
   * available in every mode. Uses the team's chat model (no
   * provider-specific gate). Default true.
   */
  compareNodes: z.boolean(),
  /**
   * Nearest-neighbor lookup (`findRelatedNodes` in
   * `functions/src/botLink.ts`). Reuses a source node's pre-computed
   * embedding as the query vector — no per-call embed cost, works
   * even when Google is disabled as a chat provider (embeddings are
   * server infrastructure, computed asynchronously by the embed-on-
   * write triggers). The sidebar's matching callable lives alongside
   * the chat tool but ISN'T gated by this toggle — it's a UI surface,
   * not a model-callable tool. Default true.
   */
  findRelatedNodes: z.boolean(),
  /**
   * Gate for the agent node-WRITE tools (create / edit / rename / move /
   * archive workspace files & folders — `NODE_WRITE_TOOLS` in
   * `functions/src/botNodeTools.ts`). Unlike the keys above this is NOT a
   * single model-callable tool but a switch over a block, so it's excluded
   * from `BotToolName` / the composer slash menu (like `customTools`).
   *
   * Two surfaces both bind this key:
   *   - team-wide, in Settings → Tools (`agentConfig.tools.manageContent`);
   *   - per-agent, in the agent editor (`agent.tools.manageContent`).
   * They intersect with each other AND with the membership gate: the write
   * tools register only when the driving user AND the active agent are
   * each content-capable members (`MANAGE_WORKSPACE_CONTENT`) AND both
   * toggles allow. Off at either layer removes the write tools and the
   * matching system-prompt directive. Server normalizes a missing key to
   * `true`, so existing teams/agents keep node editing.
   */
  manageContent: z.boolean(),
  /**
   * Sibling read gate for the node-READ tool (`readNode` —
   * `NODE_READ_TOOLS`), which returns a file's FULL current content
   * (whereas `searchWorkspaceNodes` returns only snippets). Split from
   * `manageContent` so an agent can be allowed to READ workspace content
   * without being granted edit rights: this gates on `READ_WORKSPACE`
   * (held by every role, including guests) rather than
   * `MANAGE_WORKSPACE_CONTENT`. Same two surfaces + team×agent×membership
   * intersection as `manageContent`. Normalizes missing → `true`.
   */
  readContent: z.boolean(),
  /**
   * Team-wide gate for the entire custom-agents feature. When false:
   *   - Pickers (sidebar + composer agent row) hide entirely.
   *   - Server dispatch ignores any session-persisted `activeAgentId`
   *     and falls back to the team default persona.
   *   - Cross-agent transfer roster is empty (the model never sees
   *     `transferToAgent` in its tool catalog).
   *   - Settings page Tools-row cog button is disabled.
   *
   * Lives in the `tools` object because the UI surfaces it inside the
   * Tools section of the team's agent settings — admins think of
   * custom agents as a *category* of tooling the team can opt into
   * or out of. Per-agent records carry this field too (the schema is
   * shared) but it's ignored there; only the team config's value
   * gates anything.
   *
   * Server normalizes missing keys to `true` on read so teams that
   * predate this field keep the feature enabled by default.
   */
  customAgents: z.boolean(),
  /**
   * Team-wide gate for the custom (user-authored) workflows feature
   * (Settings → Workflows). When false, members/admins can't create new
   * custom workflows — predefined workflows are unaffected. Sibling of
   * `customAgents`; per-agent docs carry it for shape alignment but it's
   * ignored there (only the team config's value gates anything). Server
   * normalizes a missing key to `true`, so teams predating it keep the
   * feature enabled.
   */
  customWorkflows: z.boolean(),
  /**
   * Team-wide gate for the entire custom-tools feature — sibling of
   * `customAgents` for the second axis of admin-authored bot
   * extension. When false, the dispatcher skips the Firestore read
   * for `teams/{teamId}/tools` entirely and registers zero custom
   * tools that turn, even ones that an active custom agent's per-
   * agent toggle has enabled. Equivalent to "the team has opted out
   * of admin-authored tools as a category."
   */
  customTools: z.boolean(),
  /**
   * Team-wide gate for the node inspector's "Generate summary" button
   * (the `summarizeNode` callable). A feature flag, not a model-callable
   * tool — sibling of `customTools`, surfaced in the Tools settings
   * section and excluded from the composer tool catalog (`BotToolName`).
   * Distinct from the `summarizeNode` toggle, which gates the chat tool;
   * the two surfaces toggle independently. Provider-agnostic — summaries
   * run on the team's chosen model, so it's never coupled to Google.
   * Carried on per-agent docs for type alignment but ignored there (only
   * the team config's value gates anything).
   */
  summarizeNodeInspector: z.boolean(),
})

/**
 * The bot's chat-mode options. Mirrors `BOT_CHAT_MODES` on the server
 * and `BotChatMode` on the client; duplicated here so the agent config
 * type carries it cleanly without a circular import.
 */
export const botAgentDefaultModeSchema = z.enum(["auto", "agent", "manual"])

/**
 * Per-built-in-agent feature flags. Each key is a fixed preset id
 * (`_researcher`, `_writer`, etc.) and the value is whether the team
 * has the preset enabled. Disabled built-ins are filtered out of
 * pickers, the transfer roster, and dispatch — they behave exactly
 * like a custom agent with `enabled: false`. Missing keys normalize
 * to `true` server-side so a newly-added preset is opt-out, not
 * opt-in, for existing teams.
 *
 * Lives at the config level (not under `tools`) so the toggles read
 * symmetrically with per-model toggles (`models: { … }`) rather than
 * leaking the agent feature into the per-tool feature-flag space.
 */
export const botAgentBuiltInAgentTogglesSchema = z.record(
  z.string(),
  z.boolean()
)

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
  /**
   * Per-built-in-agent on/off map. See
   * `botAgentBuiltInAgentTogglesSchema`. Sibling of `tools` — a
   * separate axis (which *agents* exist) from which *tools* exist.
   */
  builtInAgents: botAgentBuiltInAgentTogglesSchema,
  titleMaxLength: z.number().int().min(20).max(200),
  previewMaxLength: z.number().int().min(50).max(500),
})

// ─── Team-scoped custom agents (multi-agent network) ────────────────────────

/**
 * One team-scoped custom agent. Stored at
 *   teams/{teamId}/agents/{agentId}
 *
 * Each agent owns identity + behavior (name, description, system prompt,
 * tool subset). Model + generation params are inherited from the team's
 * default config (`teams/{teamId}/settings/agent`) — agents intentionally
 * don't carry those to keep the editor focused on persona definition.
 *
 * When an agent is "active" in a chat session, its `systemPromptBase` +
 * matching mode suffix REPLACE the team default (not append). The default
 * bot still exists as a synthetic `_default` agent for fallback when
 * `IBotSession.activeAgentId` is null or points to an archived doc.
 *
 * Soft-delete: `archivedAt` is set by the archive callable instead of
 * removing the doc. Tombstoned agents are hidden from pickers but stay
 * resolvable for sessions that reference them; the server rebuilds the
 * agent definition from the tombstoned doc on demand. Other agents'
 * cross-transfer references silently skip archived agents at dispatch
 * time.
 */
export const teamAgentSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  /** Display name shown in pickers, badges, and avatars. */
  name: z.string().min(1).max(40),
  /** Short blurb shown in pickers and tooltips. */
  description: z.string().max(200),
  /**
   * Seed for `vue-boring-avatars`. When empty, the UI falls back to
   * `name` as the seed so the avatar is deterministic from the
   * agent's display label without forcing admins to fill in a field.
   */
  avatarSeed: z.string().max(40),
  /** Replaces the team default system prompt when this agent is active. */
  systemPromptBase: z.string().min(1).max(4000),
  /** Per-mode suffix, appended after `systemPromptBase`. */
  promptSuffixes: z.object({
    auto: z.string().max(2000),
    agent: z.string().max(2000),
    manual: z.string().max(2000),
  }),
  /**
   * Per-tool toggles. Same shape as the team's tools (so agent + team
   * can intersect at dispatch time — a tool is exposed iff both flags
   * are true). Server normalizes missing keys to `true` on read so a
   * newly-added tool starts enabled for existing agents.
   */
  tools: botAgentToolTogglesSchema,
  /**
   * Per-custom-tool toggles. Keyed by `ITeamCustomTool.id` — the
   * Firestore-generated id of each admin-authored tool. Missing keys
   * normalize to `true` (opt-out convention shared with
   * `agentConfig.builtInAgents` and per-model toggles), so a newly-
   * created custom tool is automatically available to every existing
   * agent. Dispatch in `bot.ts` reads this map AND the team-level
   * `agentConfig.tools.customTools` gate; a tool fires only when both
   * are true and the tool itself is enabled + non-archived.
   *
   * Persisted as a flat record because the set of custom tools is
   * unbounded (admins can create many), so a fixed-shape schema
   * (like the built-in `tools` object) doesn't fit. Empty `{}` is
   * the default for new agents — every existing custom tool light
   * up automatically via the missing-key fallback.
   */
  customTools: z.record(z.string(), z.boolean()),
  /**
   * Admin-level on/off switch. Independent of `archivedAt` — together
   * they form the agent's lifecycle status:
   *   - enabled=true,  archivedAt=null      → "active"   (selectable; runs)
   *   - enabled=false, archivedAt=null      → "disabled" (hidden; falls back to default)
   *   - enabled=true,  archivedAt=Timestamp → "archived" (hidden; STILL runs for existing chats)
   *   - enabled=false, archivedAt=Timestamp → "disabled" (disabled wins for display + dispatch)
   *   - doc absent                          → "deleted"  (hard-delete only)
   *
   * Disabling is an *immediate* gate — dispatch silently swaps to the
   * default persona even when a session has the agent persisted as
   * `activeAgentId`. Re-enabling makes the agent dispatchable again
   * for any session that still points at it.
   *
   * Server normalizes missing keys to `true` on read so docs written
   * before this field shipped continue to dispatch normally.
   */
  enabled: z.boolean(),
  /**
   * Soft-delete marker — semantically a "deprecate" signal. Set when
   * the admin archives the agent from the settings UI; cleared by the
   * restore action. Archived agents are filtered out of pickers but
   * KEEP RUNNING in chats that already reference them — the badge in
   * the composer just gains an "Archived" status to signal the
   * deprecation. Hard delete (`deleteTeamAgent`) is the only path to
   * fully remove the doc.
   */
  archivedAt: timestampSchema.nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdByUid: z.string(),
})

/**
 * Write variant — accepts FieldValue sentinels for timestamps and lets
 * the server fill in id / teamId / createdByUid on create.
 */
export const teamAgentWriteSchema = teamAgentSchema.extend({
  id: z.string().optional(),
  teamId: z.string().optional(),
  createdByUid: z.string().optional(),
  archivedAt: z.union([timestampInputSchema, z.null()]).optional(),
  createdAt: timestampInputSchema,
  updatedAt: timestampInputSchema,
})

// ─── Team-scoped custom tools (admin-authored bot tool catalog) ─────────────

/**
 * One field on a custom tool's input or output schema. Limited to
 * primitive types because the model has to see something it can
 * generate a valid value for; nested objects and arrays would balloon
 * the editor UI complexity without paying for themselves in real
 * workflows. `description` rides through to the Genkit tool's schema
 * as `z.X().describe(description)` so the model sees it.
 */
export const customToolFieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    /**
     * Must be a valid JS identifier-ish — the field name becomes a key
     * in the Zod object passed to Genkit, and arbitrary punctuation
     * confuses the model's argument-generation. Enforces the same set
     * the server uses to whitelist field keys.
     */
    .regex(/^[a-z][a-zA-Z0-9_]*$/, {
      message:
        "Must start with a lowercase letter and contain only letters, digits, or underscores.",
    }),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().max(200),
  required: z.boolean(),
})

/**
 * The "what does this tool do" payload. Discriminated by `kind` so the
 * server's dispatcher can pick the right handler without prop-existence
 * sniffing. Adding a new action type is a 3-touch edit: this union,
 * the server's `executeCustomTool`, and the editor sub-form.
 *
 *   - **httpWebhook** — call any URL. The most flexible primitive.
 *     `bodyTemplate` uses `{{fieldName}}` interpolation against the
 *     model's tool input; missing keys interpolate to "" to keep
 *     templates resilient.
 *
 *   - **constant** — return a fixed JSON value. Useful for stub tools
 *     during prompt development and for tools whose contract is "the
 *     model just needs this exact static piece of info."
 *
 *   - **promptTemplate** — sub-call the model with a templated prompt.
 *     Lets admins build tools that wrap a one-shot LLM call (e.g. "Polish
 *     this draft"). Uses the team's configured model unless overridden.
 *
 *   - **workspaceSearch** — pre-canned `searchWorkspaceNodes` query.
 *     `defaultLimit` and `scope` are baked in; the model only fills the
 *     query string. Lets admins ship narrow, contextually-named search
 *     tools (e.g. `findRunbook`) without exposing the broad-scope tool.
 */
export const customToolActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("httpWebhook"),
    url: z.string().url().max(2048),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    /** Each entry is one HTTP header. Values interpolate `{{field}}`. */
    headers: z.array(
      z.object({
        name: z.string().min(1).max(80),
        value: z.string().max(1000),
      })
    ),
    /** Raw body string. `{{field}}` interpolation against tool inputs. */
    bodyTemplate: z.string().max(8000),
    /** Hard cap on response bytes returned to the model (default 16KB). */
    maxResponseBytes: z.number().int().min(256).max(65536),
    timeoutMs: z.number().int().min(1000).max(30_000),
  }),
  z.object({
    kind: z.literal("constant"),
    /** JSON-encoded value. Parsed server-side; surfaced verbatim to the model. */
    value: z.string().max(8000),
  }),
  z.object({
    kind: z.literal("promptTemplate"),
    /** `{{field}}` interpolation against tool inputs. */
    prompt: z.string().min(1).max(4000),
    /**
     * Optional override of the team's default model. `null` keeps the
     * sub-call on whichever model the chat is currently using.
     */
    model: botAgentModelSchema.nullable(),
  }),
  z.object({
    kind: z.literal("workspaceSearch"),
    /**
     * Restricts which node scope the canned search runs over. `null`
     * means "both" — same default the broad-scope tool uses.
     */
    scope: z.enum(["code", "write"]).nullable(),
    /** Hard cap on returned nodes (the model never sees more). */
    defaultLimit: z.number().int().min(1).max(20),
    /**
     * Filter hint baked into the user query. Surfaced to the model in
     * the tool's description so the model knows the tool's "topic" up
     * front; appended to the user query at dispatch time. Empty string
     * means "no filter."
     */
    filterHint: z.string().max(200),
  }),
])

/**
 * One team-scoped custom tool. Stored at
 *   teams/{teamId}/tools/{toolId}
 *
 * Mirrors `teamAgentSchema`'s lifecycle (enabled / archivedAt / hard
 * delete) so admins can deprecate a tool without breaking ongoing
 * chats. Identity carries name, description, input/output schemas,
 * and an action discriminator. The dispatcher (`bot.ts`) builds a
 * Genkit `defineTool` from each enabled+non-archived doc on every
 * chat turn (cached for 5s, mirroring `teamAgents.ts`).
 */
export const teamCustomToolSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  /**
   * Display name AND the tool's wire-name for the model. Must be a
   * valid identifier — Genkit names the tool by this string and the
   * model invokes it by the same string, so spaces or punctuation
   * confuse the dispatch path.
   */
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-zA-Z0-9_]*$/, {
      message:
        "Must start with a lowercase letter and contain only letters, digits, or underscores.",
    }),
  /** Free-form display label shown in the UI when the wire-name reads awkward. */
  displayName: z.string().max(60),
  /**
   * Shown to the MODEL as the tool's description — what to call it for,
   * what each input means, expected output. The model uses this to
   * decide when to invoke; vague descriptions lead to under-utilization
   * or over-utilization. Required to keep the bar high.
   */
  description: z.string().min(1).max(500),
  /**
   * Seed for `vue-boring-avatars` — same as ITeamAgent.avatarSeed.
   * Falls back to `name` at render time when empty.
   */
  avatarSeed: z.string().max(40),
  /** Field-level definition of what the model passes as input. */
  inputSchema: z.object({
    fields: z.array(customToolFieldSchema).max(10),
  }),
  /** Field-level definition of what the tool returns to the model. */
  outputSchema: z.object({
    fields: z.array(customToolFieldSchema).max(10),
  }),
  action: customToolActionSchema,
  /** Admin on/off toggle. See ITeamAgent.enabled for the lifecycle matrix. */
  enabled: z.boolean(),
  archivedAt: timestampSchema.nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdByUid: z.string(),
})

export const teamCustomToolWriteSchema = teamCustomToolSchema.extend({
  id: z.string().optional(),
  teamId: z.string().optional(),
  createdByUid: z.string().optional(),
  archivedAt: z.union([timestampInputSchema, z.null()]).optional(),
  createdAt: timestampInputSchema,
  updatedAt: timestampInputSchema,
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
  /**
   * Currently active custom agent for this session. `null` (or absent)
   * means the team's default bot persona handles every turn. Set by the
   * client via `sendBotMessage.activeAgentId`; persisted server-side by
   * `FirestoreBotSessionStore.save` so re-opens restore the same agent
   * across page reloads / device switches.
   *
   * Tombstone safety: if the referenced agent is later archived, the
   * server falls back to the default at dispatch time and the doc field
   * stays pointing at the archived id. Restoring the agent re-binds the
   * session automatically — no migration needed.
   */
  activeAgentId: z.string().nullable().optional(),
})

// ─── Workflows ───────────────────────────────────────────────────────────────

/** Structured schedule presets (mirror `functions/src/workflows.ts`). */
export const workflowScheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    everyHours: z.number().int().min(1).max(720),
  }),
  z.object({
    type: z.literal("daily"),
    atMinuteUTC: z.number().int().min(0).max(1439),
  }),
  z.object({
    type: z.literal("weekly"),
    dayOfWeek: z.number().int().min(0).max(6),
    atMinuteUTC: z.number().int().min(0).max(1439),
  }),
])

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), schedule: workflowScheduleSchema }),
  // `event` is the brief's `node_change` — fires on a code/write node edit.
  // `debounceMinutes` coalesces a burst of rapid edits into one run.
  z.object({
    type: z.literal("event"),
    scope: z.enum(["code", "write"]),
    debounceMinutes: z.number().int().min(0).max(1440).default(0),
  }),
  z.object({ type: z.literal("manual") }),
])

export const workflowNodeRefSchema = z.object({
  scope: z.enum(["code", "write"]),
  nodeId: z.string(),
})

/**
 * How a run's edits land:
 *   - `automatic`: the agent writes nodes directly (gated by metering +
 *     entitlement, see `usageMetering.ts`).
 *   - `require_review`: edits are captured as a proposed changeset that an
 *     admin approves before they're applied. Cost-bounded by a human, so it's
 *     the safe default.
 */
export const workflowUpdateModeSchema = z.enum(["automatic", "require_review"])

export const workflowRunStatusSchema = z.enum([
  "queued",
  "running",
  "success", // automatic run that applied its edits directly
  "awaiting_review", // require_review run: changes captured, pending approval
  "applied", // require_review run: approved + applied
  "cancelled", // require_review run: rejected by an admin
  "error",
  "blocked", // over budget / not entitled — no spend
  "skipped", // workflow disabled or removed before it ran
])

/** A team automation. Written server-side; read here for the admin UI. */
export const workflowSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  /** null = custom; non-null (e.g. "_grammar") = a seeded predefined instance. */
  presetKey: z.string().nullable().default(null),
  name: z.string(),
  description: z.string().default(""),
  agentId: z.string(),
  workspaceId: z.string(),
  /** Tree the workflow may edit. null = the workspace's `write` tree. */
  targetScope: z.enum(["code", "write"]).nullable().default(null),
  /** The procedure the agent follows each run (the brief's `instructions`). */
  instructions: z.string().default(""),
  /** Optional supplementary instructions appended to `instructions`. */
  additionalPrompt: z.string().default(""),
  trigger: workflowTriggerSchema,
  contextNodes: z.array(workflowNodeRefSchema).default([]),
  updateMode: workflowUpdateModeSchema.default("require_review"),
  enabled: z.boolean(),
  archivedAt: timestampSchema.nullable().optional(),
  nextRunAt: timestampSchema.nullable().optional(),
  lastRunAt: timestampSchema.nullable().optional(),
  lastRunStatus: workflowRunStatusSchema.nullable().optional(),
  createdByUid: z.string().optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
})

/**
 * Write variant — accepts FieldValue sentinels for timestamps and lets the
 * server fill id / teamId / createdByUid + the denormalized run pointers.
 */
export const workflowWriteSchema = workflowSchema.extend({
  id: z.string().optional(),
  teamId: z.string().optional(),
  createdByUid: z.string().optional(),
  archivedAt: z.union([timestampInputSchema, z.null()]).optional(),
  nextRunAt: z.union([timestampInputSchema, z.null()]).optional(),
  lastRunAt: z.union([timestampInputSchema, z.null()]).optional(),
  createdAt: timestampInputSchema.optional(),
  updatedAt: timestampInputSchema.optional(),
})

/** One node edit a run proposed (require_review) or applied (automatic). */
export const workflowRunChangeSchema = z.object({
  scope: z.enum(["code", "write"]),
  nodeId: z.string().nullable(), // null for a create
  op: z.enum(["create", "update", "rename", "move", "archive"]),
  summary: z.string(),
  /** The source node this edit was derived from, if any (citation). */
  sourceNodeId: z.string().nullable().optional(),
})

/** What fired a run (the brief's `triggeredBy`). */
export const workflowRunTriggeredBySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule") }),
  z.object({
    type: z.literal("event"),
    scope: z.enum(["code", "write"]),
    nodeId: z.string(),
  }),
  z.object({ type: z.literal("manual"), uid: z.string() }),
])

/** Per-run token + estimated-cost accounting (the metering gate's output). */
export const workflowRunUsageSchema = z.object({
  model: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  estimatedCostUsd: z.number(),
})

/** One execution of a workflow (queue + history). */
export const workflowRunSchema = z.object({
  id: z.string(),
  teamId: z.string().optional(),
  workflowId: z.string(),
  agentId: z.string(),
  workspaceId: z.string(),
  presetKey: z.string().nullable().optional(),
  /** Snapshot of the workflow's update mode at enqueue (drives the review UI). */
  updateMode: workflowUpdateModeSchema.optional(),
  status: workflowRunStatusSchema,
  triggeredBy: workflowRunTriggeredBySchema.optional(),
  /** Node edits this run proposed/applied; empty until the agent acts. */
  changes: z.array(workflowRunChangeSchema).default([]),
  usage: workflowRunUsageSchema.nullable().optional(),
  /** Snapshot of the composed instruction the agent ran (for history). */
  prompt: z.string().optional(),
  sessionId: z.string().optional(),
  replyPreview: z.string().optional(),
  error: z.string().optional(),
  /** Admin who approved/rejected a require_review run. */
  reviewedByUid: z.string().nullable().optional(),
  queuedAt: timestampSchema.nullable().optional(),
  startedAt: timestampSchema.nullable().optional(),
  finishedAt: timestampSchema.nullable().optional(),
  reviewedAt: timestampSchema.nullable().optional(),
})

export const workflowRunWriteSchema = workflowRunSchema.extend({
  id: z.string().optional(),
  queuedAt: z.union([timestampInputSchema, z.null()]).optional(),
  startedAt: z.union([timestampInputSchema, z.null()]).optional(),
  finishedAt: z.union([timestampInputSchema, z.null()]).optional(),
  reviewedAt: z.union([timestampInputSchema, z.null()]).optional(),
})

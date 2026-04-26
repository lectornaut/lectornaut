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
 * Bot chat session metadata. The full Genkit `SessionData` blob lives in
 * `data` and is round-tripped opaquely by the server-side `SessionStore`.
 * The other fields are derived on each save so the history sidebar can
 * render without parsing the blob client-side.
 *
 * Sessions written before the visibility field existed have no value on
 * disk — the schema's `.default("private")` keeps them owner-only at the
 * type layer without a data migration.
 */
export const botSessionSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  workspaceId: z.string(),
  ownerUid: z.string(),
  title: z.string().optional(),
  preview: z.string().optional(),
  messageCount: z.number().optional(),
  visibility: botSessionVisibilitySchema.default("private"),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
  /** Set when archived; null/undefined when active. */
  archivedAt: timestampSchema.nullable().optional(),
})

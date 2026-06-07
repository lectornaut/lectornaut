import { MEMBERSHIP_ROLES } from "@lectornaut/shared/permissions"
import { z } from "zod"
import { timestampInputSchema, timestampSchema } from "./_primitives"
import { teamSchema, userProfileSchema } from "./domain"

/**
 * Membership schemas — mirror `src/types/membership.ts`.
 *
 * A membership doc carries denormalized snapshots of the principal (user
 * or agent) and team it links, so that list views can render without
 * joining two collections. The `Partial<…>` variants on the doc-data
 * schema reflect the reality that snapshots may be half-populated during
 * async propagation.
 *
 * Two principal kinds share the `teams/{teamId}/memberships/{id}`
 * collection:
 *   - "user"  — a human, keyed by `userId`, carries a `user` snapshot.
 *               `kind` is OPTIONAL/absent on legacy docs (predates agents),
 *               which normalize to "user".
 *   - "agent" — a team agent acting as a member, keyed by `agentId`,
 *               carries an `agent` snapshot. Always role "member".
 *
 * The read-path converter validates EVERY doc in the collection, so the
 * doc-data schema is a permissive superset that parses both kinds without
 * throwing (the converter throws on parse failure in dev). Strict
 * discrimination is done at the type level via `ITeamMember` and the
 * `isAgentMembership` runtime guard.
 */

export const membershipRoleSchema = z.enum(MEMBERSHIP_ROLES)

/** Which kind of principal a membership represents. */
export const membershipKindSchema = z.enum(["user", "agent"])

// ─── Membership record ───────────────────────────────────────────────────────

export const membershipRecordSchema = z.object({
  userId: z.string(),
  teamId: z.string(),
  role: membershipRoleSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

// ─── Denormalized user/team/agent snapshots ──────────────────────────────────

export const membershipUserSnapshotSchema = userProfileSchema.pick({
  uid: true,
  email: true,
  displayName: true,
  photoURL: true,
  username: true,
  isPublic: true,
  createdAt: true,
  updatedAt: true,
})

export const membershipTeamSnapshotSchema = teamSchema.pick({
  id: true,
  name: true,
  photoURL: true,
  username: true,
  isPublic: true,
  createdAt: true,
  updatedAt: true,
})

/**
 * Denormalized snapshot of the agent backing an agent membership. Agents
 * — especially built-in presets — may have no Firestore doc of their own,
 * so the membership carries enough display data (name, avatar seed) to
 * render a member row without resolving the team's agents collection.
 */
export const membershipAgentSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  avatarSeed: z.string().optional(),
  /** True when the agent is a shipped built-in preset (no Firestore doc). */
  isBuiltIn: z.boolean().optional(),
})

// ─── Full memberships (record + resolved snapshots) ──────────────────────────

/**
 * A human (user) membership. `kind` is optional so docs written before
 * agent memberships existed still validate (they normalize to "user").
 */
export const membershipSchema = membershipRecordSchema.extend({
  kind: z.literal("user").optional(),
  user: membershipUserSnapshotSchema,
  team: membershipTeamSnapshotSchema,
})

/**
 * An agent membership — keyed by `agentId`, always role "member". Carries
 * an `agent` snapshot instead of a `user` snapshot.
 */
export const agentMembershipSchema = z.object({
  kind: z.literal("agent"),
  agentId: z.string(),
  teamId: z.string(),
  role: membershipRoleSchema,
  agent: membershipAgentSnapshotSchema,
  team: membershipTeamSnapshotSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

/**
 * A single row in a team's members list — either principal kind.
 * `agentMembershipSchema` is listed first so its required `kind: "agent"`
 * literal is tried before the looser user schema.
 */
export const teamMemberSchema = z.union([
  agentMembershipSchema,
  membershipSchema,
])

// ─── Membership Firestore doc shape ─────────────────────────────────────────

/**
 * The as-stored shape in Firestore, permissive across BOTH principal
 * kinds. Snapshot fields may be partial during asynchronous propagation
 * (e.g., while server triggers refresh denormalized snapshots), and the
 * kind-specific fields (`userId`/`user` vs `agentId`/`agent`) are all
 * optional so the shared read-path converter parses either shape without
 * throwing.
 */
export const membershipDocDataSchema = z.object({
  kind: membershipKindSchema.optional(),
  userId: z.string().optional(),
  agentId: z.string().optional(),
  teamId: z.string(),
  role: membershipRoleSchema,
  user: membershipUserSnapshotSchema.partial().optional(),
  agent: membershipAgentSnapshotSchema.partial().optional(),
  team: membershipTeamSnapshotSchema.partial(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
})

export const membershipDocDataWriteSchema = membershipDocDataSchema.extend({
  teamId: z.string().optional(),
  createdAt: timestampInputSchema.optional(),
  updatedAt: timestampInputSchema.optional(),
})

// ─── Per-(member, workspace) state ───────────────────────────────────────────

/**
 * The document at
 *   teams/{teamId}/memberships/{userId}/workspaces/{workspaceId}
 *
 * holding state specific to one member *within one workspace*. Today that is
 * an optional per-workspace ROLE OVERRIDE: when set, it combines with the
 * member's team role under **elevate-only** semantics (`effectiveRole` in
 * `@lectornaut/shared/permissions`) so a member can be granted more power in a
 * single workspace without changing their team-wide role. `role` absent or
 * `null` means "no override — use the team role".
 *
 * Functions-only write (see `firestore.rules`): the member can READ their own
 * per-workspace role but can never self-assign it, so this is NOT an
 * escalation surface. The sibling `.../workspaces/{workspaceId}/layout/tabs`
 * doc holds the member's per-workspace tab layout under the same contract.
 */
export const membershipWorkspaceSchema = z.object({
  role: membershipRoleSchema.nullable().optional(),
  /**
   * Workspace participation. `true` = the member is excluded (a non-member of
   * this workspace). Absent/`false` = participating.
   */
  excluded: z.boolean().optional(),
  /**
   * Denormalized GROUP-derived role: the member's max role over every team
   * group they belong to that THIS workspace grants (see `groupGrants`).
   * Functions-only write (kept in sync by the `onGroup*Written` triggers) — it
   * exists so firestore.rules can fold group elevation into the content gate
   * without iterating groups. The functions read path stays authoritative by
   * resolving groups live, so this is a rules-only mirror. Absent = no group
   * elevation here. Optional so over-strict reads never drop the doc.
   */
  groupRole: membershipRoleSchema.nullable().optional(),
  updatedAt: timestampSchema.optional(),
})

export const membershipWorkspaceWriteSchema = membershipWorkspaceSchema.extend({
  role: membershipRoleSchema.nullable().optional(),
  excluded: z.boolean().optional(),
  updatedAt: timestampInputSchema.optional(),
})

/**
 * Read-side variant of the per-workspace override doc, carrying the workspace
 * id (the doc's own id, injected by `zodConverter`). Used when the signed-in
 * user *lists* their own `…/memberships/{uid}/workspaces` subcollection to
 * resolve their effective role per workspace — so workspace-scoped affordances
 * can honor an elevate-only direct/group grant instead of collapsing to the
 * team role.
 */
export const membershipWorkspaceRecordSchema = membershipWorkspaceSchema.extend(
  {
    id: z.string(),
  }
)

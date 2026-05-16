import { MEMBERSHIP_ROLES } from "@lectornaut/shared/permissions"
import { z } from "zod"
import { timestampInputSchema, timestampSchema } from "./_primitives"
import { teamSchema, userProfileSchema } from "./domain"

/**
 * Membership schemas — mirror `src/types/membership.ts`.
 *
 * A membership doc carries denormalized snapshots of the user and team it
 * links, so that list views can render without joining two collections. The
 * `Partial<…>` variant on the doc-data schema reflects the reality that
 * snapshots may be half-populated during async propagation.
 */

export const membershipRoleSchema = z.enum(MEMBERSHIP_ROLES)

// ─── Membership record ───────────────────────────────────────────────────────

export const membershipRecordSchema = z.object({
  userId: z.string(),
  teamId: z.string(),
  role: membershipRoleSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

// ─── Denormalized user/team snapshots ────────────────────────────────────────

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

// ─── Full membership (record + resolved snapshots) ──────────────────────────

export const membershipSchema = membershipRecordSchema.extend({
  user: membershipUserSnapshotSchema,
  team: membershipTeamSnapshotSchema,
})

// ─── Membership Firestore doc shape ─────────────────────────────────────────

/**
 * The as-stored shape in Firestore, where snapshot fields may be partial
 * during asynchronous propagation (e.g., while server triggers refresh
 * denormalized user/team snapshots).
 */
export const membershipDocDataSchema = z.object({
  userId: z.string(),
  teamId: z.string(),
  role: membershipRoleSchema,
  user: membershipUserSnapshotSchema.partial(),
  team: membershipTeamSnapshotSchema.partial(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
})

export const membershipDocDataWriteSchema = membershipDocDataSchema.extend({
  userId: z.string().optional(),
  teamId: z.string().optional(),
  createdAt: timestampInputSchema.optional(),
  updatedAt: timestampInputSchema.optional(),
})

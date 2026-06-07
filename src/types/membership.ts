import type {
  agentMembershipSchema,
  membershipAgentSnapshotSchema,
  membershipDocDataSchema,
  membershipRecordSchema,
  membershipSchema,
  membershipTeamSnapshotSchema,
  membershipUserSnapshotSchema,
  membershipWorkspaceRecordSchema,
  teamMemberSchema,
} from "@/schemas/membership"
import type { z } from "zod"

/**
 * Membership type aliases — re-exported `z.infer` types from
 * `src/schemas/membership.ts`.
 *
 * Role primitives (`IMembershipRole`, `MEMBERSHIP_ROLES`, `isMembershipRole`)
 * are re-exported from the shared permissions module so existing imports
 * like `import { IMembershipRole } from "@/types/membership"` keep working.
 *
 * Two principal kinds share the memberships collection:
 *   - `IMembership`      — a human membership (keeps the historical name +
 *                          shape so the bulk of the codebase, which only
 *                          deals with the signed-in user's own user
 *                          memberships, is untouched).
 *   - `IAgentMembership` — an agent acting as a member (role always
 *                          "member").
 *   - `ITeamMember`      — the union; the shape of a row in a team's
 *                          members list.
 */

export {
  isMembershipRole,
  MEMBERSHIP_ROLES,
  type IMembershipRole,
} from "@lectornaut/shared/permissions"

export type IMembershipRecord = z.infer<typeof membershipRecordSchema>
export type IMembershipUserSnapshot = z.infer<
  typeof membershipUserSnapshotSchema
>
export type IMembershipTeamSnapshot = z.infer<
  typeof membershipTeamSnapshotSchema
>
export type IMembershipAgentSnapshot = z.infer<
  typeof membershipAgentSnapshotSchema
>
export type IMembership = z.infer<typeof membershipSchema>
export type IAgentMembership = z.infer<typeof agentMembershipSchema>
export type ITeamMember = z.infer<typeof teamMemberSchema>
export type IMembershipDocData = z.infer<typeof membershipDocDataSchema>
export type IMembershipWorkspaceRecord = z.infer<
  typeof membershipWorkspaceRecordSchema
>

/** Narrow a team member row to the agent variant. */
export const isAgentMembership = (
  member: ITeamMember
): member is IAgentMembership => (member as { kind?: string }).kind === "agent"

/** Narrow a team member row to the human (user) variant. */
export const isUserMembership = (member: ITeamMember): member is IMembership =>
  (member as { kind?: string }).kind !== "agent"

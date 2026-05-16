import type {
  membershipDocDataSchema,
  membershipRecordSchema,
  membershipSchema,
  membershipTeamSnapshotSchema,
  membershipUserSnapshotSchema,
} from "@/schemas/membership"
import type { z } from "zod"

/**
 * Membership type aliases — re-exported `z.infer` types from
 * `src/schemas/membership.ts`.
 *
 * Role primitives (`IMembershipRole`, `MEMBERSHIP_ROLES`, `isMembershipRole`)
 * are re-exported from the shared permissions module so existing imports
 * like `import { IMembershipRole } from "@/types/membership"` keep working.
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
export type IMembership = z.infer<typeof membershipSchema>
export type IMembershipDocData = z.infer<typeof membershipDocDataSchema>

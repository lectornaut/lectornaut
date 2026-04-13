import { z } from "zod"
import { timestampSchema } from "./_primitives"
import { membershipRoleSchema } from "./membership"

/**
 * Invitation schema — mirrors the `IInvitation` interface declared locally
 * inside `src/stores/invitationStore.ts`. Added in PR 7 alongside the
 * composable cleanup so that the store's `findInvitationByCode` fallback
 * query can validate the Firestore payload via `parseSafe` instead of an
 * unchecked `as IInvitation` cast.
 *
 * Note: `id` is optional on the stored shape because the doc ID is
 * assigned by Firestore and callers construct it from `docSnap.id`; it's
 * added post-hoc to the data when building the client-side object.
 */
export const invitationStatusSchema = z.enum(["pending", "declined"])

export const invitationSchema = z.object({
  id: z.string().optional(),
  teamId: z.string(),
  teamName: z.string(),
  inviterName: z.string(),
  inviterEmail: z.string(),
  email: z.string(),
  role: membershipRoleSchema,
  status: invitationStatusSchema,
  code: z.string(),
  createdAt: timestampSchema,
  resentAt: timestampSchema.optional(),
})

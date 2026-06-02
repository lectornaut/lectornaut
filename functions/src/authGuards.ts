/**
 * Auth guards for team-management callables.
 *
 * One home for the functions-side admin gate so the owner/admin policy isn't
 * re-implemented per file. The role *predicate* lives in the shared package
 * (`isAdminRole`, re-exported by `./permissions.js`); this module adds the
 * Firestore membership read + `HttpsError` that can't live in the
 * platform-neutral shared package.
 */

import { HttpsError } from "firebase-functions/v2/https"
import { getMembershipRole } from "./bot.js"
import { isAdminRole } from "./permissions.js"

/**
 * Assert the caller is a team owner or admin; throw `permission-denied`
 * otherwise. The server is the source of truth — every integration / workflow
 * / config-generation mutation must call this before any write, regardless of
 * what the client's UI affordances allow.
 *
 * @param message — surfaced to the client; pass a domain-specific string.
 */
export async function assertAdminRole(
  teamId: string,
  uid: string,
  message = "Only team owners and admins can manage this team."
): Promise<void> {
  const role = await getMembershipRole(teamId, uid)
  if (!isAdminRole(role)) {
    throw new HttpsError("permission-denied", message)
  }
}

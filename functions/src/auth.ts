/**
 * Shared callable auth primitives — the functions-side companion to the
 * platform-neutral role predicates in `./permissions.js`.
 *
 * Two gates, one home: `assertAuthenticated` (signed-in) and
 * `requireVerifiedAuth` (signed-in + verified email). Previously each was
 * copy-pasted — `assertAuthenticated` lived privately in SIX callable files
 * (audit / billing / collab / groups / sso / userProfile), and
 * `requireVerifiedAuth` lived oddly in the multi-thousand-line `bot.ts`.
 * Centralising them keeps the `unauthenticated` / `permission-denied` contract
 * identical across every callable and gives `defineCallable`'s `resolveAuth` a
 * single source of truth.
 *
 * Intentionally domain-free: this module imports only `firebase-functions`, so
 * it sits at the bottom of the dependency graph and can never form an import
 * cycle with `bot.ts` / `audit.ts` (which both depend on it).
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https"

/**
 * `AuthData` isn't re-exported from `firebase-functions/v2/https`, so derive it
 * from `CallableRequest["auth"]`. (Mirrors the local alias `bot.ts` used before
 * `requireVerifiedAuth` moved here.)
 */
export type AuthData = NonNullable<CallableRequest["auth"]>

/**
 * Assert the caller is signed in, narrowing `request.auth` to non-null. The one
 * shared definition that replaced six byte-identical private copies; the message
 * is preserved verbatim so the `unauthenticated` surface is unchanged.
 *
 * Returns an `asserts` predicate (not the auth) so existing call sites keep
 * accessing `request.auth.uid` directly after the guard.
 */
export function assertAuthenticated(
  request: CallableRequest
): asserts request is CallableRequest & {
  auth: NonNullable<CallableRequest["auth"]>
} {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
}

/**
 * Require the caller to be signed in with a verified email and return the
 * narrowed auth. Moved verbatim from `bot.ts`; used by every non-Genkit bot /
 * workflow / config-generation CRUD callable (the Genkit-wrapped flows enforce
 * `email_verified` via `authPolicy`, so they don't need this helper).
 *
 * Returning the auth (instead of an `asserts` helper) avoids TypeScript's flaky
 * narrowing of property accesses like `request.auth.uid` across the call
 * boundary.
 */
export function requireVerifiedAuth(auth: AuthData | undefined): AuthData {
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.")
  }
  if (auth.token?.email_verified !== true) {
    throw new HttpsError(
      "permission-denied",
      "Verify your email address to continue."
    )
  }
  return auth
}

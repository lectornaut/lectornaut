/**
 * The single backend authorization seam.
 *
 * `authorize` resolves a PRINCIPAL's role and gates a CAPABILITY by walking the
 * capability's ordered scopes (the pure `resolveAuthorization` in the shared
 * permission model), reading Firestore through a transaction when one is given.
 * It returns an `AuthDecision` — facts, not control flow — and NEVER throws for
 * a denial:
 *
 *   - hard-deny call sites (content mutations, collab) wrap it with
 *     `requireAuthorized`, which raises `permission-denied`;
 *   - the bot's soft tool gate reads `decision.allowed` directly.
 *
 * This module deliberately does NOT import `audit.ts`: `audit.ts` depends on
 * `authorize`, so the dependency stays one-directional (no import cycle). The
 * subtle decision logic lives in the shared, unit-tested `resolveAuthorization`;
 * everything here is thin I/O binding.
 */

import { HttpsError } from "firebase-functions/v2/https"

import type { Transaction } from "firebase-admin/firestore"
import { DEFAULT_AGENT_ID } from "./agents.js"
import { db } from "./firebase.js"
import {
  type AuthDecision,
  type Capability,
  type DeniedReason,
  isMembershipRole,
  resolveAuthorization,
} from "./permissions.js"
import type { IMembershipRole } from "./types.js"
import { resolveParticipation } from "./workspaceRoles.js"

/**
 * The principal's team role for authorization, resolved as DATA (never throws).
 *
 * Mirrors `getMembershipRoleOrNull`: the built-in Default agent (`_default`) is
 * an implicit team member with no membership doc → synthesised `member`; any
 * other principal resolves to their membership-doc role, or `null` when they are
 * not a team member (a denial the scope walk produces, not an exception). Read
 * through `transaction` when given, so it joins the mutation's read set.
 */
async function resolveTeamRole(
  teamId: string,
  principalId: string,
  transaction?: Transaction
): Promise<IMembershipRole | null> {
  if (principalId === DEFAULT_AGENT_ID) return "member"

  const ref = db.doc(`teams/${teamId}/memberships/${principalId}`)
  const snap = transaction ? await transaction.get(ref) : await ref.get()
  if (!snap.exists) return null

  const role = snap.data()?.role
  return isMembershipRole(role) ? role : null
}

export interface AuthorizeContext {
  teamId: string
  /** Required for any capability whose policy reaches a `"workspace"` scope. */
  workspaceId?: string
  /**
   * Read membership + the direct override through this transaction, so role
   * resolution joins the mutation's read set. Omit for the non-transactional
   * callers (collab, bot, the attachment + batched-purge mutations).
   */
  transaction?: Transaction
}

/**
 * Resolve `principal`'s role and decide `capability`. See the module header for
 * the throw-or-read contract. Returns the full {@link AuthDecision} so callers
 * can reuse the resolved `teamRole` (e.g. as the audit actor's role).
 */
export async function authorize(
  principal: string,
  capability: Capability,
  ctx: AuthorizeContext
): Promise<AuthDecision> {
  const teamRole = await resolveTeamRole(ctx.teamId, principal, ctx.transaction)

  return resolveAuthorization(principal, capability, {
    teamRole,
    // Lazy: only invoked if the walk reaches a `"workspace"` scope. A workspace
    // capability with no workspaceId in context is a programming error, not a
    // permission outcome — fail loud rather than silently denying.
    resolveParticipation: () => {
      if (!ctx.workspaceId) {
        throw new HttpsError(
          "internal",
          `authorize(${capability}) reached a workspace scope without a workspaceId.`
        )
      }
      return resolveParticipation(
        ctx.teamId,
        ctx.workspaceId,
        principal,
        ctx.transaction
      )
    },
  })
}

/**
 * Default messages for the STRUCTURAL denial reasons. These reproduce verbatim
 * the strings the old throwing resolvers raised (`requireTeamRole` and the
 * `getWorkspaceRoleOverride` exclusion gate), so migrating a call site to
 * `authorize` + `requireAuthorized` keeps its observable error text. The
 * `insufficient-capability` case (a member who simply lacks the capability) is
 * per-call-site, so it uses the caller-supplied `denyMessage`.
 */
const DENY_MESSAGES: Record<
  Exclude<DeniedReason, "insufficient-capability">,
  string
> = {
  "not-team-member": "User is not a team member.",
  excluded: "You are not a member of this workspace.",
}

/**
 * Turn a denied {@link AuthDecision} into a hard `permission-denied` throw — the
 * opt-in companion to {@link authorize} for call sites that must reject. Returns
 * the decision on success so the resolved roles stay in hand:
 *
 *   const { teamRole } = requireAuthorized(
 *     await authorize(actorId, MANAGE_WORKSPACE_CONTENT, { teamId, workspaceId, transaction }),
 *     "You do not have permission to manage workspace content."
 *   )
 */
export function requireAuthorized(
  decision: AuthDecision,
  denyMessage = "You do not have permission to perform this action."
): AuthDecision {
  if (decision.allowed) return decision

  const reason = decision.deniedReason ?? "insufficient-capability"
  const message =
    reason === "insufficient-capability" ? denyMessage : DENY_MESSAGES[reason]
  throw new HttpsError("permission-denied", message)
}

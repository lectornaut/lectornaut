import type { Transaction } from "firebase-admin/firestore"
import { FieldValue } from "firebase-admin/firestore"
import { db } from "./firebase.js"
import {
  effectiveRole,
  isMembershipRole,
  type Participation,
} from "./permissions.js"
import type { IMembershipRole } from "./types.js"

/**
 * The principal's group-derived role in a workspace, resolved LIVE: the max
 * grant over every group they belong to that the workspace grants a role.
 * Returns null when the principal is in no granted group (the overwhelmingly
 * common case — a single empty `array-contains` query that reads no fields).
 *
 * Multi-group conflict resolves to `max()` (most-privileged), consistent with
 * `effectiveRole`. Humans only — groups never contain agents.
 */
export async function resolveWorkspaceGroupRole(
  teamId: string,
  workspaceId: string,
  principalId: string
): Promise<IMembershipRole | null> {
  // Groups the principal belongs to. `.select()` reads no document fields — we
  // only need the ids to address each group's grant for this workspace.
  const groupsSnap = await db
    .collection(`teams/${teamId}/groups`)
    .where("memberIds", "array-contains", principalId)
    .select()
    .get()
  if (groupsSnap.empty) return null

  const grantRefs = groupsSnap.docs.map((g) =>
    db.doc(`teams/${teamId}/workspaces/${workspaceId}/groupGrants/${g.id}`)
  )
  const grantSnaps = await db.getAll(...grantRefs)

  let best: IMembershipRole | null = null
  for (const snap of grantSnaps) {
    if (!snap.exists) continue
    const role = snap.data()?.role
    if (isMembershipRole(role)) best = effectiveRole(best, role)
  }
  return best
}

/**
 * The principal's PARTICIPATION in a workspace, resolved as DATA (never throws):
 *
 *   - `{ excluded: true }`        when the direct override marks them excluded.
 *   - `{ excluded: false, role }` otherwise, where `role` is the elevate-only
 *     per-workspace role `max(directOverride, groupRole)`, or `null`.
 *
 * The data-returning counterpart to {@link getWorkspaceRoleOverride}: exclusion
 * becomes a value the scope walk denies on (see `resolveAuthorization`), not a
 * control-flow throw, so one resolver serves both hard-deny callers (content,
 * collab) and the bot's soft tool gate.
 *
 * The DIRECT override is read through `transaction` when one is given, so it
 * joins the mutation's read set; the GROUP contribution is always read direct —
 * admin-managed config, deliberately outside the mutation's consistency
 * boundary (no extra contention on the hot content path).
 */
export async function resolveParticipation(
  teamId: string,
  workspaceId: string,
  principalId: string,
  transaction?: Transaction
): Promise<Participation> {
  const overrideRef = db.doc(
    `teams/${teamId}/memberships/${principalId}/workspaces/${workspaceId}`
  )
  const overrideSnap = transaction
    ? await transaction.get(overrideRef)
    : await overrideRef.get()

  if (overrideSnap.exists && overrideSnap.data()?.excluded === true) {
    return { excluded: true }
  }

  const directRoleRaw = overrideSnap.exists
    ? overrideSnap.data()?.role
    : undefined
  const directRole = isMembershipRole(directRoleRaw) ? directRoleRaw : null
  const groupRole = await resolveWorkspaceGroupRole(
    teamId,
    workspaceId,
    principalId
  )
  return { excluded: false, role: effectiveRole(directRole, groupRole) }
}

/**
 * Recompute and persist the denormalized `groupRole` field on each member's
 * per-workspace override doc — the value the rules path reads (it can't run the
 * live group query). Idempotent + self-healing: it writes only when the value
 * actually changes, clears the field when a member no longer derives any group
 * role here, and tolerates a missing override doc (group elevation can apply to
 * a member who has no direct override). Safe to re-run (drives `retry:true`
 * triggers).
 */
export async function recomputeGroupRoleForMembersInWorkspace(
  teamId: string,
  workspaceId: string,
  memberIds: readonly string[]
): Promise<void> {
  const uniqueIds = [...new Set(memberIds)]
  await Promise.all(
    uniqueIds.map(async (uid) => {
      const role = await resolveWorkspaceGroupRole(teamId, workspaceId, uid)
      const ref = db.doc(
        `teams/${teamId}/memberships/${uid}/workspaces/${workspaceId}`
      )
      const snap = await ref.get()
      const current = snap.exists
        ? (snap.data()?.groupRole as IMembershipRole | null | undefined)
        : undefined

      if (role) {
        if (current !== role) {
          await ref.set(
            {
              groupRole: role,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
        }
      } else if (snap.exists && current != null) {
        // No group contribution any more — strip the field (preserving any
        // direct `role`/`excluded` on the same doc).
        await ref.update({
          groupRole: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    })
  )
}

/**
 * Workspace ids (within the team) that currently grant `groupId` a role. Reads
 * each workspace's `groupGrants/{groupId}` doc directly — bounded by the team's
 * workspace count — so it needs no collectionGroup index (avoiding the
 * silently-unindexed-collectionGroup footgun). Mirrors the workspace-iteration
 * pattern used by `cleanupDeletedWorkspaceReferences` / `addMemberToWorkspaces`.
 */
export async function listGrantingWorkspaceIdsForGroup(
  teamId: string,
  groupId: string
): Promise<string[]> {
  const wsSnap = await db
    .collection(`teams/${teamId}/workspaces`)
    .select()
    .get()
  if (wsSnap.empty) return []

  const grantRefs = wsSnap.docs.map((ws) =>
    db.doc(`teams/${teamId}/workspaces/${ws.id}/groupGrants/${groupId}`)
  )
  const grantSnaps = await db.getAll(...grantRefs)
  // getAll preserves the order of the refs passed, so index-align back to the
  // workspace id.
  return wsSnap.docs.filter((_, i) => grantSnaps[i]?.exists).map((ws) => ws.id)
}

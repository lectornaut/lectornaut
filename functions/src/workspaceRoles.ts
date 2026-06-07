import { HttpsError } from "firebase-functions/v2/https"
import { admin, db } from "./firebase.js"
import { effectiveRole, isMembershipRole } from "./permissions.js"
import type { IMembershipRole } from "./types.js"

/**
 * Per-workspace role elevation (elevate-only), resolved from TWO sources that
 * both sit on top of a principal's team role:
 *
 *   1. a DIRECT per-member override at
 *        teams/{teamId}/memberships/{principalId}/workspaces/{workspaceId}
 *      (`{ role, excluded }`), and
 *   2. a GROUP grant — the principal belongs to one or more `teams/{teamId}/groups`
 *      (a pure named bundle of members; NO role lives on the group), and a
 *      workspace grants a group a role at
 *        teams/{teamId}/workspaces/{workspaceId}/groupGrants/{groupId} = { role }.
 *      The principal's group-derived role here is the max grant over every group
 *      they belong to.
 *
 * The reader returns `max(directRole, groupRole)` (elevate-only — `effectiveRole`
 * takes the most-privileged). Callers pass it as
 *   can(id, cap, { scope: "workspace", teamRole, workspaceRole })
 * and `can` takes the further max with the team role. A group NEVER changes a
 * principal's team-wide role — it only elevates inside the specific workspace
 * that granted it.
 *
 * AUTHORITATIVE PATH. Functions resolve the group contribution LIVE here (a
 * fresh `groups` array-contains query + `groupGrants` reads) so a stale rules
 * denormalization can never widen real access through the content callables.
 * The rules path can't run that query, so it reads a denormalized `groupRole`
 * field this module keeps in sync on the same override doc (see
 * `recomputeGroupRoleForMembersInWorkspace`); that field gates ONLY the rules
 * read path (collab snapshot writes), and the sync triggers self-heal it.
 *
 * Non-transactional — serves the collab + bot read paths. (audit.ts mutations
 * read the override inside their own transaction and fold the group role the
 * same way via this module's `resolveWorkspaceGroupRole`.)
 */
export async function getWorkspaceRoleOverride(
  teamId: string,
  workspaceId: string,
  principalId: string
): Promise<IMembershipRole | null> {
  const directSnap = await db
    .doc(`teams/${teamId}/memberships/${principalId}/workspaces/${workspaceId}`)
    .get()
  // Exclusion is enforced here, at the shared choke point every content/collab/
  // bot gate resolves through — an excluded principal is a non-member of the
  // workspace, so it has NO effective role (deny). Throwing keeps callers
  // unchanged (they already `await` this) and overrides BOTH the elevate-only
  // direct override and any group elevation (deny beats every elevation).
  if (directSnap.exists && directSnap.data()?.excluded === true) {
    throw new HttpsError(
      "permission-denied",
      "You are not a member of this workspace."
    )
  }
  const directRoleRaw = directSnap.exists ? directSnap.data()?.role : undefined
  const directRole = isMembershipRole(directRoleRaw) ? directRoleRaw : null
  const groupRole = await resolveWorkspaceGroupRole(
    teamId,
    workspaceId,
    principalId
  )
  // Elevate-only across all sources: most-privileged of direct + group.
  return effectiveRole(directRole, groupRole)
}

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
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
        }
      } else if (snap.exists && current != null) {
        // No group contribution any more — strip the field (preserving any
        // direct `role`/`excluded` on the same doc).
        await ref.update({
          groupRole: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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

import { FieldValue } from "firebase-admin/firestore"
import { db } from "./firebase.js"

/**
 * Workspace participation denormalization for airtight LIST-level exclusion.
 *
 * Each workspace doc carries `memberUids`: the HUMAN member uids who participate
 * in it (= team humans minus those excluded). The client lists workspaces with
 * `where("memberUids","array-contains",uid)` and firestore.rules gates the
 * workspace read on `uid in memberUids`, so excluded members never receive the
 * doc at all. Agents are never included — they don't list workspaces.
 *
 * Seeding has two layers, both idempotent (`arrayUnion`), so a member ends up in
 * every workspace's list with no migration:
 *   - `acceptInvitation` adds the new member INSIDE its transaction (atomic +
 *     instant on the primary join path).
 *   - the `onMembershipCreatedSeedWorkspaces` trigger adds them on ANY membership
 *     create (a uniform catch-all that also covers SSO auto-provisioning, which
 *     writes the membership directly, and self-heals via `retry: true`).
 *
 * Removal runs post-commit, best-effort, in the safe direction: a stale uid left
 * in `memberUids` after a failed remove is harmless because the workspace read
 * ALSO requires team membership (which the remove just revoked), so it fails
 * closed.
 */

/** Add a member to every workspace's `memberUids` (idempotent — `arrayUnion`). */
export async function addMemberToWorkspaces(
  teamId: string,
  uid: string
): Promise<void> {
  const snap = await db.collection(`teams/${teamId}/workspaces`).select().get()
  if (snap.empty) return
  const batch = db.batch()
  for (const ws of snap.docs) {
    batch.update(ws.ref, {
      memberUids: FieldValue.arrayUnion(uid),
    })
  }
  await batch.commit()
}

/** Remove a member from every workspace's `memberUids` (e.g. on team leave). */
export async function removeMemberFromWorkspaces(
  teamId: string,
  uid: string
): Promise<void> {
  const snap = await db.collection(`teams/${teamId}/workspaces`).select().get()
  if (snap.empty) return
  const batch = db.batch()
  for (const ws of snap.docs) {
    batch.update(ws.ref, {
      memberUids: FieldValue.arrayRemove(uid),
    })
  }
  await batch.commit()
}

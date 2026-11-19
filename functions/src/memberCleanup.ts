/**
 * What a departing member leaves behind in a team, swept after the
 * authoritative membership-removal transaction (audit.ts `removeMember` /
 * `removeMembers`, which also covers leaving):
 *
 *   1. Connection bindings: provider grant revoked, binding + secret docs
 *      deleted (connections.ts).
 *   2. Workflow opt-ins ("Run for me"): the `subscribers/{uid}` doc under
 *      `workspaces/{w}/workflows/{id}`.
 *   3. ONLY when the remover asked for it: the member's PRIVATE chats and
 *      memories. Shared items are never deleted; left alone otherwise.
 *
 * Best-effort per item and NEVER throws: the removal already committed and
 * must stand. Failures are logged and counted. The counts (no content) are
 * appended to the removal's existing audit entry.
 */

import * as logger from "firebase-functions/logger"
import { deleteBotSessionHistory } from "./botSnapshotStore.js"
import { cleanupMemberConnectionBindings } from "./connections.js"
import { db } from "./firebase.js"
import { purgePrivateMemories } from "./memory.js"

export interface MemberCleanupCounts {
  connectionsRemoved: number
  workflowOptInsRemoved: number
  /** Present only when private content deletion was requested. */
  privateSessionsDeleted?: number
  privateMemoriesDeleted?: number
  /** Items that could not be cleaned up (details are in the function logs). */
  cleanupFailures: number
}

// ponytail: sessions are deleted a few at a time inside the callable; a member
// with thousands of private chats could outlast its timeout. Move the sweep to
// a task queue if that ever shows up in the logs.
const SESSION_DELETE_CONCURRENCY = 10

export async function cleanupDepartedMember(
  teamId: string,
  uid: string,
  options: { deletePrivateContent: boolean }
): Promise<MemberCleanupCounts> {
  const counts: MemberCleanupCounts = {
    connectionsRemoved: 0,
    workflowOptInsRemoved: 0,
    cleanupFailures: 0,
  }
  if (options.deletePrivateContent) {
    counts.privateSessionsDeleted = 0
    counts.privateMemoriesDeleted = 0
  }

  /** Run one item; a failure is logged and counted, never rethrown. */
  const attempt: Attempt = async (step, work, fallback) => {
    try {
      return await work()
    } catch (error) {
      counts.cleanupFailures += 1
      logger.warn("[memberCleanup] step failed (ignored)", {
        teamId,
        uid,
        step,
        error,
      })
      return fallback
    }
  }

  // Never throws; per-provider failures are logged inside.
  counts.connectionsRemoved = await cleanupMemberConnectionBindings(teamId, uid)

  const workspaces = await attempt(
    "listWorkspaces",
    async () =>
      (await db.collection(`teams/${teamId}/workspaces`).select().get()).docs,
    []
  )

  for (const workspace of workspaces) {
    counts.workflowOptInsRemoved += await removeWorkflowOptIns(
      workspace.ref,
      uid,
      attempt
    )
    if (!options.deletePrivateContent) continue
    counts.privateMemoriesDeleted! += await attempt(
      "memories",
      () => purgePrivateMemories(teamId, workspace.id, uid),
      0
    )
    counts.privateSessionsDeleted! += await deletePrivateSessions(
      teamId,
      workspace.ref,
      uid,
      attempt
    )
  }

  return counts
}

type Attempt = <T>(
  step: string,
  work: () => Promise<T>,
  fallback: T
) => Promise<T>

/** Drop `uid`'s opt-in from every workflow in one workspace. */
async function removeWorkflowOptIns(
  workspace: FirebaseFirestore.DocumentReference,
  uid: string,
  attempt: Attempt
): Promise<number> {
  const workflows = await attempt(
    "listWorkflows",
    async () => (await workspace.collection("workflows").select().get()).docs,
    []
  )
  const results = await Promise.all(
    workflows.map((workflow) =>
      attempt<number>(
        "workflowOptIn",
        async () => {
          const subscriberRef = workflow.ref.collection("subscribers").doc(uid)
          if (!(await subscriberRef.get()).exists) return 0
          await subscriberRef.delete()
          return 1
        },
        0
      )
    )
  )
  return results.reduce((sum, n) => sum + n, 0)
}

/**
 * Delete every chat `uid` owns in one workspace that is not shared. A record
 * with no `visibility` is private (same default as bot.ts `readSessionDoc`),
 * so the filter is "not shared" rather than an equality query.
 */
async function deletePrivateSessions(
  teamId: string,
  workspace: FirebaseFirestore.DocumentReference,
  uid: string,
  attempt: Attempt
): Promise<number> {
  const sessions = await attempt(
    "listSessions",
    async () =>
      (
        await workspace
          .collection("botSessions")
          .where("ownerUid", "==", uid)
          .select("visibility")
          .get()
      ).docs.filter((doc) => doc.get("visibility") !== "shared"),
    []
  )
  let deleted = 0
  for (let i = 0; i < sessions.length; i += SESSION_DELETE_CONCURRENCY) {
    const results = await Promise.all(
      sessions.slice(i, i + SESSION_DELETE_CONCURRENCY).map((session) =>
        attempt<number>(
          "session",
          async () => {
            // History first, so a failure leaves the record to retry from
            // (same order as the `deleteBotSession` callable).
            await deleteBotSessionHistory({
              teamId,
              workspaceId: workspace.id,
              sessionId: session.id,
            })
            await session.ref.delete()
            return 1
          },
          0
        )
      )
    )
    deleted += results.reduce((sum, n) => sum + n, 0)
  }
  return deleted
}

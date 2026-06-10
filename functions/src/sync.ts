/**
 * Sync operation settlement — the server half of the client's outbox engine
 * (`src/utils/firebase/firebase-sync-engine.ts`).
 *
 * One shared transaction (`settleSyncOperation`) validates and applies a
 * client-submitted operation document, reached through TWO entry points:
 *
 *  - `onSyncOperationCreated` — the Firestore create trigger. Fires once per
 *    op doc via Eventarc; the historical (and backstop) path.
 *  - `applySyncOperation` — a callable the client invokes right after creating
 *    the op doc (and on every retry). Request/response, so settlement does not
 *    depend on Eventarc delivery — a lost/wedged create event no longer
 *    strands the operation until the client dead-letters it.
 *
 * Both paths race safely: the transaction re-reads the op doc and only
 * processes `status == "pending"`, so whichever settles first wins and the
 * loser no-ops (returning the existing verdict). All parsing/routing/payload
 * validation lives in `syncSettlement.ts` (pure, `node --test`-covered).
 */
import type {
  DocumentReference,
  DocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore"
import { FieldValue } from "firebase-admin/firestore"
import * as logger from "firebase-functions/logger"
import { onDocumentCreated } from "firebase-functions/v2/firestore"
import { HttpsError } from "firebase-functions/v2/https"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { z } from "zod"
import { COST_BUDGET } from "./costBudget.js"
import { defineCallable } from "./defineCallable.js"
import { db } from "./firebase.js"
import { cleanupExpiredIdempotencyLocks } from "./idempotency.js"
import {
  Capabilities,
  isMembershipRole,
  resolveAuthorization,
} from "./permissions.js"
import {
  REGION,
  SCHEDULED_OPTS,
  SYNC_CALLABLE_OPTS,
  TRIGGER_OPTS,
} from "./runtimeConfig.js"
import {
  applyMutation,
  assertContentManagementAllowed,
  parseOperation,
  routeSyncOperation,
  splitPath,
  SyncRejectError,
  toRejectDetails,
  validateBaseVersion,
  validateSnapshotBinding,
  verdictFromOperationData,
  type SyncOperation,
  type SyncOperationRoute,
  type SyncSettlementVerdict,
} from "./syncSettlement.js"
import { resolveParticipation } from "./workspaceRoles.js"

const operationRefFor = (
  userId: string,
  operationId: string
): DocumentReference => db.doc(`users/${userId}/syncOperations/${operationId}`)

interface SettlementReadPlan {
  targetRef: DocumentReference
  membershipRef: DocumentReference | null
}

const planSettlementReads = (
  operation: SyncOperation,
  route: SyncOperationRoute
): SettlementReadPlan => ({
  targetRef: db.doc(operation.targetPath),
  membershipRef: route.membershipTeamId
    ? db.doc(`teams/${route.membershipTeamId}/memberships/${operation.userId}`)
    : null,
})

/**
 * Rules parity for workspace-content targets (snapshots). Membership existence
 * alone admits principals the direct-write rules
 * (`canManageWorkspaceContentIn`) deny — guests and workspace-excluded
 * members — so resolve the SAME canonical decision the content callables use:
 * the `resolveAuthorization` scope walk over `MANAGE_WORKSPACE_CONTENT`, with
 * `resolveParticipation` folding in exclusion and the elevate-only
 * per-workspace/group overrides (a plain team-role check would falsely reject
 * elevate-only members). The team role comes from the membership snapshot the
 * settlement already fetched; the direct override doc is read through the
 * transaction so it joins the settlement's read set (group grants stay
 * non-transactional, matching `resolveParticipation`'s documented contract).
 * Throws `SyncRejectError` on denial, settling as a rejection verdict.
 */
const requireContentManagement = async (
  transaction: Transaction,
  userId: string,
  membershipSnap: DocumentSnapshot,
  target: { teamId: string; workspaceId: string }
): Promise<void> => {
  const roleRaw = membershipSnap.data()?.role
  const decision = await resolveAuthorization(
    userId,
    Capabilities.MANAGE_WORKSPACE_CONTENT,
    {
      teamRole: isMembershipRole(roleRaw) ? roleRaw : null,
      resolveParticipation: () =>
        resolveParticipation(
          target.teamId,
          target.workspaceId,
          userId,
          transaction
        ),
    }
  )
  assertContentManagementAllowed(decision)
}

/**
 * Validate + apply one pending sync operation in a single transaction and
 * write its settlement (`ack`/`reject`) back onto the operation document.
 *
 * Returns the settlement verdict, the EXISTING verdict when another settler
 * already won the race, or `null` when the operation document does not exist.
 *
 * `operationHint` is the trigger's `event.data` payload: when present, the
 * target + membership refs are derived from it so every document the
 * settlement needs is fetched alongside the op doc in ONE transactional
 * `getAll` round trip. The hint never decides anything — the transactional
 * re-read of the op doc stays authoritative (op payload fields are immutable
 * under the security rules, so the prefetch matches; any miss is fetched
 * again below).
 */
export const settleSyncOperation = async (
  userId: string,
  operationId: string,
  operationHint?: FirebaseFirestore.DocumentData
): Promise<SyncSettlementVerdict | null> => {
  const operationRef = operationRefFor(userId, operationId)

  try {
    return await db.runTransaction(
      async (transaction): Promise<SyncSettlementVerdict | null> => {
        const prefetched = new Map<string, DocumentSnapshot>()
        let operationSnap: DocumentSnapshot | undefined

        if (operationHint) {
          try {
            const hintOperation = parseOperation(
              operationHint,
              userId,
              operationId
            )
            if (hintOperation.status === "pending") {
              const plan = planSettlementReads(
                hintOperation,
                routeSyncOperation(hintOperation, userId)
              )
              const refs = [operationRef, plan.targetRef]
              if (plan.membershipRef) refs.push(plan.membershipRef)
              const snaps = await transaction.getAll(...refs)
              for (const snap of snaps) prefetched.set(snap.ref.path, snap)
              operationSnap = prefetched.get(operationRef.path)
            }
          } catch {
            // Unusable hint — fall through to the sequential reads below. Any
            // genuine parse/route violation re-surfaces from the authoritative
            // copy and settles as a rejection.
          }
        }

        if (!operationSnap) {
          operationSnap = await transaction.get(operationRef)
        }
        if (!operationSnap.exists) {
          return null
        }

        const operationData = operationSnap.data() ?? {}
        const operation = parseOperation(operationData, userId, operationId)
        if (operation.status !== "pending") {
          // Another settler (trigger vs. callable vs. trigger retry) already
          // processed this operation — report its verdict instead of
          // re-applying.
          return verdictFromOperationData(operationData)
        }

        const route = routeSyncOperation(operation, userId)
        const { targetRef, membershipRef } = planSettlementReads(
          operation,
          route
        )

        let targetSnap = prefetched.get(targetRef.path)
        let membershipSnap = membershipRef
          ? prefetched.get(membershipRef.path)
          : null
        const missing: DocumentReference[] = []
        if (!targetSnap) missing.push(targetRef)
        if (membershipRef && !membershipSnap) missing.push(membershipRef)
        if (missing.length > 0) {
          const snaps = await transaction.getAll(...missing)
          for (const snap of snaps) {
            if (snap.ref.path === targetRef.path) targetSnap = snap
            else if (snap.ref.path === membershipRef?.path)
              membershipSnap = snap
          }
        }
        if (!targetSnap) {
          // Structurally unreachable — getAll returns a snapshot per ref.
          throw new Error("Sync settlement failed to load the target document")
        }

        if (membershipRef && !membershipSnap?.exists) {
          throw new SyncRejectError(
            "permission-denied",
            "User is not a team member"
          )
        }

        // Membership above only proves the CLAIMED team is real for this user;
        // this binds the claim to the target document's actual team/workspace.
        validateSnapshotBinding(targetSnap, operation)

        // Content targets need more than membership: the full role/exclusion
        // decision, evaluated against the (now bound) team + workspace pair.
        // Runs before applyMutation so its transactional override read
        // precedes the transaction's writes.
        if (route.contentAuthorization) {
          if (!membershipSnap) {
            // Structurally unreachable — a content target always routes a
            // membership ref, fetched above.
            throw new Error(
              "Sync settlement failed to load the membership document"
            )
          }
          await requireContentManagement(
            transaction,
            userId,
            membershipSnap,
            route.contentAuthorization
          )
        }

        validateBaseVersion(targetSnap, operation.baseVersion)

        applyMutation(
          transaction,
          targetRef,
          operation,
          targetSnap,
          splitPath(operation.targetPath),
          userId
        )

        transaction.set(
          operationRef,
          {
            status: "ack",
            ack: {
              code: null,
              message: null,
              atMs: Date.now(),
            },
            processedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        return { status: "ack", code: null, message: null }
      }
    )
  } catch (error) {
    const rejectDetails = toRejectDetails(error)
    // Wrap in a conditional transaction to prevent overwriting a successful
    // "ack" if this settler races another (trigger retry, callable retry).
    return await db.runTransaction(
      async (tx): Promise<SyncSettlementVerdict | null> => {
        const snap = await tx.get(operationRef)
        if (!snap.exists) return null
        const data = snap.data()
        if (data?.status !== "pending") {
          return verdictFromOperationData(data)
        }
        tx.set(
          operationRef,
          {
            status: "reject",
            ack: {
              code: rejectDetails.code,
              message: rejectDetails.message,
              atMs: Date.now(),
            },
            processedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        return {
          status: "reject",
          code: rejectDetails.code,
          message: rejectDetails.message,
        }
      }
    )
  }
}

export const onSyncOperationCreated = onDocumentCreated(
  {
    document: "users/{userId}/syncOperations/{operationId}",
    retry: true,
    region: REGION,
    memory: TRIGGER_OPTS.memory,
    timeoutSeconds: TRIGGER_OPTS.timeoutSeconds,
    maxInstances: TRIGGER_OPTS.maxInstances,
    concurrency: TRIGGER_OPTS.concurrency,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const { userId, operationId } = event.params
    await settleSyncOperation(userId, operationId, snapshot.data())
  }
)

const applySyncOperationInput = z.object({
  operationId: z.string().min(1),
})

/**
 * Direct, Eventarc-free settlement path for the client's sync outbox. The
 * client invokes this immediately after creating the operation document (and
 * re-invokes it on retry); the response carries the same verdict the ack
 * listener would eventually observe, so the client settles through one shared
 * entry point either way.
 *
 * The op ref is derived from the CALLER's uid, so cross-user settlement is
 * structurally impossible. A `"reject"` verdict is a normal return value —
 * only transport/internal failures surface as errors, which the client
 * treats as soft (the create trigger remains the backstop).
 */
export const applySyncOperation = defineCallable({
  name: "applySyncOperation",
  input: applySyncOperationInput,
  opts: SYNC_CALLABLE_OPTS,
  handler: async ({ auth, input }): Promise<SyncSettlementVerdict> => {
    const verdict = await settleSyncOperation(auth.uid, input.operationId)
    if (!verdict) {
      throw new HttpsError("not-found", "Sync operation not found")
    }
    return verdict
  },
})

// ============================================================================
// Cleanup: Remove settled sync operations older than 24 hours
// ============================================================================

const SYNC_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
/**
 * Orphaned-pending retention. An op can stay "pending" remotely forever when
 * its create event was lost AND its client never returned to retry (clients
 * dead-letter locally in under a minute while online). 7 days is far beyond
 * any legitimate offline-outbox replay window.
 */
const SYNC_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = COST_BUDGET.MAX_BATCH_SIZE

const deleteQueryBatches = async (
  buildQuery: () => FirebaseFirestore.Query
): Promise<number> => {
  let totalDeleted = 0
  let hasMore = true

  while (hasMore) {
    const stale = await buildQuery().limit(CLEANUP_BATCH_SIZE).get()

    if (stale.empty) {
      break
    }

    const batch = db.batch()
    stale.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
    totalDeleted += stale.size

    if (stale.size < CLEANUP_BATCH_SIZE) {
      hasMore = false
    }
  }

  return totalDeleted
}

/**
 * COST OPTIMIZATION: Uses collectionGroup("syncOperations") to directly
 * find stale operations across ALL users in a single query, instead of
 * iterating every user document first.
 *
 * Before: O(users) reads to get user list + O(stale_ops) reads to find ops
 * After:  O(stale_ops / batch_size) queries only — skips reading user docs entirely
 *
 * Requires composite indexes on the "syncOperations" collection group:
 *   status (ASC) + processedAt (ASC)   — settled sweep
 *   status (ASC) + createdAt (ASC)     — orphaned-pending sweep
 */
export const cleanupSyncOperations = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "UTC",
    retryCount: 1,
    ...SCHEDULED_OPTS,
  },
  async () => {
    const settledCutoff = new Date(Date.now() - SYNC_TTL_MS)
    const totalDeleted = await deleteQueryBatches(() =>
      db
        .collectionGroup("syncOperations")
        .where("status", "in", ["ack", "reject"])
        .where("processedAt", "<", settledCutoff)
    )

    // Orphaned-pending sweep: ops whose create event was lost are stuck at
    // "pending" with no settler left to touch them — the settled sweep above
    // never matches, so without this they accumulate unboundedly.
    const pendingCutoff = new Date(Date.now() - SYNC_PENDING_TTL_MS)
    const orphanedDeleted = await deleteQueryBatches(() =>
      db
        .collectionGroup("syncOperations")
        .where("status", "==", "pending")
        .where("createdAt", "<", pendingCutoff)
    )

    const deletedEventLocks = await cleanupExpiredIdempotencyLocks({
      batchSize: CLEANUP_BATCH_SIZE,
    })

    logger.info(
      `[cleanupSyncOperations] Deleted ${totalDeleted} stale sync operations, ${orphanedDeleted} orphaned pending operations, and ${deletedEventLocks} stale event locks`
    )
  }
)

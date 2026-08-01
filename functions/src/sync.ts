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
  CALLABLE_OPTS,
  REGION,
  SCHEDULED_OPTS,
  TRIGGER_OPTS,
} from "./runtimeConfig.js"
import {
  applyMutation,
  applySyncOperationInput,
  assertContentManagementAllowed,
  buildSettlementOutcomeLog,
  buildSettlementVerdictFields,
  isTerminalSyncRejection,
  isTransientSyncError,
  parseOperation,
  resolveSettlementSource,
  routeSyncOperation,
  splitPath,
  stripSettledPayloadFields,
  SyncRejectError,
  toRejectDetails,
  triggerFailureRejectDetails,
  validateBaseVersion,
  validateCarriedOperation,
  validateSnapshotBinding,
  verdictFromOperationData,
  type SettlementLogSource,
  type SettlementOutcomeLog,
  type SyncOperation,
  type SyncOperationRoute,
  type SyncSettlementVerdict,
} from "./syncSettlement.js"
import { resolveParticipation } from "./workspaceRoles.js"

const operationRefFor = (
  userId: string,
  operationId: string
): DocumentReference => db.doc(`users/${userId}/syncOperations/${operationId}`)

/**
 * The ONE structured line per settlement outcome — emitted only by the
 * settler that WROTE the verdict (race-loser echoes of an existing verdict
 * stay silent, so one settled op produces one line). Info for acks, warn for
 * rejects; the payload is `buildSettlementOutcomeLog`'s ids-and-kinds-only
 * shape.
 */
const logSettlementOutcome = (entry: SettlementOutcomeLog): void => {
  const message = `[syncSettlement] ${entry.verdict} ${entry.routeKind} (${entry.source})`
  if (entry.verdict === "ack") {
    logger.info(message, entry)
  } else {
    logger.warn(message, entry)
  }
}

/**
 * What one settlement attempt resolved: the verdict to report, whether THIS
 * settler wrote it (`freshlySettled` — false for race-loser echoes and
 * not-found), and the op's target path for the outcome log's route
 * classifier (null when the doc never carried a usable one).
 */
interface SettledOperationOutcome {
  verdict: SyncSettlementVerdict | null
  freshlySettled: boolean
  targetPath: string | null
}

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
 * Content authorization for workspace-content targets (snapshots) — the
 * settlement is the ONLY snapshot write path (the rules' direct-write clauses
 * were removed). Membership existence alone admits principals content
 * management denies — guests and workspace-excluded members — so resolve the
 * SAME canonical decision the content callables use:
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
 * Durably write a reject verdict onto the operation document. Wrapped in a
 * conditional transaction to prevent overwriting a successful "ack" if this
 * settler races another (trigger retry, callable retry) — a non-pending op
 * returns the existing verdict instead (`freshlySettled: false`, so the
 * caller does not re-log an outcome another settler already logged).
 */
const settleRejectVerdict = async (
  operationRef: DocumentReference,
  rejectDetails: { code: string; message: string }
): Promise<SettledOperationOutcome> =>
  db.runTransaction(async (tx): Promise<SettledOperationOutcome> => {
    const snap = await tx.get(operationRef)
    if (!snap.exists) {
      return { verdict: null, freshlySettled: false, targetPath: null }
    }
    const data = snap.data()
    if (data?.status !== "pending") {
      return {
        verdict: verdictFromOperationData(data),
        freshlySettled: false,
        targetPath: null,
      }
    }
    const verdict: SyncSettlementVerdict = {
      status: "reject",
      code: rejectDetails.code,
      message: rejectDetails.message,
      updatedAtMillis: null,
    }
    tx.set(
      operationRef,
      buildSettlementVerdictFields(verdict, Date.now(), "merge"),
      { merge: true }
    )
    return {
      verdict,
      freshlySettled: true,
      targetPath: typeof data.targetPath === "string" ? data.targetPath : null,
    }
  })

/**
 * Validate + apply one pending sync operation in a single transaction and
 * write its settlement (`ack`/`reject`) back onto the operation document.
 *
 * Returns the settlement verdict, the EXISTING verdict when another settler
 * already won the race, or `null` when the operation document does not exist.
 * `source` labels the entry point ("trigger" | "callable" |
 * "callable-carried") on the structured outcome log, which is emitted ONLY
 * when this call freshly settles the op (see `logSettlementOutcome`).
 *
 * Only a `SyncRejectError` settles as a durable reject; any other failure
 * (Firestore contention, infrastructure blips, coding bugs) is RETHROWN to
 * the entry point, which surfaces it as a retryable error — the client treats
 * a reject verdict as terminal and rolls back optimistic state, so a
 * transient must never settle as one.
 *
 * `carriedOperation` is the callable's payload carry (create-if-absent),
 * ALREADY validated via `validateCarriedOperation` against the caller's uid +
 * operationId: when the op doc does not exist, the carried fields become the
 * authoritative op document — written ONCE at the end of this transaction,
 * already carrying its settlement verdict, so the create and the settlement
 * commit atomically. The create fires `onSyncOperationCreated` afterwards;
 * the trigger finds a settled doc and returns the existing verdict (the
 * race-loser path). When the doc DOES exist the carried payload is ignored
 * (the doc is authoritative) beyond serving as a prefetch hint. Absent doc +
 * no payload keeps the pre-carry not-found contract for old clients.
 *
 * Read order is path-specific on purpose. The carry path prefetches the
 * op/target/membership refs in ONE transactional `getAll` (the doc is
 * usually ABSENT there, so every prefetched read is needed; the hint never
 * decides anything — the transactional re-read stays authoritative and any
 * miss is fetched again below). Every OTHER caller — the trigger and the
 * callable's carry-less retries — reads the op doc ALONE first: the callable
 * normally wins the settlement race, so the trigger's re-read usually finds
 * an already-settled doc and returns its verdict after a single read,
 * instead of billing 1-2 wasted target/membership reads on nearly every op.
 * The extra sequential `getAll` round trip lands only when a carry-less
 * caller actually settles — the rare backstop path, where latency is
 * irrelevant.
 */
export const settleSyncOperation = async (
  userId: string,
  operationId: string,
  source: SettlementLogSource,
  carriedOperation?: FirebaseFirestore.DocumentData
): Promise<SyncSettlementVerdict | null> => {
  const operationRef = operationRefFor(userId, operationId)
  const startedAtMs = Date.now()

  // Fresh settlements (this settler wrote the verdict) emit the ONE
  // structured outcome line; race-loser echoes stay silent.
  const emitFreshOutcome = (outcome: SettledOperationOutcome): void => {
    if (!outcome.freshlySettled || !outcome.verdict) return
    logSettlementOutcome(
      buildSettlementOutcomeLog({
        operationId,
        targetPath: outcome.targetPath,
        source,
        verdict: outcome.verdict,
        horizonExhausted: false,
        durationMs: Date.now() - startedAtMs,
      })
    )
  }

  try {
    const outcome = await db.runTransaction(
      async (transaction): Promise<SettledOperationOutcome> => {
        const prefetched = new Map<string, DocumentSnapshot>()
        let operationSnap: DocumentSnapshot | undefined

        if (carriedOperation) {
          try {
            const hintOperation = parseOperation(
              carriedOperation,
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
            // Unusable carry — fall through to the sequential reads below. Any
            // genuine parse/route violation re-surfaces from the authoritative
            // copy and settles as a rejection.
          }
        }

        if (!operationSnap) {
          operationSnap = await transaction.get(operationRef)
        }

        // exists → settle the existing doc; absent+carry → create from the
        // carried payload; absent+no-carry → null (the pre-carry not-found
        // contract). Pure decision table on `resolveSettlementSource`.
        const settlementSource = resolveSettlementSource(
          operationSnap.exists,
          operationSnap.data(),
          carriedOperation
        )
        if (!settlementSource) {
          return { verdict: null, freshlySettled: false, targetPath: null }
        }
        const operationData = settlementSource.data
        const createFromCarried = settlementSource.createFromCarried
        const rawTargetPath =
          typeof operationData.targetPath === "string"
            ? operationData.targetPath
            : null

        // Single write per outcome: the carried path CREATES the op doc with
        // its verdict already applied (a create-then-merge pair on one doc in
        // one transaction is avoided on purpose); the existing-doc path
        // merges the verdict on as before. The transactional re-read above
        // makes the absent→create decision serializable: a racing settler
        // creating the same doc aborts this commit and the retry re-reads it.
        // Both outcomes settle PAYLOAD-STRIPPED (no `data`/`baseVersion` —
        // see `buildSettlementVerdictFields`): the merge path deletes the
        // fields, the create path births the doc without them.
        const writeSettlement = (verdict: SyncSettlementVerdict) => {
          const fields = buildSettlementVerdictFields(
            verdict,
            Date.now(),
            createFromCarried ? "create" : "merge"
          )
          if (createFromCarried) {
            transaction.create(operationRef, {
              ...stripSettledPayloadFields(operationData),
              createdAt: FieldValue.serverTimestamp(),
              ...fields,
            })
          } else {
            transaction.set(operationRef, fields, { merge: true })
          }
        }

        try {
          const operation = parseOperation(operationData, userId, operationId)
          if (operation.status !== "pending") {
            // Another settler (trigger vs. callable vs. trigger retry) already
            // processed this operation — report its verdict instead of
            // re-applying (and without re-logging its outcome).
            return {
              verdict: verdictFromOperationData(operationData),
              freshlySettled: false,
              targetPath: null,
            }
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
            throw new Error(
              "Sync settlement failed to load the target document"
            )
          }

          if (membershipRef && !membershipSnap?.exists) {
            throw new SyncRejectError(
              "permission-denied",
              "User is not a team member"
            )
          }

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

          // Membership above only proves the CLAIMED team is real for this
          // user. An existing snapshot provides its own immutable binding;
          // on a first snapshot, verify the collab room that was created only
          // after the underlying content node was authorized. This extra read
          // happens once per snapshot document, never on its hot update path.
          // It deliberately follows the content-authority check so an
          // unauthorized member cannot force the additional document read.
          let roomSnap: DocumentSnapshot | undefined
          if (route.contentAuthorization && !targetSnap.exists) {
            const contentId = splitPath(operation.targetPath)[1]
            if (!contentId) {
              throw new Error("Snapshot target path is missing its content ID")
            }
            roomSnap = await transaction.get(db.doc(`signaling/${contentId}`))
          }
          validateSnapshotBinding(targetSnap, operation, roomSnap)

          validateBaseVersion(targetSnap, operation.baseVersion)

          const updatedAtMillis = applyMutation(
            transaction,
            targetRef,
            operation,
            targetSnap,
            splitPath(operation.targetPath),
            userId
          )

          const verdict: SyncSettlementVerdict = {
            status: "ack",
            code: null,
            message: null,
            updatedAtMillis,
          }
          writeSettlement(verdict)
          return {
            verdict,
            freshlySettled: true,
            targetPath: operation.targetPath,
          }
        } catch (error) {
          // The carried-create path settles a terminal rejection INSIDE this
          // transaction — there is no doc for the outer `settleRejectVerdict`
          // to write onto. Safe: every `SyncRejectError` fires before the
          // first transaction write, so no partial mutation is buffered.
          if (!createFromCarried || !isTerminalSyncRejection(error)) {
            throw error
          }
          const details = toRejectDetails(error)
          const verdict: SyncSettlementVerdict = {
            status: "reject",
            code: details.code,
            message: details.message,
            updatedAtMillis: null,
          }
          writeSettlement(verdict)
          return { verdict, freshlySettled: true, targetPath: rawTargetPath }
        }
      }
    )
    emitFreshOutcome(outcome)
    return outcome.verdict
  } catch (error) {
    if (!isTerminalSyncRejection(error)) throw error
    const rejected = await settleRejectVerdict(
      operationRef,
      toRejectDetails(error)
    )
    emitFreshOutcome(rejected)
    return rejected.verdict
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
    if (!event.data) return

    // Deliberately no `event.data` prefetch hint: the callable normally wins
    // the settlement race, so this path mostly re-reads an already-settled
    // doc — see `settleSyncOperation`'s read-order note.
    const { userId, operationId } = event.params
    const startedAtMs = Date.now()
    try {
      await settleSyncOperation(userId, operationId, "trigger")
    } catch (error) {
      // Retryable failure: rethrow so `retry: true` redelivers with backoff,
      // but only inside the give-up horizon — the event timestamp is fixed at
      // doc creation, so a deterministic bug settles as a reject instead of
      // redelivering for the full 7-day retry window.
      const eventAgeMs = Date.now() - Date.parse(event.time)
      const rejectDetails = triggerFailureRejectDetails(error, eventAgeMs)
      if (!rejectDetails) throw error
      logger.warn(
        `[onSyncOperationCreated] users/${userId}/syncOperations/${operationId}: ${rejectDetails.message}`,
        error
      )
      const rejected = await settleRejectVerdict(
        operationRefFor(userId, operationId),
        rejectDetails
      )
      if (rejected.freshlySettled && rejected.verdict) {
        logSettlementOutcome(
          buildSettlementOutcomeLog({
            operationId,
            targetPath: rejected.targetPath,
            source: "trigger",
            verdict: rejected.verdict,
            // A terminal rejection reaching this catch settles on its own
            // merits; anything else got here because the retry horizon ran
            // out on a retryable failure.
            horizonExhausted: !isTerminalSyncRejection(error),
            durationMs: Date.now() - startedAtMs,
          })
        )
      }
    }
  }
)

/**
 * Direct, Eventarc-free settlement path for the client's sync outbox. The
 * client invokes this immediately — carrying the op payload on first send,
 * so the server creates the op doc AND settles it in one transaction (no
 * client setDoc round trip first) — and re-invokes it without the payload on
 * retries of already-created docs. The response carries the same verdict the
 * ack listener would eventually observe, so the client settles through one
 * shared entry point either way.
 *
 * The op ref is derived from the CALLER's uid, so cross-user settlement is
 * structurally impossible; a carried payload naming another user or
 * operation is refused before it is used. A `"reject"` verdict is a normal
 * return value — only transient/internal failures surface as errors, which
 * the client treats as soft (warn + retry ladder / setDoc fallback; the
 * create trigger remains the backstop).
 */
export const applySyncOperation = defineCallable({
  name: "applySyncOperation",
  // Parity with every other public-invoker callable (botSessionCrud,
  // connections, …): enforce App Check pre-handler. If a client cannot
  // produce a token the invocation fails in transport, which the engine
  // treats as SOFT — setDoc fallback + create-trigger backstop keep writes
  // flowing on the slower path (see `requestCarriedSettlement`).
  appCheck: true,
  input: applySyncOperationInput,
  opts: CALLABLE_OPTS,
  handler: async ({ auth, input }): Promise<SyncSettlementVerdict> => {
    let carried: FirebaseFirestore.DocumentData | undefined
    if (input.operation) {
      const validation = validateCarriedOperation(
        input.operation,
        auth.uid,
        input.operationId
      )
      if (!validation.ok) {
        // No doc exists to settle a reject onto, so a bad carry is a callable
        // ERROR, not a verdict — the client falls back to the setDoc path,
        // where the security rules hand down the equivalent denial.
        throw new HttpsError(validation.code, validation.message)
      }
      carried = input.operation
    }
    let verdict: SyncSettlementVerdict | null
    try {
      verdict = await settleSyncOperation(
        auth.uid,
        input.operationId,
        carried ? "callable-carried" : "callable",
        carried
      )
    } catch (error) {
      // Surfacing an ERROR keeps the op pending so the client's retry ladder
      // re-invokes this callable; unknown errors fall through to the facade's
      // `internal` mask, which also logs the original error server-side.
      if (isTransientSyncError(error)) {
        throw new HttpsError(
          "unavailable",
          "Sync settlement is temporarily unavailable."
        )
      }
      throw error
    }
    if (!verdict) {
      // `operationMissing` lets the client tell THIS deliberate "the op doc
      // does not exist" verdict apart from the transport-level 404 the SDK
      // also surfaces as `functions/not-found` (undeployed callable, region
      // misroute) — the engine's terminal not-found disposition requires it
      // (see `isDefinitiveNotFound`), so an infra 404 can never roll back a
      // healthy write.
      throw new HttpsError("not-found", "Sync operation not found", {
        operationMissing: true,
      })
    }
    return verdict
  },
})

// ============================================================================
// Cleanup: Remove orphaned pending sync operations
//
// SETTLED operations are no longer swept here: every settlement stamps an
// `expireAt` (settlement instant + `SYNC_TTL_MS`, see
// `buildSettlementVerdictFields`), and a native Firestore TTL policy on
// `syncOperations.expireAt` deletes them — no scheduled query, no composite
// index, no read-then-delete billing. Until the operator enables that policy
// settled docs merely accumulate past their 2h horizon; nothing reads them.
// ============================================================================

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
 * Requires a composite index on the "syncOperations" collection group:
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
    // Orphaned-pending sweep: ops whose create event was lost are stuck at
    // "pending" with no settler left to touch them (and no `expireAt`, so the
    // native TTL policy never matches either) — without this they accumulate
    // unboundedly.
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
      `[cleanupSyncOperations] Deleted ${orphanedDeleted} orphaned pending operations and ${deletedEventLocks} stale event locks`
    )
  }
)

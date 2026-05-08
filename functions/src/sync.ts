import * as logger from "firebase-functions/logger"
import { onDocumentCreated } from "firebase-functions/v2/firestore"
import { onSchedule } from "firebase-functions/v2/scheduler"
import { COST_BUDGET } from "./costBudget.js"
import { admin, db } from "./firebase.js"
import { cleanupExpiredIdempotencyLocks } from "./idempotency.js"
import { REGION, SCHEDULED_OPTS, TRIGGER_OPTS } from "./runtimeConfig.js"
import {
  normalizeComparable,
  type NotificationStatus,
  type SyncBaseVersion,
  type SyncMutationType,
  type SyncOperationStatus,
} from "./types.js"
const NOTIFICATION_STATUSES = new Set<NotificationStatus>([
  "inbox",
  "saved",
  "done",
])
const MAX_SNAPSHOT_BASE64_LENGTH = 1_000_000

interface SyncOperation {
  id: string
  userId: string
  source: string
  targetPath: string
  type: SyncMutationType
  data: Record<string, unknown> | null
  merge: boolean
  baseVersion: SyncBaseVersion | null
  status: SyncOperationStatus
}

/**
 * Custom error for sync operation rejections. Uses a subset of HttpsError codes
 * but is intentionally NOT an HttpsError because sync operations run inside
 * Firestore triggers (not HTTP callables). The trigger handler catches these
 * and writes the rejection status back to the operation document.
 */
class SyncRejectError extends Error {
  constructor(
    readonly code:
      | "invalid-argument"
      | "permission-denied"
      | "failed-precondition"
      | "not-found",
    message: string
  ) {
    super(message)
  }
}

const reject = (
  code:
    | "invalid-argument"
    | "permission-denied"
    | "failed-precondition"
    | "not-found",
  message: string
): never => {
  throw new SyncRejectError(code, message)
}

const assertString = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    reject("invalid-argument", `${field} must be a string`)
  }
  const stringValue = value as string
  const trimmed = stringValue.trim()
  if (!trimmed.length) {
    reject("invalid-argument", `${field} cannot be empty`)
  }
  return trimmed
}

const assertObjectRecord = (
  value: unknown,
  field: string
): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("invalid-argument", `${field} must be an object`)
  }
  return value as Record<string, unknown>
}

const parseOperation = (
  data: FirebaseFirestore.DocumentData,
  userIdFromPath: string,
  operationIdFromPath: string
): SyncOperation => {
  const id = assertString(data.id ?? operationIdFromPath, "id")
  const userId = assertString(data.userId, "userId")
  const source = assertString(data.source ?? "unknown", "source")
  const targetPath = assertString(data.targetPath, "targetPath")

  if (id !== operationIdFromPath) {
    reject("invalid-argument", "Operation ID mismatch")
  }

  if (userId !== userIdFromPath) {
    reject("permission-denied", "Cannot submit operations for another user")
  }

  const type = data.type
  if (type !== "set" && type !== "update" && type !== "delete") {
    reject("invalid-argument", "Unsupported mutation type")
  }

  const status = data.status
  if (status !== "pending" && status !== "ack" && status !== "reject") {
    reject("invalid-argument", "Unsupported operation status")
  }

  const merge = data.merge === true

  let operationData: Record<string, unknown> | null = null
  if (type !== "delete") {
    operationData = assertObjectRecord(data.data ?? {}, "data")
  }

  const baseVersionRaw = data.baseVersion
  let baseVersion: SyncBaseVersion | null = null
  if (baseVersionRaw !== null && baseVersionRaw !== undefined) {
    const parsedBase = assertObjectRecord(baseVersionRaw, "baseVersion")
    const field = assertString(parsedBase.field, "baseVersion.field")
    const value = parsedBase.value
    if (
      value !== null &&
      typeof value !== "number" &&
      typeof value !== "string"
    ) {
      reject(
        "invalid-argument",
        "baseVersion.value must be number, string, or null"
      )
    }
    baseVersion = {
      field,
      value: value as number | string | null,
    }
  }

  return {
    id,
    userId,
    source,
    targetPath,
    type,
    data: operationData,
    merge,
    baseVersion,
    status,
  }
}

const splitPath = (path: string): string[] =>
  path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

const ensureTeamMembership = async (
  transaction: admin.firestore.Transaction,
  teamId: string,
  userId: string
) => {
  const membershipRef = db.doc(`teams/${teamId}/memberships/${userId}`)
  const membershipSnap = await transaction.get(membershipRef)
  if (!membershipSnap.exists) {
    reject("permission-denied", "User is not a team member")
  }
}

const assertNullableString = (value: unknown, field: string) => {
  if (value !== null && typeof value !== "string") {
    reject("invalid-argument", `${field} must be a string or null`)
  }
}

const assertBoolean = (value: unknown, field: string) => {
  if (typeof value !== "boolean") {
    reject("invalid-argument", `${field} must be a boolean`)
  }
}

const assertAllowedKeys = (
  payload: Record<string, unknown>,
  allowedKeys: Set<string>,
  errorMessage: string
) => {
  const keys = Object.keys(payload)
  if (keys.some((key) => !allowedKeys.has(key))) {
    reject("permission-denied", errorMessage)
  }
}

const validateUserProfilePayload = (
  path: string[],
  operation: SyncOperation
) => {
  const payload = operation.data ?? {}
  assertAllowedKeys(
    payload,
    new Set(["uid", "email", "displayName", "photoURL"]),
    "User profile updates contain blocked fields"
  )

  if ("uid" in payload && payload.uid !== path[1]) {
    reject("permission-denied", "User profile uid cannot be changed")
  }
  if ("email" in payload) {
    assertNullableString(payload.email, "users.email")
  }
  if ("displayName" in payload) {
    assertNullableString(payload.displayName, "users.displayName")
  }
  if ("photoURL" in payload) {
    assertNullableString(payload.photoURL, "users.photoURL")
  }
}

const validateUserPreferencesPayload = (operation: SyncOperation) => {
  const payload = operation.data ?? {}
  assertAllowedKeys(
    payload,
    new Set([
      "currentTeamId",
      "onboarding",
      "badgeCount",
      "fileDropOverlayDragDrop",
      "fileDropOverlayShortcut",
    ]),
    "User preference updates contain blocked fields"
  )

  if ("currentTeamId" in payload) {
    assertNullableString(payload.currentTeamId, "preferences.currentTeamId")
  }
  if ("onboarding" in payload) {
    assertBoolean(payload.onboarding, "preferences.onboarding")
  }
  if ("badgeCount" in payload) {
    assertBoolean(payload.badgeCount, "preferences.badgeCount")
  }
  if ("fileDropOverlayDragDrop" in payload) {
    assertBoolean(
      payload.fileDropOverlayDragDrop,
      "preferences.fileDropOverlayDragDrop"
    )
  }
  if ("fileDropOverlayShortcut" in payload) {
    assertBoolean(
      payload.fileDropOverlayShortcut,
      "preferences.fileDropOverlayShortcut"
    )
  }
}

const validateMembershipPreferencesPayload = (operation: SyncOperation) => {
  const payload = operation.data ?? {}
  assertAllowedKeys(
    payload,
    new Set(["currentWorkspaceId"]),
    "Membership preference updates contain blocked fields"
  )

  if ("currentWorkspaceId" in payload) {
    assertNullableString(
      payload.currentWorkspaceId,
      "preferences.currentWorkspaceId"
    )
  }
}

const validateUserDocumentMutation = (
  path: string[],
  operation: SyncOperation
) => {
  if (path.length !== 2) return false
  if (operation.type === "delete") {
    reject("permission-denied", "User document cannot be deleted via sync")
  }
  validateUserProfilePayload(path, operation)
  return true
}

const validateUserLayoutMutation = (
  path: string[],
  operation: SyncOperation
) => {
  if (path.length !== 4) return false
  if (path[2] !== "layout") return false

  const layoutId = path[3]
  if (layoutId !== "navigation") {
    reject("permission-denied", "Invalid user layout target")
  }

  if (operation.type === "delete") {
    reject("permission-denied", "Layout documents cannot be deleted via sync")
  }

  return true
}

const validateUserSettingsMutation = (
  path: string[],
  operation: SyncOperation
) => {
  if (path.length !== 4) return false
  if (path[2] !== "settings") return false

  const settingId = path[3]
  if (
    settingId !== "notifications" &&
    settingId !== "preferences" &&
    settingId !== "themes"
  ) {
    reject("permission-denied", "Invalid user settings target")
  }

  if (operation.type === "delete") {
    reject("permission-denied", "Settings documents cannot be deleted via sync")
  }

  if (settingId === "preferences") {
    validateUserPreferencesPayload(operation)
  }

  return true
}

const validateNotificationMutation = (
  path: string[],
  operation: SyncOperation
) => {
  if (path.length !== 4) return false
  if (path[2] !== "notifications") return false

  if (operation.type === "set") {
    reject("permission-denied", "Notifications cannot be created via sync")
  }

  if (operation.type === "delete") {
    reject("permission-denied", "Notifications cannot be deleted via sync")
  }

  if (operation.type === "update") {
    const keys = Object.keys(operation.data ?? {})
    if (!keys.length) {
      reject("invalid-argument", "Notification update payload is empty")
    }
    const allowed = new Set(["read", "status"])
    if (keys.some((key) => !allowed.has(key))) {
      reject("permission-denied", "Notification updates contain blocked fields")
    }
    if (
      "read" in (operation.data ?? {}) &&
      typeof operation.data?.read !== "boolean"
    ) {
      reject("invalid-argument", "notifications.read must be a boolean")
    }
    if ("status" in (operation.data ?? {})) {
      const status = operation.data?.status
      if (
        typeof status !== "string" ||
        !NOTIFICATION_STATUSES.has(status as NotificationStatus)
      ) {
        reject("invalid-argument", "notifications.status is invalid")
      }
    }
  }

  return true
}

const validateTabsLayoutMutation = async (
  transaction: admin.firestore.Transaction,
  path: string[],
  operation: SyncOperation,
  userId: string
) => {
  if (path.length !== 8) return false
  if (path[0] !== "teams" || path[2] !== "memberships") return false
  if (path[4] !== "workspaces" || path[6] !== "layout" || path[7] !== "tabs") {
    return false
  }

  const targetUserId = path[3]
  if (targetUserId !== userId) {
    reject("permission-denied", "Cannot mutate another member's tabs")
  }

  if (operation.type === "delete") {
    reject("permission-denied", "Tabs layout cannot be deleted via sync")
  }

  const teamId = path[1]
  await ensureTeamMembership(transaction, teamId, userId)
  return true
}

const validateMembershipSettingsMutation = async (
  transaction: admin.firestore.Transaction,
  path: string[],
  operation: SyncOperation,
  userId: string
) => {
  if (path.length !== 6) return false
  if (path[0] !== "teams" || path[2] !== "memberships") return false
  if (path[4] !== "settings" || path[5] !== "preferences") return false

  const targetUserId = path[3]
  if (targetUserId !== userId) {
    reject("permission-denied", "Cannot mutate another member's preferences")
  }

  if (operation.type === "delete") {
    reject(
      "permission-denied",
      "Membership preference documents cannot be deleted via sync"
    )
  }

  validateMembershipPreferencesPayload(operation)
  await ensureTeamMembership(transaction, path[1], userId)
  return true
}

const validateSnapshotMutation = async (
  transaction: admin.firestore.Transaction,
  path: string[],
  operation: SyncOperation,
  userId: string
) => {
  if (path.length !== 2 || path[0] !== "snapshots") return false

  if (operation.type === "delete") {
    reject("permission-denied", "Snapshots cannot be deleted via sync")
  }

  const payload = operation.data ?? {}
  assertAllowedKeys(
    payload,
    new Set([
      "contentId",
      "teamId",
      "workspaceId",
      "updatedAt",
      "updatedBy",
      "ydocBase64",
    ]),
    "Snapshot updates contain blocked fields"
  )

  const contentId = assertString(payload.contentId, "snapshots.contentId")
  if (contentId !== path[1]) {
    reject("permission-denied", "Snapshot contentId does not match target path")
  }

  const teamId = assertString(payload.teamId, "snapshots.teamId")
  assertString(payload.workspaceId, "snapshots.workspaceId")

  if (payload.updatedBy !== userId) {
    reject("permission-denied", "Snapshot updatedBy must match current user")
  }

  const ydocBase64 = assertString(payload.ydocBase64, "snapshots.ydocBase64")
  if (ydocBase64.length > MAX_SNAPSHOT_BASE64_LENGTH) {
    reject("invalid-argument", "Snapshot payload is too large")
  }

  await ensureTeamMembership(transaction, teamId, userId)
  return true
}

const validateBaseVersion = (
  targetSnap: FirebaseFirestore.DocumentSnapshot,
  baseVersion: SyncBaseVersion | null
) => {
  if (!baseVersion) return

  if (!targetSnap.exists) {
    reject(
      "failed-precondition",
      `Base version check failed because target document does not exist`
    )
  }

  const actual = normalizeComparable(targetSnap.get(baseVersion.field))
  if (actual !== baseVersion.value) {
    reject(
      "failed-precondition",
      `Base version mismatch for "${baseVersion.field}"`
    )
  }
}

const validateOperationAccess = async (
  transaction: admin.firestore.Transaction,
  operation: SyncOperation,
  userId: string
) => {
  const path = splitPath(operation.targetPath)
  if (path.length < 2) {
    reject("permission-denied", "Invalid target path")
  }

  if (path[0] === "users") {
    if (path[1] !== userId) {
      reject("permission-denied", "Cannot mutate another user")
    }

    if (validateUserDocumentMutation(path, operation)) return
    if (validateUserLayoutMutation(path, operation)) return
    if (validateUserSettingsMutation(path, operation)) return
    if (validateNotificationMutation(path, operation)) return

    reject("permission-denied", "Unsupported user mutation target")
  }

  const handledTabsMutation = await validateTabsLayoutMutation(
    transaction,
    path,
    operation,
    userId
  )
  if (handledTabsMutation) return

  const handledMembershipSettingsMutation =
    await validateMembershipSettingsMutation(
      transaction,
      path,
      operation,
      userId
    )
  if (handledMembershipSettingsMutation) return

  const handledSnapshotMutation = await validateSnapshotMutation(
    transaction,
    path,
    operation,
    userId
  )
  if (handledSnapshotMutation) return

  reject("permission-denied", "Unsupported sync mutation target")
}

const isUserRootPathForUser = (path: string[], userId: string): boolean =>
  path.length === 2 && path[0] === "users" && path[1] === userId

const isUserPreferencesPathForUser = (
  path: string[],
  userId: string
): boolean =>
  path.length === 4 &&
  path[0] === "users" &&
  path[1] === userId &&
  path[2] === "settings" &&
  path[3] === "preferences"

const isMembershipPreferencesPathForUser = (
  path: string[],
  userId: string
): boolean =>
  path.length === 6 &&
  path[0] === "teams" &&
  path[2] === "memberships" &&
  path[3] === userId &&
  path[4] === "settings" &&
  path[5] === "preferences"

const isSnapshotPath = (path: string[]): boolean =>
  path.length === 2 && path[0] === "snapshots"

const withServerManagedFields = (
  payload: Record<string, unknown>,
  targetSnap: FirebaseFirestore.DocumentSnapshot,
  path: string[],
  userId: string
): Record<string, unknown> => {
  const shouldStampUpdatedAt =
    isUserRootPathForUser(path, userId) ||
    isUserPreferencesPathForUser(path, userId) ||
    isMembershipPreferencesPathForUser(path, userId) ||
    isSnapshotPath(path)

  if (!shouldStampUpdatedAt) {
    return payload
  }

  const nextPayload: Record<string, unknown> = {
    ...payload,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  if (
    isUserRootPathForUser(path, userId) &&
    !targetSnap.exists &&
    !("createdAt" in nextPayload)
  ) {
    nextPayload.createdAt = admin.firestore.FieldValue.serverTimestamp()
    nextPayload.username = null
    nextPayload.isPublic = false
  }

  if (isSnapshotPath(path)) {
    nextPayload.updatedBy = userId
  }

  return nextPayload
}

const applyMutation = (
  transaction: admin.firestore.Transaction,
  targetRef: FirebaseFirestore.DocumentReference,
  operation: SyncOperation,
  targetSnap: FirebaseFirestore.DocumentSnapshot,
  path: string[],
  userId: string
) => {
  if (operation.type === "delete") {
    transaction.delete(targetRef)
    return
  }

  const payload = withServerManagedFields(
    operation.data ?? {},
    targetSnap,
    path,
    userId
  )
  if (operation.type === "set") {
    transaction.set(targetRef, payload, { merge: operation.merge })
    return
  }

  if (Object.keys(payload).length === 0) {
    reject("invalid-argument", "Update payload cannot be empty")
  }

  transaction.update(targetRef, payload)
}

const toRejectDetails = (error: unknown) => {
  if (error instanceof SyncRejectError) {
    return {
      code: error.code,
      message: error.message,
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return {
      code: (error as { code: string }).code,
      message: (error as { message: string }).message,
    }
  }

  return {
    code: "internal",
    message: "Unexpected sync error",
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
    const operationRef = snapshot.ref

    try {
      await db.runTransaction(async (transaction) => {
        const currentOperationSnap = await transaction.get(operationRef)
        if (!currentOperationSnap.exists) {
          return
        }

        const operation = parseOperation(
          currentOperationSnap.data() ?? {},
          userId,
          operationId
        )

        if (operation.status !== "pending") {
          return
        }

        await validateOperationAccess(transaction, operation, userId)

        const targetRef = db.doc(operation.targetPath)
        const targetPath = splitPath(operation.targetPath)
        const targetSnap = await transaction.get(targetRef)
        validateBaseVersion(targetSnap, operation.baseVersion)

        applyMutation(
          transaction,
          targetRef,
          operation,
          targetSnap,
          targetPath,
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
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      })
    } catch (error) {
      const rejectDetails = toRejectDetails(error)
      // Wrap in a conditional transaction to prevent overwriting a successful
      // "ack" if this invocation races with a retry (retry: true is set on trigger)
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(operationRef)
        if (!snap.exists || snap.data()?.status !== "pending") return
        tx.set(
          operationRef,
          {
            status: "reject",
            ack: {
              code: rejectDetails.code,
              message: rejectDetails.message,
              atMs: Date.now(),
            },
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      })
    }
  }
)

// ============================================================================
// Cleanup: Remove settled sync operations older than 24 hours
// ============================================================================

const SYNC_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const CLEANUP_BATCH_SIZE = COST_BUDGET.MAX_BATCH_SIZE

/**
 * COST OPTIMIZATION: Uses collectionGroup("syncOperations") to directly
 * find stale operations across ALL users in a single query, instead of
 * iterating every user document first.
 *
 * Before: O(users) reads to get user list + O(stale_ops) reads to find ops
 * After:  O(stale_ops / batch_size) queries only — skips reading user docs entirely
 *
 * Requires a composite index on the "syncOperations" collection group:
 *   status (ASC) + processedAt (ASC)
 */
export const cleanupSyncOperations = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "UTC",
    retryCount: 1,
    ...SCHEDULED_OPTS,
  },
  async () => {
    const cutoff = new Date(Date.now() - SYNC_TTL_MS)
    let totalDeleted = 0
    let hasMore = true

    while (hasMore) {
      // Query directly across all users' syncOperations subcollections
      const staleOps = await db
        .collectionGroup("syncOperations")
        .where("status", "in", ["ack", "reject"])
        .where("processedAt", "<", cutoff)
        .limit(CLEANUP_BATCH_SIZE)
        .get()

      if (staleOps.empty) {
        hasMore = false
        break
      }

      const batch = db.batch()
      staleOps.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
      totalDeleted += staleOps.size

      // If we got fewer than the batch size, no more stale ops remain
      if (staleOps.size < CLEANUP_BATCH_SIZE) {
        hasMore = false
      }
    }

    const deletedEventLocks = await cleanupExpiredIdempotencyLocks({
      batchSize: CLEANUP_BATCH_SIZE,
    })

    logger.info(
      `[cleanupSyncOperations] Deleted ${totalDeleted} stale sync operations and ${deletedEventLocks} stale event locks`
    )
  }
)

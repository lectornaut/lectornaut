/**
 * Pure sync-settlement logic: parsing, target routing, payload validation,
 * base-version checks, and verdict mapping for client-submitted sync
 * operations.
 *
 * This module is deliberately free of the Firestore client (`db`) so the
 * "is this operation acceptable and where may it write" decisions can be
 * unit-tested with `node --test` in isolation — mirroring the client's
 * `firebase-sync-queue.ts` / `firebase-sync-engine.ts` split. `sync.ts` owns
 * all the side effects: the settlement transaction, the create trigger, the
 * `applySyncOperation` callable, and the scheduled cleanup.
 */
// `normalizeComparable` comes from the shared workspace package DIRECTLY (not
// the `./domain.js` shim the rest of functions code uses): a runtime relative
// `.js` import would fail module resolution under `node --test
// --experimental-strip-types` (only type-only local imports are erased).
// esbuild inlines the shared module either way, so the deploy bundle is
// identical.
import { normalizeComparable } from "@lectornaut/shared/domain"
import type { DocumentSnapshot, Transaction } from "firebase-admin/firestore"
import { FieldValue } from "firebase-admin/firestore"
import type { AuthDecision } from "./permissions.js"
import type {
  NotificationStatus,
  SyncBaseVersion,
  SyncMutationType,
  SyncOperationStatus,
} from "./types.js"

const NOTIFICATION_STATUSES = new Set<NotificationStatus>([
  "inbox",
  "saved",
  "done",
])
export const MAX_SNAPSHOT_BASE64_LENGTH = 1_000_000

export interface SyncOperation {
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
 * The settlement outcome for one operation. Returned by the server seam to
 * BOTH settlement entry points (trigger + callable) and mirrored verbatim to
 * the client, which feeds it through `applyRemoteSettlement` exactly like an
 * ack-listener snapshot.
 */
export interface SyncSettlementVerdict {
  status: "ack" | "reject"
  code: string | null
  message: string | null
}

/**
 * Routing result for a validated operation: which team membership (if any)
 * must exist before the mutation may apply. `null` for user-scoped targets.
 *
 * `contentAuthorization` is present when the target is workspace CONTENT
 * (snapshots): membership existence alone is not enough — the settlement must
 * also pass the canonical `MANAGE_WORKSPACE_CONTENT` decision (role gate +
 * workspace exclusion + elevate-only per-workspace/group overrides), mirroring
 * the direct-write rules (`canCreateSnapshot`/`canUpdateSnapshot` →
 * `canManageWorkspaceContentIn`). `null` for the own-doc team targets (tabs,
 * membership preferences), where any member — including guests — may write
 * their own documents.
 */
export interface SyncOperationRoute {
  membershipTeamId: string | null
  contentAuthorization: { teamId: string; workspaceId: string } | null
}

/**
 * Custom error for sync operation rejections. Uses a subset of HttpsError codes
 * but is intentionally NOT an HttpsError because sync operations also run
 * inside the Firestore trigger (not just the callable). The settlement seam
 * catches these and writes the rejection status back to the operation document.
 */
export type SyncRejectCode =
  "invalid-argument" | "permission-denied" | "failed-precondition" | "not-found"

export class SyncRejectError extends Error {
  // Explicit field (not a constructor parameter property) so the module stays
  // loadable under `node --test --experimental-strip-types`, which cannot
  // erase parameter properties.
  readonly code: SyncRejectCode

  constructor(code: SyncRejectCode, message: string) {
    super(message)
    this.code = code
  }
}

const reject = (code: SyncRejectCode, message: string): never => {
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

export const parseOperation = (
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

export const splitPath = (path: string): string[] =>
  path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

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
      "fileDropOverlayShortcutKeys",
      "readAloudEnabled",
      "dictationEnabled",
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
  if ("fileDropOverlayShortcutKeys" in payload) {
    // Not assertString: empty means "shortcut cleared" and must settle.
    if (typeof payload.fileDropOverlayShortcutKeys !== "string") {
      reject(
        "invalid-argument",
        "preferences.fileDropOverlayShortcutKeys must be a string"
      )
    }
  }
  if ("readAloudEnabled" in payload) {
    assertBoolean(payload.readAloudEnabled, "preferences.readAloudEnabled")
  }
  if ("dictationEnabled" in payload) {
    assertBoolean(payload.dictationEnabled, "preferences.dictationEnabled")
  }
}

const validateUserShortcutsPayload = (operation: SyncOperation) => {
  // Shortcut overrides are a user-owned map where REMOVING a key is a normal
  // edit (reset to default). Firestore's set+merge deep-merges maps and can
  // never remove keys, so this route only accepts a FULL replace: the client
  // sends the complete map as a non-merge set. Rejecting merge writes keeps
  // the "deleted override resurrects on the next snapshot" bug class
  // structurally impossible.
  if (operation.type !== "set" || operation.merge) {
    reject(
      "invalid-argument",
      "Shortcut overrides must be written as a full replace"
    )
  }

  const payload = operation.data ?? {}
  assertAllowedKeys(
    payload,
    new Set(["overrides"]),
    "Shortcut settings updates contain blocked fields"
  )

  const overrides = payload.overrides
  if (
    typeof overrides !== "object" ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    reject("invalid-argument", "shortcuts.overrides must be a map")
  }
  for (const value of Object.values(overrides as Record<string, unknown>)) {
    if (typeof value !== "string") {
      reject("invalid-argument", "shortcuts.overrides values must be strings")
    }
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
    settingId !== "themes" &&
    settingId !== "shortcuts"
  ) {
    reject("permission-denied", "Invalid user settings target")
  }

  if (operation.type === "delete") {
    reject("permission-denied", "Settings documents cannot be deleted via sync")
  }

  if (settingId === "preferences") {
    validateUserPreferencesPayload(operation)
  }

  if (settingId === "shortcuts") {
    validateUserShortcutsPayload(operation)
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

const routeTabsLayoutMutation = (
  path: string[],
  operation: SyncOperation,
  userId: string
): SyncOperationRoute | false => {
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

  return { membershipTeamId: path[1] as string, contentAuthorization: null }
}

const routeMembershipSettingsMutation = (
  path: string[],
  operation: SyncOperation,
  userId: string
): SyncOperationRoute | false => {
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
  return { membershipTeamId: path[1] as string, contentAuthorization: null }
}

const routeSnapshotMutation = (
  path: string[],
  operation: SyncOperation,
  userId: string
): SyncOperationRoute | false => {
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
  const workspaceId = assertString(payload.workspaceId, "snapshots.workspaceId")

  if (payload.updatedBy !== userId) {
    reject("permission-denied", "Snapshot updatedBy must match current user")
  }

  const ydocBase64 = assertString(payload.ydocBase64, "snapshots.ydocBase64")
  if (ydocBase64.length > MAX_SNAPSHOT_BASE64_LENGTH) {
    reject("invalid-argument", "Snapshot payload is too large")
  }

  return {
    membershipTeamId: teamId,
    contentAuthorization: { teamId, workspaceId },
  }
}

/**
 * Validate the operation's target path + payload (throwing `SyncRejectError`
 * on any violation, exactly as the pre-extraction `validateOperationAccess`
 * did) and return which team membership must exist before the mutation may
 * apply. Pure: the caller fetches the membership doc — alongside the target —
 * in a single transactional `getAll` round trip.
 */
export const routeSyncOperation = (
  operation: SyncOperation,
  userId: string
): SyncOperationRoute => {
  const path = splitPath(operation.targetPath)
  if (path.length < 2) {
    reject("permission-denied", "Invalid target path")
  }

  if (path[0] === "users") {
    if (path[1] !== userId) {
      reject("permission-denied", "Cannot mutate another user")
    }

    if (
      validateUserDocumentMutation(path, operation) ||
      validateUserLayoutMutation(path, operation) ||
      validateUserSettingsMutation(path, operation) ||
      validateNotificationMutation(path, operation)
    ) {
      return { membershipTeamId: null, contentAuthorization: null }
    }

    reject("permission-denied", "Unsupported user mutation target")
  }

  const route =
    routeTabsLayoutMutation(path, operation, userId) ||
    routeMembershipSettingsMutation(path, operation, userId) ||
    routeSnapshotMutation(path, operation, userId)
  if (route) return route

  return reject("permission-denied", "Unsupported sync mutation target")
}

export const validateBaseVersion = (
  targetSnap: DocumentSnapshot,
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

/**
 * Bind a snapshot OVERWRITE to the existing document's team + workspace.
 *
 * Snapshot membership is authorized against the CLIENT-claimed
 * `payload.teamId` (the `snapshots/{contentId}` path carries no team), so
 * without this check a member of ANY team could overwrite another team's
 * snapshot by naming its contentId while claiming a team they do belong to.
 * Mirrors the direct-write rules (`canUpdateSnapshot`), which freeze both
 * fields once the document exists — content can never move teams or
 * workspaces, so a mismatch is always hostile or corrupt, never stale.
 *
 * For creates the claimed-team membership check remains the only binding
 * (rules parity: `canCreateSnapshot` authorizes against the claimed pair;
 * the payload carries no node-scope segment to verify the content against,
 * and unborn contentIds are unguessable Firestore auto-ids).
 */
export const validateSnapshotBinding = (
  targetSnap: DocumentSnapshot,
  operation: SyncOperation
) => {
  const path = splitPath(operation.targetPath)
  if (!isSnapshotPath(path)) return
  if (!targetSnap.exists) return

  const payload = operation.data ?? {}
  if (targetSnap.get("teamId") !== payload.teamId) {
    reject(
      "permission-denied",
      "Snapshot teamId does not match the existing document"
    )
  }
  if (targetSnap.get("workspaceId") !== payload.workspaceId) {
    reject(
      "permission-denied",
      "Snapshot workspaceId does not match the existing document"
    )
  }
}

/**
 * Map the canonical `MANAGE_WORKSPACE_CONTENT` decision onto the sync
 * rejection channel. The settlement resolves the SAME `resolveAuthorization`
 * walk the content callables use (team role + workspace exclusion +
 * elevate-only per-workspace/group overrides); this turns a denial into a
 * `SyncRejectError` — not an `HttpsError`, so both settlement entry points
 * (trigger + callable) record it as a rejection verdict. Messages mirror
 * `authorize.ts` (`DENY_MESSAGES` + the content callables' deny text) so a
 * denial reads identically whichever write path surfaced it.
 */
export const assertContentManagementAllowed = (
  decision: Pick<AuthDecision, "allowed" | "deniedReason">
): void => {
  if (decision.allowed) return
  if (decision.deniedReason === "excluded") {
    reject("permission-denied", "You are not a member of this workspace.")
  }
  if (decision.deniedReason === "not-team-member") {
    reject("permission-denied", "User is not a team member.")
  }
  reject(
    "permission-denied",
    "You do not have permission to manage workspace content."
  )
}

export const withServerManagedFields = (
  payload: Record<string, unknown>,
  targetSnap: DocumentSnapshot,
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
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (
    isUserRootPathForUser(path, userId) &&
    !targetSnap.exists &&
    !("createdAt" in nextPayload)
  ) {
    nextPayload.createdAt = FieldValue.serverTimestamp()
    nextPayload.username = null
    nextPayload.isPublic = false
  }

  if (isSnapshotPath(path)) {
    nextPayload.updatedBy = userId
  }

  return nextPayload
}

export const applyMutation = (
  transaction: Transaction,
  targetRef: FirebaseFirestore.DocumentReference,
  operation: SyncOperation,
  targetSnap: DocumentSnapshot,
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

export const toRejectDetails = (
  error: unknown
): { code: string; message: string } => {
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

/**
 * Map a settled operation document's data to a verdict. Returns null when the
 * document is still pending (or carries an unknown status) — i.e. there is no
 * settlement to report yet.
 */
export const verdictFromOperationData = (
  data: FirebaseFirestore.DocumentData | undefined
): SyncSettlementVerdict | null => {
  const status = data?.status
  if (status !== "ack" && status !== "reject") return null
  const ack = (data?.ack ?? null) as {
    code?: unknown
    message?: unknown
  } | null
  return {
    status,
    code: typeof ack?.code === "string" ? ack.code : null,
    message: typeof ack?.message === "string" ? ack.message : null,
  }
}

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
import { FieldValue, Timestamp } from "firebase-admin/firestore"
import { z } from "zod"
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
  /**
   * The target document's post-settlement `updatedAt` (epoch ms) when the
   * settlement stamped one (an ack on a server-managed-field path), else
   * null. Carried in BOTH the op-doc ack details and the callable's direct
   * response so the client can refresh an OCC base version without waiting
   * for the target snapshot to round-trip.
   */
  updatedAtMillis: number | null
}

/**
 * Routing result for a validated operation: which team membership (if any)
 * must exist before the mutation may apply. `null` for user-scoped targets.
 *
 * `contentAuthorization` is present when the target is workspace CONTENT
 * (snapshots): membership existence alone is not enough — the settlement must
 * also pass the canonical `MANAGE_WORKSPACE_CONTENT` decision (role gate +
 * workspace exclusion + elevate-only per-workspace/group overrides) from
 * `shared/permissions.ts`. The settlement is the ONLY snapshot write path —
 * the rules' direct create/update clauses (`canCreateSnapshot`/
 * `canUpdateSnapshot`) were removed, so this decision is authoritative, not a
 * mirror. `null` for the own-doc team targets (tabs, membership preferences),
 * where any member — including guests — may write their own documents.
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

export type CarriedOperationValidation =
  | { ok: true; operation: SyncOperation }
  | {
      ok: false
      code: "invalid-argument" | "permission-denied"
      message: string
    }

/**
 * Gate a callable-carried op payload (create-if-absent) the way the security
 * rules gate a direct op-doc create (`isValidSyncOperationCreate`): the doc
 * path derives EXCLUSIVELY from the authenticated uid + operationId, so a
 * payload naming another user or operation must be refused outright — there
 * is no doc to settle a reject onto, so the caller surfaces this as a
 * callable error, never a verdict. Structural parsing is shared with the
 * settlement's authoritative re-read (`parseOperation`); on top of it this
 * enforces the create-only constraints: status must be `"pending"` and
 * `clientId` must be a non-empty string (rules parity — the ack listener is
 * clientId-scoped, so a doc created without one would strand its verdict).
 */
export const validateCarriedOperation = (
  payload: Record<string, unknown>,
  authUid: string,
  operationId: string
): CarriedOperationValidation => {
  try {
    const operation = parseOperation(payload, authUid, operationId)
    if (operation.status !== "pending") {
      return {
        ok: false,
        code: "invalid-argument",
        message: "Carried operation must be pending",
      }
    }
    if (typeof payload.clientId !== "string" || !payload.clientId.trim()) {
      return {
        ok: false,
        code: "invalid-argument",
        message: "clientId must be a non-empty string",
      }
    }
    return { ok: true, operation }
  } catch (error) {
    if (error instanceof SyncRejectError) {
      return {
        ok: false,
        code:
          error.code === "permission-denied"
            ? "permission-denied"
            : "invalid-argument",
        message: error.message,
      }
    }
    throw error
  }
}

/**
 * Wire shape of a payload-carried operation: the remote op-doc fields the
 * client would otherwise write via `setDoc` — minus `createdAt` (the server
 * stamps it) and `ack` (only a settler writes it). Structural gate only; the
 * binding constraints (id/uid/status parity with
 * `isValidSyncOperationCreate` in firestore.rules) are enforced by
 * `validateCarriedOperation` in the handler. Old already-deployed clients
 * simply omit `operation`; old servers strip the unknown key (Zod strip
 * mode) and keep answering not-found, which new clients downgrade to the
 * setDoc path.
 */
const carriedOperationInput = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  clientId: z.string().min(1),
  source: z.string().min(1),
  targetPath: z.string().min(1),
  type: z.enum(["set", "update", "delete"]),
  data: z.record(z.string(), z.unknown()).nullable(),
  merge: z.boolean(),
  baseVersion: z
    .object({
      field: z.string().min(1),
      value: z.union([z.number(), z.string(), z.null()]),
    })
    .nullable(),
  status: z.literal("pending"),
  attempts: z.number().int().min(0),
  createdAtClient: z.number(),
  updatedAtClient: z.number(),
  sentAtClient: z.number().nullable(),
})

/**
 * `applySyncOperation`'s input schema. `operation` (payload carry) MUST stay
 * optional: old already-deployed clients send `{ operationId }` alone, and a
 * required key would break every one of them mid-flight.
 */
export const applySyncOperationInput = z.object({
  operationId: z.string().min(1),
  operation: carriedOperationInput.optional(),
})

/**
 * Where the settlement transaction sources the authoritative operation data
 * from, given the transactional re-read of the op doc and the callable's
 * (already validated) carried payload:
 *
 *  - doc exists            → settle the EXISTING doc (any carry is ignored
 *    beyond its prefetch-hint role — the doc is authoritative)
 *  - doc absent, carry     → create the op doc FROM the carried payload,
 *    settled in the same transaction (`createFromCarried`)
 *  - doc absent, no carry  → `null`: the pre-carry not-found contract old
 *    clients rely on (the callable answers not-found; the client falls back
 *    to the setDoc path)
 */
export interface SettlementSource {
  data: FirebaseFirestore.DocumentData
  createFromCarried: boolean
}

export const resolveSettlementSource = (
  operationExists: boolean,
  operationData: FirebaseFirestore.DocumentData | undefined,
  carriedOperation: FirebaseFirestore.DocumentData | undefined
): SettlementSource | null => {
  if (operationExists) {
    return { data: operationData ?? {}, createFromCarried: false }
  }
  if (carriedOperation) {
    return { data: carriedOperation, createFromCarried: true }
  }
  return null
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
 * Freezes both fields once the document exists (the guarantee the retired
 * direct-write rule `canUpdateSnapshot` used to give) — content can never
 * move teams or workspaces, so a mismatch is always hostile or corrupt,
 * never stale.
 *
 * For creates the collaboration room is the authoritative binding: it is
 * created only after the collab callable verifies the underlying content node,
 * and it carries the content, team, and workspace ids together. Without that
 * check, a member of one team who learns another team's content id could create
 * a poisoned first snapshot under their own team and prevent the real team from
 * ever reading it. Existing snapshots need no extra room read because their
 * immutable binding above already provides that protection.
 */
export const validateSnapshotBinding = (
  targetSnap: DocumentSnapshot,
  operation: SyncOperation,
  roomSnap?: DocumentSnapshot
) => {
  const path = splitPath(operation.targetPath)
  if (!isSnapshotPath(path)) return

  const payload = operation.data ?? {}
  if (!targetSnap.exists) {
    const room = roomSnap?.data() ?? {}
    if (!roomSnap?.exists) {
      reject(
        "failed-precondition",
        "Collaboration room is not initialized for this snapshot"
      )
    }
    if (
      room.contentId !== payload.contentId ||
      room.teamId !== payload.teamId ||
      room.workspaceId !== payload.workspaceId
    ) {
      reject(
        "permission-denied",
        "Snapshot metadata does not match the collaboration room"
      )
    }
    return
  }

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

export interface ServerManagedFieldsResult {
  payload: Record<string, unknown>
  /** Epoch ms of the `updatedAt` stamped onto the payload, when one was. */
  updatedAtMillis: number | null
}

/**
 * Monotonic settlement stamp for server-managed `updatedAt` fields.
 * `Timestamp.now()` is INSTANCE wall clock: with cross-instance skew a later
 * settlement could otherwise stamp an EARLIER millis than the previous one,
 * and every consumer that max()-picks OCC tokens from acks (the client's
 * `selectFreshestUpdatedAtMillis`) would wedge on the skewed-high cached
 * value. Advance at least 1ms past the target's previous `updatedAt` — the
 * settlement transaction already holds the target snapshot, so this costs no
 * extra read. A non-numeric previous value (absent doc, corrupt field) falls
 * back to `now` unchanged.
 */
export const monotonicUpdatedAtStamp = (
  now: Timestamp,
  previousUpdatedAt: unknown
): Timestamp => {
  const previousMillis = normalizeComparable(previousUpdatedAt)
  if (typeof previousMillis !== "number" || now.toMillis() > previousMillis) {
    return now
  }
  return Timestamp.fromMillis(previousMillis + 1)
}

export const withServerManagedFields = (
  payload: Record<string, unknown>,
  targetSnap: DocumentSnapshot,
  path: string[],
  userId: string,
  stampedAt: Timestamp
): ServerManagedFieldsResult => {
  const shouldStampUpdatedAt =
    isUserRootPathForUser(path, userId) ||
    isUserPreferencesPathForUser(path, userId) ||
    isMembershipPreferencesPathForUser(path, userId) ||
    isSnapshotPath(path)

  if (!shouldStampUpdatedAt) {
    return { payload, updatedAtMillis: null }
  }

  const stamp = monotonicUpdatedAtStamp(
    stampedAt,
    targetSnap.exists ? targetSnap.get("updatedAt") : undefined
  )
  const nextPayload: Record<string, unknown> = {
    ...payload,
    updatedAt: stamp,
  }

  if (
    isUserRootPathForUser(path, userId) &&
    !targetSnap.exists &&
    !("createdAt" in nextPayload)
  ) {
    nextPayload.createdAt = stamp
    nextPayload.username = null
    nextPayload.isPublic = false
  }

  if (isSnapshotPath(path)) {
    nextPayload.updatedBy = userId
  }

  return { payload: nextPayload, updatedAtMillis: stamp.toMillis() }
}

/**
 * Apply the operation's write to the target document. Returns the epoch ms
 * of the `updatedAt` stamped onto the target (for the ack verdict), or null
 * when the settlement stamped none (deletes, non-managed paths).
 *
 * The stamp is a CONCRETE `Timestamp.now()` computed in the transaction, not
 * the `serverTimestamp()` sentinel: OCC (`validateBaseVersion`) compares
 * strict millis equality, so a concrete value is semantically identical —
 * and only a concrete value can ride the verdict back to the client.
 */
export const applyMutation = (
  transaction: Transaction,
  targetRef: FirebaseFirestore.DocumentReference,
  operation: SyncOperation,
  targetSnap: DocumentSnapshot,
  path: string[],
  userId: string
): number | null => {
  if (operation.type === "delete") {
    transaction.delete(targetRef)
    return null
  }

  if (operation.type === "update") {
    if (!targetSnap.exists) {
      reject("not-found", "Cannot update a document that does not exist")
    }
    if (Object.keys(operation.data ?? {}).length === 0) {
      reject("invalid-argument", "Update payload cannot be empty")
    }
  }

  const { payload, updatedAtMillis } = withServerManagedFields(
    operation.data ?? {},
    targetSnap,
    path,
    userId,
    Timestamp.now()
  )
  if (operation.type === "set") {
    transaction.set(targetRef, payload, { merge: operation.merge })
    return updatedAtMillis
  }

  transaction.update(targetRef, payload)
  return updatedAtMillis
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
 * Only `SyncRejectError` — the deliberate app-level rejection thrown by the
 * validators above — may settle as a durable reject verdict. Everything else
 * (numeric gRPC codes, string-coded transients, unknown errors) must stay
 * retryable: the client treats ANY reject as terminal and rolls back its
 * optimistic state, so settling a transient blip as a reject converts an
 * in-flight write a retry would have applied into a user-visible rollback.
 */
export const isTerminalSyncRejection = (
  error: unknown
): error is SyncRejectError => error instanceof SyncRejectError

// Retryable codes Firestore surfaces on infrastructure trouble. `GoogleError`
// carries these NUMERICALLY (DEADLINE_EXCEEDED=4, RESOURCE_EXHAUSTED=8,
// ABORTED=10, UNAVAILABLE=14); wrapped errors may already carry the canonical
// string form.
const TRANSIENT_ERROR_CODES = new Set<unknown>([
  4,
  8,
  10,
  14,
  "deadline-exceeded",
  "resource-exhausted",
  "aborted",
  "unavailable",
])

/**
 * Known-transient infrastructure failure. The callable surfaces these as
 * `"unavailable"` so the client's retry ladder re-invokes it.
 */
export const isTransientSyncError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  TRANSIENT_ERROR_CODES.has((error as { code?: unknown }).code)

/**
 * How long past the create event's timestamp the trigger keeps rethrowing
 * retryable settlement failures. Beyond this, `retry: true` would otherwise
 * redeliver a deterministically-failing op for Eventarc's full 7-day window.
 */
export const SYNC_TRIGGER_RETRY_GIVE_UP_MS = 10 * 60 * 1000

/**
 * Decide how the create trigger disposes of a settlement failure: the reject
 * details to settle durably, or `null` to rethrow so `retry: true` redelivers
 * the event. Terminal rejections settle immediately; retryable failures
 * rethrow until the event outlives the give-up horizon. A non-finite age
 * (an unparseable event timestamp) keeps retrying rather than converting
 * into a reject.
 *
 * KNOWN-TRANSIENT failures are exempt from the horizon: the client treats a
 * reject as terminal and rolls back optimistic state ("a transient must
 * never settle as one" — see `settleSyncOperation`), and `event.time` is
 * fixed at doc creation, so a sustained partial outage or a backlogged
 * Eventarc delivery would otherwise durably reject writes the next healthy
 * retry applies. Transients always rethrow — Eventarc's own retry window
 * bounds them — while the horizon keeps bounding the deterministic-bug
 * class (unclassified, non-transient) it exists for.
 */
export const triggerFailureRejectDetails = (
  error: unknown,
  eventAgeMs: number
): { code: string; message: string } | null => {
  if (isTerminalSyncRejection(error)) return toRejectDetails(error)
  if (isTransientSyncError(error)) return null
  if (eventAgeMs >= SYNC_TRIGGER_RETRY_GIVE_UP_MS) {
    const underlying = toRejectDetails(error)
    return {
      code: underlying.code,
      message: `Sync settlement retry horizon exhausted: ${underlying.message}`,
    }
  }
  return null
}

/**
 * Which entry point produced a settlement outcome, for the structured
 * outcome log: the Firestore create trigger, the callable settling an
 * existing op doc, or the callable's payload-carried create-and-settle.
 */
export type SettlementLogSource = "trigger" | "callable" | "callable-carried"

/**
 * Coarse target classification for the outcome log. Deliberately a KIND, not
 * the raw path: the log must stay free of user data beyond ids, and the
 * per-route buckets are what operators aggregate on anyway.
 */
export type SettlementRouteKind =
  | "user-profile"
  | "user-layout"
  | "user-settings"
  | "user-notifications"
  | "tabs-layout"
  | "membership-settings"
  | "snapshot"
  | "unknown"

/**
 * Classify a target path into its settlement route bucket. Mirrors the
 * routing in `routeSyncOperation` (same path shapes) but never throws — an
 * unroutable/absent path logs as `"unknown"` instead of failing the log line.
 */
export const settlementRouteKind = (
  targetPath: string | null | undefined
): SettlementRouteKind => {
  if (!targetPath) return "unknown"
  const path = splitPath(targetPath)

  if (path[0] === "users") {
    if (path.length === 2) return "user-profile"
    if (path.length === 4 && path[2] === "layout") return "user-layout"
    if (path.length === 4 && path[2] === "settings") return "user-settings"
    if (path.length === 4 && path[2] === "notifications") {
      return "user-notifications"
    }
    return "unknown"
  }

  if (path[0] === "snapshots" && path.length === 2) return "snapshot"

  if (path[0] === "teams" && path[2] === "memberships") {
    if (path.length === 8 && path[6] === "layout" && path[7] === "tabs") {
      return "tabs-layout"
    }
    if (
      path.length === 6 &&
      path[4] === "settings" &&
      path[5] === "preferences"
    ) {
      return "membership-settings"
    }
  }

  return "unknown"
}

/**
 * The ONE structured log line per settlement outcome (`sync.ts` emits it at
 * info for acks, warn for rejects). Ids and kinds only — never payloads or
 * raw paths. `occConflict` marks the OCC loss (`validateBaseVersion`'s
 * `failed-precondition` reject); `horizonExhausted` marks the trigger giving
 * up on a retryable failure past `SYNC_TRIGGER_RETRY_GIVE_UP_MS` and settling
 * it as a reject.
 */
export interface SettlementOutcomeLog {
  operationId: string
  routeKind: SettlementRouteKind
  source: SettlementLogSource
  verdict: "ack" | "reject"
  code: string | null
  occConflict: boolean
  horizonExhausted: boolean
  durationMs: number
}

export const buildSettlementOutcomeLog = (params: {
  operationId: string
  targetPath: string | null
  source: SettlementLogSource
  verdict: SyncSettlementVerdict
  horizonExhausted: boolean
  durationMs: number
}): SettlementOutcomeLog => ({
  operationId: params.operationId,
  routeKind: settlementRouteKind(params.targetPath),
  source: params.source,
  verdict: params.verdict.status,
  code: params.verdict.code,
  occConflict:
    params.verdict.status === "reject" &&
    params.verdict.code === "failed-precondition",
  horizonExhausted: params.horizonExhausted,
  durationMs: Math.max(0, params.durationMs),
})

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
    updatedAtMillis?: unknown
  } | null
  return {
    status,
    code: typeof ack?.code === "string" ? ack.code : null,
    message: typeof ack?.message === "string" ? ack.message : null,
    updatedAtMillis:
      typeof ack?.updatedAtMillis === "number" ? ack.updatedAtMillis : null,
  }
}

/**
 * Server retention for SETTLED operation documents: 2 hours — double the
 * client's 1-hour local outbox retention, so every verdict a live client
 * could still care about is retrievable (retries re-invoke the callable,
 * which returns the stored verdict for a settled doc). Enforced by the
 * native Firestore TTL policy on `syncOperations.expireAt` (stamped by
 * `buildSettlementVerdictFields` below), NOT by the scheduled sweep — the
 * settled sweep is retired; `cleanupSyncOperations` keeps only the 7-day
 * orphaned-pending sweep.
 */
export const SYNC_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

/**
 * The ONE field set every settlement writer puts on the operation document —
 * `settleSyncOperation`'s transactional write and the standalone
 * `settleRejectVerdict` both build from here so the settled-doc shape cannot
 * drift between paths.
 *
 * Settled docs keep only what the client's `applyRemoteSettlement` actually
 * reads — `status` + `ack` (and the identity fields already on the doc:
 * `userId`/`targetPath`/`source` fallbacks, `clientId` for the ack-listener
 * scope). The mutation payload (`data`, up to ~1MB of snapshot base64) and
 * `baseVersion` are dead weight once a verdict exists, yet they would stream
 * back through the ack listener on every settlement AND on every
 * stale-resume-token re-attach for the whole retention window — so the
 * settlement STRIPS them:
 *
 *  - `"merge"` (existing doc): expressed as `FieldValue.delete()` sentinels
 *    merged over the doc. Rules only constrain CLIENT writes, so the
 *    server-side delete is always permitted; deleting an absent field is a
 *    no-op, so old op docs settle identically.
 *  - `"create"` (born-settled carry): the sentinels are INVALID inside
 *    `create()`, so the fields are omitted here and the carried payload is
 *    pre-stripped via `stripSettledPayloadFields` instead.
 *
 * `expireAt` (the settlement instant + `SYNC_TTL_MS`) is the native-TTL
 * anchor; a concrete `Timestamp` like `ack.atMs`, not the server sentinel,
 * so the verdict can compute it without a post-commit read.
 */
export const buildSettlementVerdictFields = (
  verdict: SyncSettlementVerdict,
  atMs: number,
  mode: "merge" | "create"
): Record<string, unknown> => {
  const fields: Record<string, unknown> = {
    status: verdict.status,
    ack: {
      code: verdict.code,
      message: verdict.message,
      atMs,
      updatedAtMillis: verdict.updatedAtMillis,
    },
    processedAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(atMs + SYNC_TTL_MS),
  }
  if (mode === "merge") {
    fields.data = FieldValue.delete()
    fields.baseVersion = FieldValue.delete()
  }
  return fields
}

/**
 * Drop the mutation payload from a carried op payload before the
 * create-from-carried settlement writes it: the doc is born settled, and
 * nothing ever reads a settled operation's `data`/`baseVersion` again (see
 * `buildSettlementVerdictFields`). Non-mutating — the caller may still hold
 * the payload for the verdict path.
 */
export const stripSettledPayloadFields = (
  operation: FirebaseFirestore.DocumentData
): FirebaseFirestore.DocumentData => {
  const stripped = { ...operation }
  delete stripped.data
  delete stripped.baseVersion
  return stripped
}

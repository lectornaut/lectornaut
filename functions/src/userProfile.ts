import * as logger from "firebase-functions/logger"
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore"
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https"
import { COST_BUDGET } from "./costBudget.js"
import { admin, auth, db } from "./firebase.js"
import { CALLABLE_OPTS, TRIGGER_OPTS } from "./runtimeConfig.js"

const USERNAME_MIN_LENGTH = 3
const USERNAME_MAX_LENGTH = 30
const USERNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const MEMBERSHIP_SYNC_FIELDS = [
  "uid",
  "email",
  "displayName",
  "photoURL",
  "username",
  "isPublic",
  "createdAt",
  "updatedAt",
] as const

const RESERVED_USERNAMES = new Set([
  "home",
  "login",
  "logout",
  "signin",
  "signout",
  "signup",
  "register",
  "enter",
  "exit",
  "profile",
  "settings",
  "account",
  "dashboard",
  "admin",
  "administrator",
  "editor",
  "api",
  "app",
  "about",
  "help",
  "support",
  "contact",
  "pricing",
  "billing",
  "subscription",
  "subscriptions",
  "explore",
  "search",
  "discover",
  "browse",
  "feed",
  "notifications",
  "messages",
  "inbox",
  "chat",
  "teams",
  "team",
  "org",
  "organization",
  "organizations",
  "create",
  "new",
  "edit",
  "delete",
  "remove",
  "update",
  "manage",
  "agents",
  "agent",
  "runs",
  "run",
  "tasks",
  "task",
  "flows",
  "flow",
  "changelog",
  "blog",
  "docs",
  "documentation",
  "legal",
  "terms",
  "privacy",
  "security",
  "cookies",
  "welcome",
  "start",
  "write",
  "test",
  "system",
  "root",
  "null",
  "undefined",
  "anonymous",
  "guest",
  "user",
  "users",
  "member",
  "members",
  "viewer",
  "moderator",
  "mod",
  "staff",
  "owner",
  "bot",
  "bots",
  "official",
  "verified",
  "lectornaut",
  "lector",
  "naut",
  "www",
  "mail",
  "email",
  "ftp",
  "ssl",
  "ssh",
  "cdn",
  "assets",
  "static",
  "public",
  "private",
  "internal",
  "external",
])

type UsernameClaimEntityType = "user" | "team"

type UsernameClaimData = {
  entityType?: UsernameClaimEntityType
  type?: UsernameClaimEntityType
  entityId?: string
  uid?: string
  userId?: string
  teamId?: string
}

function assertAuthenticated(
  request: CallableRequest
): asserts request is CallableRequest & {
  auth: NonNullable<CallableRequest["auth"]>
} {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    )
  }
}

function normalizeUsername(username: string): string {
  let normalized = username.trim().toLowerCase()
  if (normalized.startsWith("@")) {
    normalized = normalized.slice(1)
  }
  return normalized
}

function validateUsername(username: unknown): string {
  if (typeof username !== "string") {
    throw new HttpsError("invalid-argument", "Username must be a string.")
  }

  const trimmed = username.trim()
  if (!trimmed) {
    throw new HttpsError("invalid-argument", "Username is required.")
  }
  if (trimmed !== username) {
    throw new HttpsError(
      "invalid-argument",
      "Username cannot have leading or trailing spaces."
    )
  }
  if (trimmed.includes(" ")) {
    throw new HttpsError("invalid-argument", "Username cannot contain spaces.")
  }

  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed
  if (withoutAt.length < USERNAME_MIN_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `Username must be at least ${USERNAME_MIN_LENGTH} characters.`
    )
  }
  if (withoutAt.length > USERNAME_MAX_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `Username must be at most ${USERNAME_MAX_LENGTH} characters.`
    )
  }
  if (!USERNAME_REGEX.test(withoutAt)) {
    if (/^[-_]/.test(withoutAt)) {
      throw new HttpsError(
        "invalid-argument",
        "Username must start with a letter or number."
      )
    }
    throw new HttpsError(
      "invalid-argument",
      "Username can only contain letters, numbers, underscores, and hyphens."
    )
  }
  if (/[-_]{2,}/.test(withoutAt)) {
    throw new HttpsError(
      "invalid-argument",
      "Username cannot have consecutive underscores or hyphens."
    )
  }
  if (/[-_]$/.test(withoutAt)) {
    throw new HttpsError(
      "invalid-argument",
      "Username cannot end with an underscore or hyphen."
    )
  }
  if (!/^[\x20-\x7E]*$/.test(withoutAt)) {
    throw new HttpsError(
      "invalid-argument",
      "Username can only contain standard ASCII characters."
    )
  }

  const normalized = normalizeUsername(withoutAt)
  if (RESERVED_USERNAMES.has(normalized)) {
    throw new HttpsError("invalid-argument", "This username is reserved.")
  }

  return normalized
}

function readClaimEntityType(
  data: UsernameClaimData | null | undefined
): UsernameClaimEntityType | null {
  if (!data) return null
  if (data.entityType === "user" || data.entityType === "team") {
    return data.entityType
  }
  if (data.type === "user" || data.type === "team") {
    return data.type
  }
  return null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function resolveUserClaimId(
  data: UsernameClaimData | null | undefined
): string | null {
  const entityType = readClaimEntityType(data)
  if (entityType === "user") {
    return readString(data?.entityId)
  }
  if (entityType === null) {
    return readString(data?.uid) ?? readString(data?.userId)
  }
  return null
}

function nullableString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

async function getAuthProfile(uid: string) {
  const userRecord = await auth.getUser(uid)
  return {
    email: nullableString(userRecord.email),
    displayName: nullableString(userRecord.displayName),
    photoURL: nullableString(userRecord.photoURL),
  }
}

function buildUserBaseFields(
  uid: string,
  userSnap: FirebaseFirestore.DocumentSnapshot
): Record<string, unknown> {
  const fields: Record<string, unknown> = { uid }

  if (!userSnap.exists) {
    fields.username = null
    fields.isPublic = false
    fields.createdAt = admin.firestore.FieldValue.serverTimestamp()
    return fields
  }

  const data = userSnap.data() ?? {}
  if (data.username === undefined) {
    fields.username = null
  }
  if (data.isPublic === undefined) {
    fields.isPublic = false
  }

  return fields
}

function buildMembershipUserPatch(
  userId: string,
  userData: FirebaseFirestore.DocumentData
) {
  const patch: Record<string, unknown> = {
    "user.uid": readString(userData.uid) ?? userId,
    "user.email": nullableString(userData.email),
    "user.displayName": nullableString(userData.displayName),
    "user.photoURL": nullableString(userData.photoURL),
    "user.username": nullableString(userData.username),
    "user.isPublic": userData.isPublic === true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  if (userData.createdAt !== undefined) {
    patch["user.createdAt"] = userData.createdAt
  }
  if (userData.updatedAt !== undefined) {
    patch["user.updatedAt"] = userData.updatedAt
  }

  return patch
}

function relevantMembershipFieldsChanged(
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): boolean {
  return MEMBERSHIP_SYNC_FIELDS.some((field) => before[field] !== after[field])
}

async function syncUserSnapshotToMemberships(
  userId: string,
  userData: FirebaseFirestore.DocumentData
) {
  const snapshot = await db
    .collectionGroup("memberships")
    .where("userId", "==", userId)
    .get()

  if (snapshot.empty) return 0

  const patch = buildMembershipUserPatch(userId, userData)
  let synced = 0

  for (let i = 0; i < snapshot.docs.length; i += COST_BUDGET.MAX_BATCH_SIZE) {
    const batch = db.batch()
    const chunk = snapshot.docs.slice(i, i + COST_BUDGET.MAX_BATCH_SIZE)

    chunk.forEach((docSnap) => {
      batch.update(docSnap.ref, patch)
    })

    await batch.commit()
    synced += chunk.length
  }

  return synced
}

export const syncCurrentUserAccountProfile = onCall(
  { ...CALLABLE_OPTS },
  async (request) => {
    assertAuthenticated(request)

    const uid = request.auth.uid
    const authProfile = await getAuthProfile(uid)
    const userRef = db.doc(`users/${uid}`)

    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef)
      transaction.set(
        userRef,
        {
          ...buildUserBaseFields(uid, userSnap),
          ...authProfile,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    })

    return { synced: true }
  }
)

// ============================================================================
// Self-edit of user profile (displayName + photoURL)
// ----------------------------------------------------------------------------
// Sibling of `claimUsername` / `updateUserProfileVisibility` — those callables
// own `username` and `isPublic` respectively; this one owns `displayName` and
// `photoURL`. Before this existed the client wrote both fields directly to
// `users/{uid}` via the sync engine and called Firebase Auth's
// `updateProfile()` in parallel, which (a) bypassed the audit trail every
// other mutation goes through, and (b) opened a window for the two systems
// to diverge if one half failed.
//
// The audit log table is team-scoped (`logs` collection with `teamId` field),
// so user-global self-edits don't fit there. We log to Cloud Logging instead
// — same observability, no schema change. Cloud Logging entries are
// queryable by `userProfile.update.self` action plus the structured `uid`
// field below.
// ============================================================================

const DISPLAY_NAME_MAX_LENGTH = 100
const PHOTO_URL_MAX_LENGTH = 2048

interface UpdateOwnUserProfilePayload {
  // displayName is non-null when present — the validator rejects
  // null explicitly. photoURL allows null (it's the "clear" signal).
  displayName?: string
  photoURL?: string | null
}

function readOptionalStringOrNull(
  data: Record<string, unknown>,
  field: keyof UpdateOwnUserProfilePayload
): string | null | undefined {
  // Distinguish: missing key → undefined (skip field), explicit null →
  // null (clear field), string → set field. Anything else rejects.
  if (!(field in data)) return undefined
  const value = data[field]
  if (value === null) return null
  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a string or null.`
    )
  }
  return value
}

function normalizeDisplayName(value: string): string {
  // Trim whitespace and collapse internal whitespace runs. Matches the
  // client's expectation that "John   Doe" round-trips to "John Doe".
  return value.trim().replace(/\s+/g, " ")
}

function validateUpdateOwnUserProfilePayload(
  data: unknown
): UpdateOwnUserProfilePayload {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Payload must be an object.")
  }
  const obj = data as Record<string, unknown>
  const payload: UpdateOwnUserProfilePayload = {}

  const rawDisplayName = readOptionalStringOrNull(obj, "displayName")
  if (rawDisplayName !== undefined) {
    if (rawDisplayName === null) {
      // The Firebase Auth profile API treats `null` as "clear", but the
      // user-facing settings screen always provides a name. Reject null
      // here so a UI bug can't accidentally wipe the field.
      throw new HttpsError(
        "invalid-argument",
        "displayName cannot be null. Pass a non-empty string to update it."
      )
    }
    const normalized = normalizeDisplayName(rawDisplayName)
    if (!normalized) {
      throw new HttpsError("invalid-argument", "displayName must not be blank.")
    }
    if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new HttpsError(
        "invalid-argument",
        `displayName must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`
      )
    }
    payload.displayName = normalized
  }

  const rawPhotoURL = readOptionalStringOrNull(obj, "photoURL")
  if (rawPhotoURL !== undefined) {
    if (rawPhotoURL === null) {
      payload.photoURL = null
    } else {
      const trimmed = rawPhotoURL.trim()
      if (!trimmed) {
        // Empty string = clear. Mirrors the client's earlier normalization
        // (`photoURL === ""` → null) so old callers keep working.
        payload.photoURL = null
      } else {
        if (trimmed.length > PHOTO_URL_MAX_LENGTH) {
          throw new HttpsError(
            "invalid-argument",
            `photoURL must be at most ${PHOTO_URL_MAX_LENGTH} characters.`
          )
        }
        payload.photoURL = trimmed
      }
    }
  }

  if (payload.displayName === undefined && payload.photoURL === undefined) {
    throw new HttpsError(
      "invalid-argument",
      "Provide at least one of: displayName, photoURL."
    )
  }

  return payload
}

export const updateOwnUserProfile = onCall(
  { ...CALLABLE_OPTS },
  async (request) => {
    assertAuthenticated(request)
    const uid = request.auth.uid
    const payload = validateUpdateOwnUserProfilePayload(request.data)

    const userRef = db.doc(`users/${uid}`)
    const authProfile = await getAuthProfile(uid)

    // Run the Firestore merge inside a transaction so we can compute a
    // sharp before/after diff for the audit log (and so the structured
    // fields list in the response reflects what actually changed, not
    // what the client asked to change).
    const result = await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef)
      const beforeData = userSnap.exists ? (userSnap.data() ?? {}) : {}

      // Build the merge object. Only include keys that came in the
      // payload — `merge: true` preserves untouched fields, and
      // omitting unmodified keys keeps the diff tight.
      const merge: Record<string, unknown> = {
        ...buildUserBaseFields(uid, userSnap),
        ...authProfile,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      if (payload.displayName !== undefined) {
        merge.displayName = payload.displayName
      }
      if (payload.photoURL !== undefined) {
        merge.photoURL = payload.photoURL
      }

      transaction.set(userRef, merge, { merge: true })

      // Audit diff: only fields whose value actually changes count as
      // updated. A no-op call still succeeds but reports `updated:
      // false` and an empty `fields` list so the client can skip
      // optimistic-update toasts in that case.
      const changedFields: string[] = []
      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      if (
        payload.displayName !== undefined &&
        beforeData.displayName !== payload.displayName
      ) {
        changedFields.push("displayName")
        before.displayName = beforeData.displayName ?? null
        after.displayName = payload.displayName
      }
      if (
        payload.photoURL !== undefined &&
        (beforeData.photoURL ?? null) !== payload.photoURL
      ) {
        changedFields.push("photoURL")
        before.photoURL = beforeData.photoURL ?? null
        after.photoURL = payload.photoURL
      }

      return { changedFields, before, after }
    })

    // Mirror to Firebase Auth so the JWT's `name` / `picture` claims
    // re-sync next refresh. The Firestore doc is the source of truth
    // for the app, but the Auth profile drives external integrations
    // (Google sign-in cards, etc.). Best-effort: we don't fail the
    // RPC if this side fails — the audit log will record the
    // attempt and a follow-up `syncCurrentUserAccountProfile` call
    // will reconcile.
    if (result.changedFields.length > 0) {
      const authUpdates: { displayName?: string; photoURL?: string } = {}
      if (payload.displayName !== undefined) {
        authUpdates.displayName = payload.displayName
      }
      if (payload.photoURL !== undefined) {
        // Firebase Auth uses empty string (not null) to clear photoURL.
        authUpdates.photoURL = payload.photoURL ?? ""
      }
      try {
        await auth.updateUser(uid, authUpdates)
      } catch (err) {
        logger.warn("[updateOwnUserProfile] auth sync failed", {
          uid,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Cloud Logging audit entry — the user-global equivalent of the
    // team-scoped `logEvent` writes. Structured fields make it
    // queryable from the Logs Explorer; the `action` tag matches the
    // naming used by team audit entries so dashboards filtering by
    // `action: "userProfile.update.self"` work uniformly.
    if (result.changedFields.length > 0) {
      logger.info("[updateOwnUserProfile] profile updated", {
        action: "userProfile.update.self",
        uid,
        fields: result.changedFields,
        before: result.before,
        after: result.after,
      })
    }

    return {
      updated: result.changedFields.length > 0,
      fields: result.changedFields,
    }
  }
)

export const claimUsername = onCall({ ...CALLABLE_OPTS }, async (request) => {
  assertAuthenticated(request)

  const uid = request.auth.uid
  const normalized = validateUsername(request.data?.username)
  const userRef = db.doc(`users/${uid}`)
  const usernameRef = db.doc(`usernames/${normalized}`)
  const authProfile = await getAuthProfile(uid)

  await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef)
    const usernameSnap = await transaction.get(usernameRef)
    const usernameData = usernameSnap.exists
      ? (usernameSnap.data() as UsernameClaimData)
      : null

    if (usernameSnap.exists && resolveUserClaimId(usernameData) !== uid) {
      throw new HttpsError("already-exists", "Username already taken.")
    }

    const oldUsername = userSnap.exists ? userSnap.data()?.username : null
    const oldNormalized =
      typeof oldUsername === "string" ? normalizeUsername(oldUsername) : null
    const oldUsernameRef =
      oldNormalized && oldNormalized !== normalized
        ? db.doc(`usernames/${oldNormalized}`)
        : null
    const oldUsernameSnap = oldUsernameRef
      ? await transaction.get(oldUsernameRef)
      : null

    transaction.set(
      usernameRef,
      {
        entityType: "user",
        entityId: uid,
        createdAt: usernameSnap.exists
          ? (usernameSnap.data()?.createdAt ??
            admin.firestore.FieldValue.serverTimestamp())
          : admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    transaction.set(
      userRef,
      {
        ...buildUserBaseFields(uid, userSnap),
        ...authProfile,
        username: normalized,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    if (
      oldUsernameRef &&
      oldUsernameSnap?.exists &&
      resolveUserClaimId(oldUsernameSnap.data() as UsernameClaimData) === uid
    ) {
      transaction.delete(oldUsernameRef)
    }
  })

  return { username: normalized }
})

export const releaseUsername = onCall({ ...CALLABLE_OPTS }, async (request) => {
  assertAuthenticated(request)

  const uid = request.auth.uid
  const rawUsername = request.data?.username
  if (typeof rawUsername !== "string") {
    throw new HttpsError("invalid-argument", "Username must be a string.")
  }

  const normalized = normalizeUsername(rawUsername)
  if (!normalized) return { released: false }

  const userRef = db.doc(`users/${uid}`)
  const usernameRef = db.doc(`usernames/${normalized}`)

  const released = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef)
    const usernameSnap = await transaction.get(usernameRef)
    const usernameData = usernameSnap.exists
      ? (usernameSnap.data() as UsernameClaimData)
      : null
    const usernameOwnedByUser = resolveUserClaimId(usernameData) === uid
    const userCurrentUsername = userSnap.exists
      ? normalizeUsername(String(userSnap.data()?.username ?? ""))
      : null

    if (usernameSnap.exists && usernameOwnedByUser) {
      transaction.delete(usernameRef)
    }

    if (userSnap.exists && userCurrentUsername === normalized) {
      transaction.set(
        userRef,
        {
          username: null,
          isPublic: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }

    return usernameOwnedByUser || userCurrentUsername === normalized
  })

  return { released }
})

export const updateUserProfileVisibility = onCall(
  { ...CALLABLE_OPTS },
  async (request) => {
    assertAuthenticated(request)

    if (typeof request.data?.isPublic !== "boolean") {
      throw new HttpsError("invalid-argument", "isPublic must be a boolean.")
    }

    const uid = request.auth.uid
    const isPublic = request.data.isPublic
    const userRef = db.doc(`users/${uid}`)
    const authProfile = await getAuthProfile(uid)

    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef)
      const username = userSnap.exists
        ? nullableString(userSnap.data()?.username)
        : null

      if (isPublic && !username) {
        throw new HttpsError(
          "failed-precondition",
          "Claim a username before making your profile public."
        )
      }

      transaction.set(
        userRef,
        {
          ...buildUserBaseFields(uid, userSnap),
          ...authProfile,
          isPublic,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    })

    return { isPublic }
  }
)

export const deleteCurrentUserAccountData = onCall(
  { ...CALLABLE_OPTS },
  async (request) => {
    assertAuthenticated(request)

    const uid = request.auth.uid
    const userRef = db.doc(`users/${uid}`)

    const deleted = await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef)
      const username = userSnap.exists
        ? nullableString(userSnap.data()?.username)
        : null
      const normalized = username ? normalizeUsername(username) : null
      const usernameRef = normalized ? db.doc(`usernames/${normalized}`) : null
      const usernameSnap = usernameRef
        ? await transaction.get(usernameRef)
        : null

      if (
        usernameRef &&
        usernameSnap?.exists &&
        resolveUserClaimId(usernameSnap.data() as UsernameClaimData) === uid
      ) {
        transaction.delete(usernameRef)
      }

      if (userSnap.exists) {
        transaction.delete(userRef)
      }

      return userSnap.exists
    })

    return { deleted }
  }
)

export const onUserProfileCreated = onDocumentCreated(
  {
    document: "users/{userId}",
    retry: true,
    ...TRIGGER_OPTS,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const synced = await syncUserSnapshotToMemberships(
      event.params.userId,
      snapshot.data() ?? {}
    )

    if (synced > 0) {
      logger.info("[userProfile] Synced new user snapshot to memberships", {
        userId: event.params.userId,
        synced,
      })
    }
  }
)

export const onUserProfileUpdated = onDocumentUpdated(
  {
    document: "users/{userId}",
    retry: true,
    ...TRIGGER_OPTS,
  },
  async (event) => {
    const before = event.data?.before.data() ?? {}
    const after = event.data?.after.data() ?? {}

    if (!relevantMembershipFieldsChanged(before, after)) {
      return
    }

    const synced = await syncUserSnapshotToMemberships(
      event.params.userId,
      after
    )

    if (synced > 0) {
      logger.info("[userProfile] Synced user snapshot update to memberships", {
        userId: event.params.userId,
        synced,
      })
    }
  }
)

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

/**
 * Shared Firestore Helpers
 *
 * Centralized utilities for Firestore operations used across all stores.
 * Provides consistent patterns for refs, batch processing, and common operations.
 *
 * As of PR 4, all single-doc ref getters and their corresponding collection
 * getters are wired through Zod converters. Every snapshot read via the
 * TanStack read composables (`useDocumentQuery` / `useCollectionQuery`) is
 * validated against its schema automatically (in dev and prod alike) — store
 * and composable code needs no changes because the returned
 * `DocumentReference<T>` generic is identical to the previous hand-cast version.
 */

import { firestore, storage } from "@/modules/firebase"
import { zodConverter } from "@/schemas/_utils"
import {
  botSessionSchema,
  groupSchema,
  membershipPreferencesSchema,
  teamSchema,
  userPreferencesSchema,
  userSchema,
  workspaceSchema,
} from "@/schemas/domain"
import {
  membershipDocDataSchema,
  membershipWorkspaceRecordSchema,
} from "@/schemas/membership"
import type {
  IBotSession,
  IGroup,
  IMembershipPreferences,
  ITeam,
  IUser,
  IUserPreferences,
  IWorkspace,
} from "@/types/domain"
import type {
  IMembershipDocData,
  IMembershipWorkspaceRecord,
} from "@/types/membership"
import {
  collection,
  collectionGroup,
  doc,
  orderBy,
  query,
  where,
} from "firebase/firestore"
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
  type StorageReference,
} from "firebase/storage"

// ============================================================================
// Zod Converters
//
// Each converter is created once at module load and reused by every ref
// getter and collection getter for its entity. Reads are validated against
// the schema inside the converter's `fromFirestore` (dev and prod alike);
// writes are a pass-through because the sync engine validates via its path
// registry.
// ============================================================================

const userConverter = zodConverter<IUser>(userSchema, "user")
const userPreferencesConverter = zodConverter<IUserPreferences>(
  userPreferencesSchema,
  "userPreferences"
)
const teamConverter = zodConverter<ITeam>(teamSchema, "team")
const workspaceConverter = zodConverter<IWorkspace>(
  workspaceSchema,
  "workspace"
)
const membershipConverter = zodConverter<IMembershipDocData>(
  membershipDocDataSchema,
  "membership"
)
const groupConverter = zodConverter<IGroup>(
  groupSchema,
  "group",
  // `teams/{teamId}/groups/{groupId}` — inject teamId (index 1) from the path so
  // a doc that never denormalized it into the body still satisfies the schema.
  { teamId: 1 }
)
const membershipPreferencesConverter = zodConverter<IMembershipPreferences>(
  membershipPreferencesSchema,
  "membershipPreferences"
)
const membershipWorkspaceConverter = zodConverter<IMembershipWorkspaceRecord>(
  membershipWorkspaceRecordSchema,
  "membershipWorkspace"
)
const botSessionConverter = zodConverter<IBotSession>(
  botSessionSchema,
  "botSession",
  // `teams/{teamId}/workspaces/{workspaceId}/botSessions/{id}` — teamId and
  // workspaceId are canonically defined by the doc's location. Inject them
  // from the path so legacy/partial docs that never denormalized them into
  // the body still satisfy the schema (the unfiltered admin Sessions query
  // is the only surface that reads such docs).
  { teamId: 1, workspaceId: 3 }
)

// ============================================================================
// Document References - Converter-wired getters for common collections
// ============================================================================

/** Get a reference to a user document (validated on read). */
export const getUserRef = (userId: string) =>
  doc(firestore, "users", userId).withConverter(userConverter)

/** Get a reference to a user's preferences document. */
export const getUserPreferencesRef = (userId: string) =>
  doc(firestore, "users", userId, "settings", "preferences").withConverter(
    userPreferencesConverter
  )

/** Get a reference to a team document. */
export const getTeamRef = (teamId: string) =>
  doc(firestore, "teams", teamId).withConverter(teamConverter)

/** Get a reference to a membership document. */
export const getMembershipRef = (teamId: string, userId: string) =>
  doc(firestore, "teams", teamId, "memberships", userId).withConverter(
    membershipConverter
  )

/**
 * Get the signed-in user's per-workspace override subcollection
 * (`teams/{teamId}/memberships/{userId}/workspaces`), validated on read. Each
 * doc id is a workspace id; the body carries the elevate-only `role` override
 * and denormalized group-derived `groupRole`. Readable only for one's own
 * membership (functions-only write) — see `firestore.rules`.
 */
export const getMembershipWorkspacesCollection = (
  teamId: string,
  userId: string
) =>
  collection(
    firestore,
    "teams",
    teamId,
    "memberships",
    userId,
    "workspaces"
  ).withConverter(membershipWorkspaceConverter)

/** Get a reference to the membership-scoped preferences document. */
export const getMembershipPreferencesRef = (teamId: string, userId: string) =>
  doc(
    firestore,
    "teams",
    teamId,
    "memberships",
    userId,
    "settings",
    "preferences"
  ).withConverter(membershipPreferencesConverter)

/** Get a reference to a workspace document. */
export const getWorkspaceRef = (teamId: string, workspaceId: string) =>
  doc(firestore, "teams", teamId, "workspaces", workspaceId).withConverter(
    workspaceConverter
  )

// ============================================================================
// Collection References
// ============================================================================

/** Get the users collection reference (validated on read). */
export const getUsersCollection = () =>
  collection(firestore, "users").withConverter(userConverter)

/** Get the teams collection reference (validated on read). */
export const getTeamsCollection = () =>
  collection(firestore, "teams").withConverter(teamConverter)

/**
 * Get the todos collection reference.
 *
 * Unconverted: no domain schema exists for todos (the demo `taskSchema` in
 * `src/data/schema.ts` is unrelated UI fixture data). This export has no
 * call sites and is a candidate for removal in a later cleanup.
 */
export const getTodosCollection = () => collection(firestore, "todos")

/** Get memberships subcollection for a team (validated on read). */
export const getTeamMembershipsCollection = (teamId: string) =>
  collection(firestore, "teams", teamId, "memberships").withConverter(
    membershipConverter
  )

/**
 * Get all memberships across all teams as a collection group
 * (validated on read). Used for cross-team queries like "all memberships
 * for this user".
 */
export const getAllMembershipsGroup = () =>
  collectionGroup(firestore, "memberships").withConverter(membershipConverter)

/** Get workspaces subcollection for a team (validated on read). */
export const getTeamWorkspacesCollection = (teamId: string) =>
  collection(firestore, "teams", teamId, "workspaces").withConverter(
    workspaceConverter
  )

/** Get the groups subcollection for a team (validated on read). */
export const getTeamGroupsCollection = (teamId: string) =>
  collection(firestore, "teams", teamId, "groups").withConverter(groupConverter)

/** Get a reference to a single group document (validated on read). */
export const getGroupRef = (teamId: string, groupId: string) =>
  doc(firestore, "teams", teamId, "groups", groupId).withConverter(
    groupConverter
  )

// ============================================================================
// Storage Helpers
// ============================================================================

/**
 * Prefix a storage path under the shared profile images root.
 */
const withImagesRoot = (path: string) => `images/${path.replace(/^\/+/, "")}`

/**
 * Canonical storage path for user profile photos.
 * Stored under /images/<current-path>.
 */
export const getUserPhotoPath = (userId: string) =>
  withImagesRoot(`users/${userId}/profilePhoto`)

/** Canonical storage path for team profile photos. */
export const getTeamPhotoPath = (teamId: string) =>
  withImagesRoot(`teams/${teamId}/profilePhoto`)

/** Canonical storage path for workspace profile photos. */
export const getWorkspacePhotoPath = (teamId: string, workspaceId: string) =>
  withImagesRoot(`teams/${teamId}/workspaces/${workspaceId}/profilePhoto`)

/** Canonical storage path for group profile photos. */
export const getGroupPhotoPath = (teamId: string, groupId: string) =>
  withImagesRoot(`teams/${teamId}/groups/${groupId}/profilePhoto`)

/** Create a typed storage reference for any storage path. */
export const getStorageFileRef = (path: string): StorageReference =>
  storageRef(storage, path)

/** Create a storage reference for a user profile photo. */
export const getUserPhotoStorageRef = (userId: string): StorageReference =>
  getStorageFileRef(getUserPhotoPath(userId))

/**
 * Upload a file and get its download URL
 * @returns Download URL of the uploaded file
 */
export async function uploadFile(path: string, file: File): Promise<string> {
  const fileRef = getStorageFileRef(path)
  await uploadBytes(fileRef, file)
  return getDownloadURL(fileRef)
}

/**
 * Upload user profile photo
 */
export async function uploadUserPhoto(
  userId: string,
  file: File
): Promise<string> {
  return uploadFile(getUserPhotoPath(userId), file)
}

/**
 * Upload team profile photo
 */
export async function uploadTeamPhoto(
  teamId: string,
  file: File
): Promise<string> {
  return uploadFile(getTeamPhotoPath(teamId), file)
}

/**
 * Upload workspace profile photo
 */
export async function uploadWorkspacePhoto(
  teamId: string,
  workspaceId: string,
  file: File
): Promise<string> {
  return uploadFile(getWorkspacePhotoPath(teamId, workspaceId), file)
}

/**
 * Upload group profile photo
 */
export async function uploadGroupPhoto(
  teamId: string,
  groupId: string,
  file: File
): Promise<string> {
  return uploadFile(getGroupPhotoPath(teamId, groupId), file)
}

/**
 * Best-effort storage delete helper.
 * No-op if the object is missing or cannot be deleted.
 */
export async function deleteStorageFile(path: string): Promise<void> {
  try {
    await deleteObject(getStorageFileRef(path))
  } catch {
    // Intentionally ignore cleanup failures.
  }
}

export const deleteUserPhotoFile = (userId: string) =>
  deleteStorageFile(getUserPhotoPath(userId))

export const deleteTeamPhotoFile = (teamId: string) =>
  deleteStorageFile(getTeamPhotoPath(teamId))

export const deleteWorkspacePhotoFile = (teamId: string, workspaceId: string) =>
  deleteStorageFile(getWorkspacePhotoPath(teamId, workspaceId))

export const deleteGroupPhotoFile = (teamId: string, groupId: string) =>
  deleteStorageFile(getGroupPhotoPath(teamId, groupId))

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Create a query for user's memberships
 */
export function createUserMembershipsQuery(userId: string) {
  return query(getAllMembershipsGroup(), where("userId", "==", userId))
}

/**
 * Create a query for team's memberships
 */
export function createTeamMembershipsQuery(teamId: string) {
  return query(getAllMembershipsGroup(), where("teamId", "==", teamId))
}

/**
 * Create a query for team's workspaces
 */
export function createTeamWorkspacesQuery(teamId: string) {
  return getTeamWorkspacesCollection(teamId)
}

/** Get bot sessions subcollection for a workspace (validated on read). */
export const getBotSessionsCollection = (teamId: string, workspaceId: string) =>
  collection(
    firestore,
    "teams",
    teamId,
    "workspaces",
    workspaceId,
    "botSessions"
  ).withConverter(botSessionConverter)

/** Get a single bot session document reference (validated on read). */
export const getBotSessionRef = (
  teamId: string,
  workspaceId: string,
  sessionId: string
) =>
  doc(
    firestore,
    "teams",
    teamId,
    "workspaces",
    workspaceId,
    "botSessions",
    sessionId
  ).withConverter(botSessionConverter)

/**
 * Create a query for the signed-in user's bot sessions in a workspace,
 * sorted by most-recently updated. Returns the user's own sessions
 * regardless of visibility (private + shared + public).
 */
export function createBotSessionsQuery(
  teamId: string,
  workspaceId: string,
  ownerUid: string
) {
  return query(
    getBotSessionsCollection(teamId, workspaceId),
    where("ownerUid", "==", ownerUid),
    orderBy("updatedAt", "desc")
  )
}

/**
 * Create a query for bot sessions in a workspace that have been shared
 * by other team members. The caller filters out their own sessions
 * client-side because Firestore can't OR across `ownerUid != x` and
 * `visibility == 'shared'` in the same query — the visibility filter is
 * the rule-friendly part, ownership is intersected in the consumer.
 */
export function createSharedBotSessionsQuery(
  teamId: string,
  workspaceId: string
) {
  return query(
    getBotSessionsCollection(teamId, workspaceId),
    where("visibility", "==", "shared"),
    orderBy("updatedAt", "desc")
  )
}

/**
 * Create a query for every bot session in a workspace, regardless of
 * owner or visibility. Backs the admin-only Sessions tab in Settings —
 * Firestore rules only return rows for team owners/admins, so a member
 * subscribing to this query receives an empty snapshot. Keep ordering
 * aligned with the other two queries (most-recently updated first) so
 * UI sort defaults are consistent.
 */
export function createWorkspaceBotSessionsQuery(
  teamId: string,
  workspaceId: string
) {
  return query(
    getBotSessionsCollection(teamId, workspaceId),
    orderBy("updatedAt", "desc")
  )
}

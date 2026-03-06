import { auth, firestore } from "@/modules/firebase"
import type { IUsernameClaim } from "@/types/domain"
import {
  normalizeUsername,
  RESERVED_USERNAMES,
  validateUsername,
} from "@/utils/firebase/firebase-username"
import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore"

type UsernameDocData = Partial<IUsernameClaim>

const resolveUserClaimId = (data: UsernameDocData): string | null => {
  return data.entityType === "user" && typeof data.entityId === "string"
    ? data.entityId
    : null
}

const resolveTeamClaimId = (data: UsernameDocData): string | null => {
  return data.entityType === "team" && typeof data.entityId === "string"
    ? data.entityId
    : null
}

/**
 * Checks if a username is available.
 * @param username The username to check.
 * @returns Promise<boolean> True if available, false otherwise.
 */
export const checkUsernameAvailability = async (
  username: string
): Promise<boolean> => {
  // Validate the username first
  const validation = validateUsername(username)
  if (!validation.valid || !validation.normalized) {
    return false
  }

  const normalized = validation.normalized

  // Check if it's a reserved username
  if (RESERVED_USERNAMES.has(normalized)) {
    return false
  }

  const usernameDoc = await getDoc(doc(firestore, "usernames", normalized))
  return !usernameDoc.exists()
}

/**
 * Claims a username for the current user.
 * @param username The new username to claim.
 * @returns Promise<void>
 */
export const claimUsername = async (username: string): Promise<void> => {
  const user = auth.currentUser
  if (!user) throw new Error("User not authenticated")

  // Validate and normalize the username
  const validation = validateUsername(username)
  if (!validation.valid || !validation.normalized) {
    throw new Error(validation.error || "Invalid username")
  }

  const normalized = validation.normalized

  // Check reserved usernames
  if (RESERVED_USERNAMES.has(normalized)) {
    throw new Error("This username is reserved")
  }

  await runTransaction(firestore, async (transaction) => {
    const userDocRef = doc(firestore, "users", user.uid)
    const usernameDocRef = doc(firestore, "usernames", normalized)

    const userDoc = await transaction.get(userDocRef)
    const usernameDoc = await transaction.get(usernameDocRef)

    if (usernameDoc.exists()) {
      const ownerId = resolveUserClaimId(usernameDoc.data() as UsernameDocData)
      if (ownerId !== user.uid) {
        throw new Error("Username already taken")
      }
    }

    const oldUsername = userDoc.exists() ? userDoc.data()?.username : null
    const oldNormalized = oldUsername ? normalizeUsername(oldUsername) : null

    // 1. Create entry in usernames collection
    transaction.set(usernameDocRef, {
      entityType: "user",
      entityId: user.uid,
      createdAt: serverTimestamp(),
    })

    // 2. Update user document, creating a full account-profile document if needed.
    if (userDoc.exists()) {
      transaction.set(
        userDocRef,
        {
          username: normalized,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    } else {
      transaction.set(userDocRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        username: normalized,
        isPublic: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }

    // 3. If user had an old username, delete it
    if (oldNormalized && oldNormalized !== normalized) {
      const oldUsernameDocRef = doc(firestore, "usernames", oldNormalized)
      transaction.delete(oldUsernameDocRef)
    }
  })
}

export type UserFetchResult =
  | {
      status: "found"
      data: ReturnType<
        typeof import("firebase/firestore").DocumentSnapshot.prototype.data
      >
    }
  | { status: "not_found" }
  | { status: "private"; displayName?: string }
  | { status: "error"; message: string }

export type TeamFetchResult =
  | {
      status: "found"
      teamId: string
      data: ReturnType<
        typeof import("firebase/firestore").DocumentSnapshot.prototype.data
      >
    }
  | { status: "not_found" }
  | { status: "private"; teamId?: string; name?: string }
  | { status: "error"; message: string }

/**
 * Fetches user data by username.
 * @param username The username to search for.
 * @returns Promise<UserFetchResult> Detailed result of user fetch.
 */
export const getUserByUsername = async (
  username: string
): Promise<UserFetchResult> => {
  try {
    const normalized = normalizeUsername(username)

    if (!normalized) {
      return { status: "not_found" }
    }

    const usernameDoc = await getDoc(doc(firestore, "usernames", normalized))

    if (!usernameDoc.exists()) {
      return { status: "not_found" }
    }

    const usernameData = usernameDoc.data() as UsernameDocData
    const uid = resolveUserClaimId(usernameData)
    if (!uid) {
      return { status: "not_found" }
    }

    const userDocRef = doc(firestore, "users", uid)
    const userDoc = await getDoc(userDocRef)

    if (!userDoc.exists()) {
      return { status: "not_found" }
    }

    const data = userDoc.data()
    // Only show public profiles - private profiles should use /profile page
    if (!data.isPublic) {
      return { status: "private", displayName: data.displayName }
    }

    return { status: "found", data }
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "permission-denied"
    ) {
      console.warn("Permission denied fetching user profile:", username)
      return { status: "private" }
    }
    throw error
  }
}

/**
 * Fetches team data by public username/handle.
 * @param username The username/handle to search for.
 * @returns Promise<TeamFetchResult> Detailed result of team fetch.
 */
export const getTeamByUsername = async (
  username: string
): Promise<TeamFetchResult> => {
  try {
    const normalized = normalizeUsername(username)

    if (!normalized) {
      return { status: "not_found" }
    }

    const usernameDoc = await getDoc(doc(firestore, "usernames", normalized))

    if (!usernameDoc.exists()) {
      return { status: "not_found" }
    }

    const usernameData = usernameDoc.data() as UsernameDocData
    const teamId = resolveTeamClaimId(usernameData)
    if (!teamId) {
      return { status: "not_found" }
    }
    const teamDocRef = doc(firestore, "teams", teamId)
    const teamDoc = await getDoc(teamDocRef)

    if (!teamDoc.exists()) {
      return { status: "not_found" }
    }

    const data = teamDoc.data()
    if (!data.isPublic) {
      return { status: "private", teamId, name: data.name }
    }

    return { status: "found", teamId, data }
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "permission-denied"
    ) {
      console.warn("Permission denied fetching team profile:", username)
      return { status: "private" }
    }
    throw error
  }
}

/**
 * Releases a username so it can be claimed by others.
 * Should be called when a user deletes their account.
 * @param username The username to release.
 * @returns Promise<void>
 */
export const releaseUsername = async (username: string): Promise<void> => {
  const user = auth.currentUser
  if (!user) throw new Error("User not authenticated")

  const normalized = normalizeUsername(username)
  if (!normalized) return

  const usernameDocRef = doc(firestore, "usernames", normalized)
  const usernameDoc = await getDoc(usernameDocRef)

  // Only delete if it belongs to the requesting user
  if (
    usernameDoc.exists() &&
    resolveUserClaimId(usernameDoc.data() as UsernameDocData) === user.uid
  ) {
    await deleteDoc(usernameDocRef)
  }
}

import {
  claimUsername as claimUsernameCallable,
  releaseUsername as releaseUsernameCallable,
} from "@/composables/useFunctions"
import {
  normalizeUsername,
  RESERVED_USERNAMES,
  validateUsername,
} from "@/helpers/username"
import { firestore } from "@/modules/firebase"
import type { IUsernameClaim } from "@/types/domain"
import { doc, getDoc } from "firebase/firestore"

/** The claim's target id when it points at an entity of `type`. */
const claimTarget = (
  data: IUsernameClaim | undefined,
  type: IUsernameClaim["entityType"]
): string | null =>
  data?.entityType === type && data.entityId ? data.entityId : null

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
  const validation = validateUsername(username)
  if (!validation.valid || !validation.normalized) {
    throw new Error(validation.error || "Invalid username")
  }

  await claimUsernameCallable({ username: validation.normalized })
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
    const uid = claimTarget(
      usernameDoc.data() as IUsernameClaim | undefined,
      "user"
    )
    if (!uid) return { status: "not_found" }

    const userDoc = await getDoc(doc(firestore, "users", uid))
    if (!userDoc.exists()) return { status: "not_found" }

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
    const teamId = claimTarget(
      usernameDoc.data() as IUsernameClaim | undefined,
      "team"
    )
    if (!teamId) return { status: "not_found" }

    const teamDoc = await getDoc(doc(firestore, "teams", teamId))
    if (!teamDoc.exists()) return { status: "not_found" }

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
  const normalized = normalizeUsername(username)
  if (!normalized) return

  await releaseUsernameCallable({ username: normalized })
}

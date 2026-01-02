import { auth, firestore } from "@/modules/firebase"
import {
  normalizeUsername,
  RESERVED_USERNAMES,
  validateUsername,
} from "@/utils/firebase-username"
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore"

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
      throw new Error("Username already taken")
    }

    const oldUsername = userDoc.exists() ? userDoc.data()?.username : null
    const oldNormalized = oldUsername ? normalizeUsername(oldUsername) : null

    // 1. Create entry in usernames collection
    transaction.set(usernameDocRef, {
      uid: user.uid,
      createdAt: serverTimestamp(),
    })

    // 2. Update user document (use set with merge to handle case where doc doesn't exist)
    transaction.set(
      userDocRef,
      {
        username: normalized,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )

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

    const uid = usernameDoc.data().uid
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

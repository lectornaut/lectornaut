import { auth, firestore } from "@/modules/firebase"
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
export const checkUsernameAvailability = async (username: string) => {
  if (!username || username.length < 3) return false
  const usernameDoc = await getDoc(
    doc(firestore, "usernames", username.toLowerCase())
  )
  return !usernameDoc.exists()
}

/**
 * Claims a username for the current user.
 * @param username The new username to claim.
 * @returns Promise<void>
 */
export const claimUsername = async (username: string) => {
  const user = auth.currentUser
  if (!user) throw new Error("User not authenticated")

  const normalizedUsername = username.toLowerCase()

  await runTransaction(firestore, async (transaction) => {
    const userDocRef = doc(firestore, "users", user.uid)
    const usernameDocRef = doc(firestore, "usernames", normalizedUsername)

    const userDoc = await transaction.get(userDocRef)
    const usernameDoc = await transaction.get(usernameDocRef)

    if (usernameDoc.exists()) {
      throw new Error("Username already taken")
    }

    const oldUsername = userDoc.data()?.username

    // 1. Create entry in usernames collection
    transaction.set(usernameDocRef, {
      uid: user.uid,
    })

    // 2. Update user document
    transaction.update(userDocRef, {
      username: normalizedUsername,
      updatedAt: serverTimestamp(),
    })

    // 3. If user had an old username, delete it
    if (oldUsername && oldUsername !== normalizedUsername) {
      const oldUsernameDocRef = doc(
        firestore,
        "usernames",
        oldUsername.toLowerCase()
      )
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
    const normalizedUsername = username.toLowerCase()
    const usernameDoc = await getDoc(
      doc(firestore, "usernames", normalizedUsername)
    )

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
    // Check if profile is public or if viewer is the owner
    if (!data.isPublic && auth.currentUser?.uid !== uid) {
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

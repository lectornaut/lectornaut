import { FirebaseError } from "firebase/app"

/**
 * Get a user-friendly error message for Firebase Auth errors.
 */
export const getAuthErrorMessage = (error: unknown): string => {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/email-already-in-use":
        return "This email is already associated with an account."
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "Invalid email or password."
      case "auth/weak-password":
        return "Password should be at least 6 characters."
      case "auth/invalid-email":
        return "Please enter a valid email address."
      case "auth/network-request-failed":
        return "Network error. Please check your connection."
      case "auth/too-many-requests":
        return "Too many attempts. Please try again later."
      case "auth/popup-closed-by-user":
        return "Sign in cancelled."
      case "auth/requires-recent-login":
        return "Please log in again to continue."
      case "auth/user-disabled":
        return "This account has been disabled."
      default:
        return error.message
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return "An unknown error occurred."
}

/**
 * Get a user-friendly error message for Firestore errors.
 */
export const getFirestoreErrorMessage = (error: unknown): string => {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "permission-denied":
        return "You don't have permission to perform this action."
      case "not-found":
        return "The requested document was not found."
      case "already-exists":
        return "This document already exists."
      case "resource-exhausted":
        return "Too many requests. Please try again later."
      case "failed-precondition":
        return "Operation failed. Please refresh and try again."
      case "aborted":
        return "Operation was aborted. Please try again."
      case "out-of-range":
        return "Operation is out of range."
      case "unimplemented":
        return "This operation is not supported."
      case "internal":
        return "An internal error occurred. Please try again."
      case "unavailable":
        return "Service temporarily unavailable. Please try again."
      case "data-loss":
        return "Data loss occurred. Please contact support."
      case "unauthenticated":
        return "Please sign in to continue."
      case "cancelled":
        return "Operation was cancelled."
      case "unknown":
        return "An unknown error occurred. Please try again."
      case "invalid-argument":
        return "Invalid data provided. Please check your input."
      case "deadline-exceeded":
        return "Operation timed out. Please try again."
      default:
        return error.message
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return "An unknown error occurred."
}

/**
 * Check if a Firebase error is retryable.
 */
export const isRetryableFirebaseError = (error: unknown): boolean => {
  if (error instanceof FirebaseError) {
    return [
      "unavailable",
      "deadline-exceeded",
      "resource-exhausted",
      "aborted",
      "internal",
    ].includes(error.code)
  }
  return false
}

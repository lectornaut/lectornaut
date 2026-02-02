import { FirebaseError } from "firebase/app"

// ============================================================================
// Typed Error Code Constants
// ============================================================================

/**
 * Firebase Auth error codes
 */
export const AuthErrorCodes = {
  EMAIL_IN_USE: "auth/email-already-in-use",
  INVALID_CREDENTIAL: "auth/invalid-credential",
  WRONG_PASSWORD: "auth/wrong-password",
  USER_NOT_FOUND: "auth/user-not-found",
  WEAK_PASSWORD: "auth/weak-password",
  INVALID_EMAIL: "auth/invalid-email",
  NETWORK_FAILED: "auth/network-request-failed",
  TOO_MANY_REQUESTS: "auth/too-many-requests",
  POPUP_CLOSED: "auth/popup-closed-by-user",
  REQUIRES_RECENT_LOGIN: "auth/requires-recent-login",
  USER_DISABLED: "auth/user-disabled",
} as const

export type AuthErrorCode = (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes]

/**
 * Firestore error codes
 */
export const FirestoreErrorCodes = {
  PERMISSION_DENIED: "permission-denied",
  NOT_FOUND: "not-found",
  ALREADY_EXISTS: "already-exists",
  RESOURCE_EXHAUSTED: "resource-exhausted",
  FAILED_PRECONDITION: "failed-precondition",
  ABORTED: "aborted",
  OUT_OF_RANGE: "out-of-range",
  UNIMPLEMENTED: "unimplemented",
  INTERNAL: "internal",
  UNAVAILABLE: "unavailable",
  DATA_LOSS: "data-loss",
  UNAUTHENTICATED: "unauthenticated",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
  INVALID_ARGUMENT: "invalid-argument",
  DEADLINE_EXCEEDED: "deadline-exceeded",
} as const

export type FirestoreErrorCode =
  (typeof FirestoreErrorCodes)[keyof typeof FirestoreErrorCodes]

/**
 * Retryable Firestore error codes
 */
const RETRYABLE_ERROR_CODES: readonly FirestoreErrorCode[] = [
  FirestoreErrorCodes.UNAVAILABLE,
  FirestoreErrorCodes.DEADLINE_EXCEEDED,
  FirestoreErrorCodes.RESOURCE_EXHAUSTED,
  FirestoreErrorCodes.ABORTED,
  FirestoreErrorCodes.INTERNAL,
] as const

// ============================================================================
// Error Message Helpers
// ============================================================================

/**
 * Get a user-friendly error message for Firebase Auth errors.
 */
export const getAuthErrorMessage = (error: unknown): string => {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case AuthErrorCodes.EMAIL_IN_USE:
        return "This email is already associated with an account."
      case AuthErrorCodes.INVALID_CREDENTIAL:
      case AuthErrorCodes.WRONG_PASSWORD:
      case AuthErrorCodes.USER_NOT_FOUND:
        return "Invalid email or password."
      case AuthErrorCodes.WEAK_PASSWORD:
        return "Password should be at least 6 characters."
      case AuthErrorCodes.INVALID_EMAIL:
        return "Please enter a valid email address."
      case AuthErrorCodes.NETWORK_FAILED:
        return "Network error. Please check your connection."
      case AuthErrorCodes.TOO_MANY_REQUESTS:
        return "Too many attempts. Please try again later."
      case AuthErrorCodes.POPUP_CLOSED:
        return "Sign in cancelled."
      case AuthErrorCodes.REQUIRES_RECENT_LOGIN:
        return "Please log in again to continue."
      case AuthErrorCodes.USER_DISABLED:
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
      case FirestoreErrorCodes.PERMISSION_DENIED:
        return "You don't have permission to perform this action."
      case FirestoreErrorCodes.NOT_FOUND:
        return "The requested document was not found."
      case FirestoreErrorCodes.ALREADY_EXISTS:
        return "This document already exists."
      case FirestoreErrorCodes.RESOURCE_EXHAUSTED:
        return "Too many requests. Please try again later."
      case FirestoreErrorCodes.FAILED_PRECONDITION:
        return "Operation failed. Please refresh and try again."
      case FirestoreErrorCodes.ABORTED:
        return "Operation was aborted. Please try again."
      case FirestoreErrorCodes.OUT_OF_RANGE:
        return "Operation is out of range."
      case FirestoreErrorCodes.UNIMPLEMENTED:
        return "This operation is not supported."
      case FirestoreErrorCodes.INTERNAL:
        return "An internal error occurred. Please try again."
      case FirestoreErrorCodes.UNAVAILABLE:
        return "Service temporarily unavailable. Please try again."
      case FirestoreErrorCodes.DATA_LOSS:
        return "Data loss occurred. Please contact support."
      case FirestoreErrorCodes.UNAUTHENTICATED:
        return "Please sign in to continue."
      case FirestoreErrorCodes.CANCELLED:
        return "Operation was cancelled."
      case FirestoreErrorCodes.UNKNOWN:
        return "An unknown error occurred. Please try again."
      case FirestoreErrorCodes.INVALID_ARGUMENT:
        return "Invalid data provided. Please check your input."
      case FirestoreErrorCodes.DEADLINE_EXCEEDED:
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
    return RETRYABLE_ERROR_CODES.includes(error.code as FirestoreErrorCode)
  }
  return false
}

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
  MFA_REQUIRED: "auth/multi-factor-auth-required",
  INVALID_VERIFICATION_CODE: "auth/invalid-verification-code",
  MISSING_MFA_INFO: "auth/missing-multi-factor-info",
  MFA_INFO_NOT_FOUND: "auth/multi-factor-info-not-found",
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
 * Retryable Firestore error codes (the WRITE/sync-engine taxonomy — purely
 * transient infrastructure failures). Auth/permission codes are deliberately
 * excluded here: re-sending a write the server rejected for authorization is
 * pointless. Reads use the broader {@link RETRYABLE_READ_ERROR_CODES} below.
 */
const RETRYABLE_ERROR_CODES = new Set<FirestoreErrorCode>([
  FirestoreErrorCodes.UNAVAILABLE,
  FirestoreErrorCodes.DEADLINE_EXCEEDED,
  FirestoreErrorCodes.RESOURCE_EXHAUSTED,
  FirestoreErrorCodes.ABORTED,
  FirestoreErrorCodes.INTERNAL,
])

/**
 * Read-layer (realtime listener) retryable codes. A superset of
 * {@link RETRYABLE_ERROR_CODES} that ALSO retries the two auth/permission codes
 * which are transient specifically during the cold-start token warm-up window:
 * a realtime `onSnapshot` listener can open in the brief gap before the Firebase
 * Auth ID token (with custom claims) or the App Check token is ready, and
 * Firestore rules then reject that first connection with `permission-denied` /
 * `unauthenticated` even though the user is fully authorized. These heal on a
 * retry a moment later.
 *
 * This is bounded by the query layer's retry cap (see `queryClient.ts`), so a
 * GENUINE denial still surfaces as an error after a few attempts instead of
 * retrying forever — and, critically, the realtime read primitive only opens a
 * listener after `enabled` gates pass, so we never retry a query the user has
 * no business making. `not-found` stays non-retryable: a missing document is a
 * definitive answer, not a transient one.
 */
const RETRYABLE_READ_ERROR_CODES = new Set<FirestoreErrorCode>([
  ...RETRYABLE_ERROR_CODES,
  FirestoreErrorCodes.PERMISSION_DENIED,
  FirestoreErrorCodes.UNAUTHENTICATED,
])

const FIREBASE_ERROR_PREFIX_SEPARATOR = "/"

/**
 * Normalize Firebase SDK namespaced error codes (e.g. "functions/not-found")
 * to canonical status codes (e.g. "not-found").
 */
export const normalizeFirebaseErrorCode = (code: string): string => {
  const separatorIndex = code.indexOf(FIREBASE_ERROR_PREFIX_SEPARATOR)
  if (separatorIndex === -1) {
    return code
  }

  return code.slice(separatorIndex + 1)
}

/**
 * Extract normalized Firebase error code from an unknown error.
 */
export const getFirebaseErrorCode = (error: unknown): string | null => {
  if (!(error instanceof FirebaseError)) {
    return null
  }

  return normalizeFirebaseErrorCode(error.code)
}

/**
 * Check whether an unknown error matches a Firebase code.
 */
export const hasFirebaseErrorCode = (error: unknown, code: string): boolean => {
  const normalizedErrorCode = getFirebaseErrorCode(error)
  if (!normalizedErrorCode) {
    return false
  }

  return normalizedErrorCode === normalizeFirebaseErrorCode(code)
}

// ============================================================================
// Error Message Helpers
// ============================================================================

/**
 * Safely extract a human-readable message from an unknown thrown value.
 *
 * Unlike `(error as Error).message`, this never throws when the caught value
 * isn't an Error (JS allows throwing strings, numbers, or null): it prefers the
 * Error's own message, then a thrown non-empty string, then the fallback.
 */
export const getErrorMessage = (
  error: unknown,
  fallback = "Something went wrong"
): string => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

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
      case AuthErrorCodes.INVALID_VERIFICATION_CODE:
        return "Invalid verification code. Please try again."
      case AuthErrorCodes.MISSING_MFA_INFO:
        return "Missing multi-factor authentication information."
      case AuthErrorCodes.MFA_INFO_NOT_FOUND:
        return "Multi-factor authentication method not found."
      // MFA_REQUIRED is intentionally omitted — the MfaResolverDialog handles it
      // before any error message is shown to the user.
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
  const code = getFirebaseErrorCode(error)
  if (code) {
    switch (code) {
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
        if (error instanceof FirebaseError) {
          return error.message
        }
        break
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return "An unknown error occurred."
}

/**
 * Check if a Firebase error is retryable for a WRITE (sync-engine) operation.
 */
export const isRetryableFirebaseError = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)
  return code ? RETRYABLE_ERROR_CODES.has(code as FirestoreErrorCode) : false
}

/**
 * Check if a Firebase error is retryable for a READ (realtime listener) query.
 * Broader than {@link isRetryableFirebaseError}: also retries the cold-start
 * auth/App-Check token-warm-up codes (`permission-denied` / `unauthenticated`)
 * that would otherwise leave a bootstrap query's `data` undefined forever and
 * hang the app shell on its loading gate. See {@link RETRYABLE_READ_ERROR_CODES}.
 */
export const isRetryableReadError = (error: unknown): boolean => {
  const code = getFirebaseErrorCode(error)
  return code
    ? RETRYABLE_READ_ERROR_CODES.has(code as FirestoreErrorCode)
    : false
}

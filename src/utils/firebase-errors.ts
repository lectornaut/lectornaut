import { FirebaseError } from "firebase/app"

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

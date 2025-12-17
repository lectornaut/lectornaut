import { useKeychain } from "@/composables/useKeychain"
import { isTauri } from "@/composables/usePlatform"
import { auth } from "@/modules/firebase"
import { router } from "@/modules/router"
import { setDefaultUserData } from "@/queries/setDefaultUserData"
import { updateUserData } from "@/queries/updateUserData"
import { invoke } from "@tauri-apps/api/core"
import type { FirebaseError } from "firebase/app"
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  onIdTokenChanged,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  type UserCredential,
} from "firebase/auth"
import { toast } from "vue-sonner"

export const emailForSignIn = useStorage("emailForSignIn", "")
export const lastAuthProvider = useStorage("lastAuthProvider", "")

/**
 * Loopback mechanism for Tauri (no remote deep link)
 * Starts a local server to listen for the magic link callback
 */
export const sendAuthenticateEmail = async (email: string) => {
  const port = 7878
  let magicLinkPromise: Promise<string> | null = null

  if (isTauri.value) {
    // Start listening BEFORE sending email, but don't await yet
    magicLinkPromise = invoke<string>("listen_magic_link", { port })
  }

  const url = isTauri.value
    ? `http://localhost:${port}/verify`
    : `${window.location.origin}/enter?target=web`

  const actionCodeSettings = {
    url,
    handleCodeInApp: true,
  }

  return sendSignInLinkToEmail(auth, email, actionCodeSettings)
    .then(async () => {
      emailForSignIn.value = email
      lastAuthProvider.value = "email-link"
      toast.success("Authentication email sent")

      // If Tauri, wait for the link to be clicked WITHOUT blocking the return
      if (isTauri.value && magicLinkPromise) {
        // We do NOT await this block, so the function returns immediately related to the UI state
        ;(async () => {
          try {
            const fullUrl = await magicLinkPromise
            toast.dismiss("magic-link-wait")
            // Process the returned URL
            const link = new URL(fullUrl).href
            if (isSignInWithEmailLink(auth, link)) {
              await signInWithEmailLink(auth, email, link).then(
                async (result) => {
                  emailForSignIn.value = null
                  finishAuthentication(result)
                }
              )
            }
          } catch (error) {
            toast.dismiss("magic-link-wait")
            console.error("Magic link listener failed:", error)
            toast.error("Magic link listener timed out or failed")
          }
        })()
      }
    })
    .catch((error) => {
      console.error("Error in sendAuthenticateEmail:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

/**
 * Sends a password reset email to the user
 * @param email - The email address to send the reset link to
 */
export const sendResetEmailPassword = async (email: string) => {
  return sendPasswordResetEmail(auth, email)
    .then(() => {
      toast.success("Password reset email sent")
    })
    .catch((error) => {
      console.error("Error in resetPassword:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

/**
 * Helper to retrieve the Firebase Auth persistence key from LocalStorage
 * Used to manually manage session data for account switching
 */
const getFirebaseKey = () => {
  const foundKey = Object.keys(window.localStorage).find((k) =>
    k.startsWith("firebase:authUser:")
  )
  if (foundKey) return foundKey

  // Fallback: construct the key manually if not found (e.g. user is logged out)
  const apiKey = import.meta.env.VITE_API_KEY
  return `firebase:authUser:${apiKey}:[DEFAULT]`
}

/**
 * Listens for auth state changes (token refreshes, sign-ins) and keeps the keychain updated.
 * This ensures we capture the freshest session data whenever it changes.
 */
export const initKeychainListener = () => {
  onIdTokenChanged(auth, async (user) => {
    if (user) {
      const key = getFirebaseKey()
      if (key) {
        const sessionDataRaw = window.localStorage.getItem(key)
        if (sessionDataRaw) {
          useKeychain().addAccount({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            sessionData: JSON.parse(sessionDataRaw),
          })
        }
      }
    }
  })
}

const finishAuthentication = async (result: UserCredential) => {
  toast.success("Logged in")

  if (getAdditionalUserInfo(result)?.isNewUser) {
    setDefaultUserData()
    await router.push("/welcome")
  } else {
    updateUserData()
    await router.push("/home")
  }
}

/**
 * Switches the current session to another account stored in the keychain
 * @param targetUid - The UID of the account to switch to
 */
export const switchAccount = async (targetUid: string) => {
  const account = useKeychain().getAccount(targetUid)
  if (!account || !account.sessionData) {
    toast.error("Account session not found in keychain")
    return
  }

  // Client-side session restore
  try {
    await auth.signOut() // Clear current in-memory state

    const key = getFirebaseKey()
    if (key) {
      window.localStorage.setItem(key, JSON.stringify(account.sessionData))
      // Reload to force Firebase SDK to pick up the injected persistence
      window.location.reload()
    } else {
      // If no key found (shouldn't happen if we just signed out, the key usually remains or we can reconstruct it),
      // we might need to know the apiKey and appName to reconstruct the key string.
      // However, usually the key exists.
      // Fallback: search for it again or error out.
      console.error("Firebase Auth persistence key missing")
      toast.error("Failed to switch account: Persistence key missing")
    }
  } catch (error) {
    console.error("Error switching account:", error)
    toast.error("Failed to switch account.")
  }
}

/**
 * Completes the email link sign-in process
 * Checks if the current URL is a sign-in link and then signs the user in
 */
export const authenticateEmail = async () => {
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = emailForSignIn.value
    if (!email) {
      email = window.prompt("Please provide your email for confirmation") || ""
    }

    if (email) {
      return signInWithEmailLink(auth, email, window.location.href)
        .then(async (result) => {
          emailForSignIn.value = null
          finishAuthentication(result)
        })
        .catch((error) => {
          console.error("Error in authenticateEmail:", error)
          toast.error((error as FirebaseError).message)
          throw error
        })
    }
  }
}

/**
 * Signs up a new user with email and password
 * @param email - User's email
 * @param password - User's password
 */
export const signUpWithEmailPassword = async (
  email: string,
  password: string
) => {
  return createUserWithEmailAndPassword(auth, email, password)
    .then(async (result) => {
      lastAuthProvider.value = "email-password"
      finishAuthentication(result)
    })
    .catch((error) => {
      console.error("Error in signUpWithEmail:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

/**
 * Signs in a user with email and password
 * @param email - User's email
 * @param password - User's password
 */
export const signInWithEmailPassword = async (
  email: string,
  password: string
) => {
  return signInWithEmailAndPassword(auth, email, password)
    .then(async (result) => {
      lastAuthProvider.value = "email-password"
      finishAuthentication(result)
    })
    .catch((error) => {
      console.error("Error in signInWithEmail:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

/**
 * Initiates the Google Sign-In flow
 * Handles both Tauri (via local server loopback) and Web (via popup) environments
 */
export const signInWithGoogle = async () => {
  if (isTauri.value) {
    try {
      const response = await invoke<{ id_token: string }>("login_oauth", {
        config: {
          auth_url: import.meta.env.VITE_GOOGLE_AUTH_URL,
          token_url: import.meta.env.VITE_GOOGLE_TOKEN_URL,
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          client_secret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET,
          redirect_uri: import.meta.env.VITE_GOOGLE_REDIRECT_URI,
          scopes: "openid email profile",
          extra_params: {
            access_type: "offline",
          },
        },
      })
      const credential = GoogleAuthProvider.credential(response.id_token)
      return signInWithCredential(auth, credential).then(async (result) => {
        lastAuthProvider.value = "google"
        finishAuthentication(result)
      })
    } catch (error) {
      console.error("Error in signInWithGoogle (Tauri):", error)
      toast.error((error as Error).toString())
      throw error
    }
  } else {
    const provider = new GoogleAuthProvider()
    return signInWithPopup(auth, provider)
      .then(async (result) => {
        lastAuthProvider.value = "google"
        finishAuthentication(result)
      })
      .catch((error) => {
        console.error("Error in signInWithGoogle:", error)
        toast.error((error as FirebaseError).message)
        throw error
      })
  }
}

/**
 * Initiates the Microsoft Sign-In flow
 * Handles both Tauri (via local server loopback) and Web (via popup) environments
 */
export const signInWithMicrosoft = async () => {
  if (isTauri.value) {
    try {
      const response = await invoke<{ id_token: string; access_token: string }>(
        "login_oauth",
        {
          config: {
            auth_url: import.meta.env.VITE_MICROSOFT_AUTH_URL,
            token_url: import.meta.env.VITE_MICROSOFT_TOKEN_URL,
            client_id: import.meta.env.VITE_MICROSOFT_CLIENT_ID,
            client_secret: import.meta.env.VITE_MICROSOFT_CLIENT_SECRET,
            redirect_uri: import.meta.env.VITE_MICROSOFT_REDIRECT_URI,
            scopes: "openid email profile offline_access",
            extra_params: null,
          },
        }
      )
      const provider = new OAuthProvider("microsoft.com")
      const credential = provider.credential({
        idToken: response.id_token,
        accessToken: response.access_token,
      })
      return signInWithCredential(auth, credential).then(async (result) => {
        lastAuthProvider.value = "microsoft"
        finishAuthentication(result)
      })
    } catch (error) {
      console.error("Error in signInWithMicrosoft (Tauri):", error)
      toast.error((error as Error).toString())
      throw error
    }
  } else {
    const provider = new OAuthProvider("microsoft.com")
    return signInWithPopup(auth, provider)
      .then(async (result) => {
        lastAuthProvider.value = "microsoft"
        finishAuthentication(result)
      })
      .catch((error) => {
        console.error("Error in signInWithMicrosoft:", error)
        toast.error((error as FirebaseError).message)
        throw error
      })
  }
}

/**
 * Initiates the Apple Sign-In flow
 * Handles both Tauri (via local server loopback) and Web (via popup) environments
 */
export const signInWithApple = async () => {
  if (isTauri.value) {
    try {
      const response = await invoke<{ id_token: string }>("login_oauth", {
        config: {
          auth_url: import.meta.env.VITE_APPLE_AUTH_URL,
          token_url: import.meta.env.VITE_APPLE_TOKEN_URL,
          client_id: import.meta.env.VITE_APPLE_CLIENT_ID,
          client_secret: import.meta.env.VITE_APPLE_CLIENT_SECRET,
          redirect_uri: import.meta.env.VITE_APPLE_REDIRECT_URI,
          scopes: "name email",
          extra_params: {
            response_mode: "form_post",
          },
        },
      })
      const provider = new OAuthProvider("apple.com")
      const credential = provider.credential({
        idToken: response.id_token,
      })
      return signInWithCredential(auth, credential).then(async (result) => {
        lastAuthProvider.value = "apple"
        finishAuthentication(result)
      })
    } catch (error) {
      console.error("Error in signInWithApple (Tauri):", error)
      toast.error((error as Error).toString())
      throw error
    }
  } else {
    const provider = new OAuthProvider("apple.com")
    return signInWithPopup(auth, provider)
      .then(async (result) => {
        lastAuthProvider.value = "apple"
        finishAuthentication(result)
      })
      .catch((error) => {
        console.error("Error in signInWithApple:", error)
        toast.error((error as FirebaseError).message)
        throw error
      })
  }
}

/**
 * Logs out the current user and redirects to the home page
 */
export const logout = async () => {
  return auth
    .signOut()
    .then(async () => {
      toast.success("Logged out")
      await router.push("/enter")
    })
    .catch((error) => {
      console.error("Error in logout:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

import {
  DEFAULT_KEYCHAIN_MAX_AGE_MS,
  useKeychain,
} from "@/composables/useKeychain"
import { isTauri } from "@/composables/usePlatform"
import { generateRandomString } from "@/helpers/utilities"
import { auth, functions } from "@/modules/firebase"
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
  type UserCredential,
} from "firebase/auth"
import { httpsCallable } from "firebase/functions"
import { toast } from "vue-sonner"

// Type definitions for Tauri OAuth responses
interface OAuthResponse {
  id_token: string
  access_token?: string
}

/**
 * Unified error handler for authentication errors
 * Provides consistent error messaging across Tauri and Web
 */
const handleAuthError = (error: unknown, context: string): never => {
  console.error(`Error in ${context}:`, error)

  let message: string
  if (error instanceof Error) {
    // Handle Firebase errors with code property
    const firebaseError = error as FirebaseError
    message = firebaseError.message || error.toString()
  } else if (typeof error === "string") {
    message = error
  } else {
    message = "An unexpected error occurred"
  }

  toast.error(message)
  throw error
}

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

  let urlObj: URL
  if (isTauri.value) {
    urlObj = new URL(`http://localhost:${port}/verify`)
  } else {
    urlObj = new URL(`${window.location.origin}/enter`)
    urlObj.searchParams.append("target", "web")
  }

  const redirect = router.currentRoute.value.query.redirect
  if (typeof redirect === "string") {
    urlObj.searchParams.append("redirect", redirect)
  }

  const url = urlObj.toString()

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
        // Show waiting toast with persistent ID
        toast.loading("Waiting for email verification...", {
          id: "magic-link-wait",
          duration: Infinity,
        })

        // We do NOT await this block, so the function returns immediately related to the UI state
        ;(async () => {
          try {
            const fullUrl = await magicLinkPromise
            toast.dismiss("magic-link-wait")
            // Process the returned URL
            const link = new URL(fullUrl).href
            if (isSignInWithEmailLink(auth, link)) {
              const result = await signInWithEmailLink(auth, email, link)
              emailForSignIn.value = null
              finishAuthentication(result)
            } else {
              toast.error("Invalid sign-in link received")
            }
          } catch (error) {
            toast.dismiss("magic-link-wait")
            console.error("Magic link listener failed:", error)
            toast.error("Magic link verification failed. Please try again.")
          }
        })()
      }
    })
    .catch((error) => handleAuthError(error, "sendAuthenticateEmail"))
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
    .catch((error) => handleAuthError(error, "sendResetEmailPassword"))
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
export const initKeychain = () => {
  // Prune accounts inactive for 30 days
  useKeychain().pruneExpiredAccounts(DEFAULT_KEYCHAIN_MAX_AGE_MS)

  onIdTokenChanged(auth, async (user) => {
    if (user) {
      // If we intended to switch to this user, clear the pending flag since it succeeded
      const pendingUid = sessionStorage.getItem("pendingAccountSwitch")
      if (pendingUid === user.uid) {
        sessionStorage.removeItem("pendingAccountSwitch")
      }

      const { hasAccount, addAccount } = useKeychain()
      // Only update if account is already trusted (in keychain)
      if (hasAccount(user.uid)) {
        const key = getFirebaseKey()
        if (key) {
          const sessionData = useStorage(key, null)
          if (sessionData.value) {
            addAccount({
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
              sessionData: sessionData.value as Record<string, unknown>,
            })
          }
        }
      }
    }
  })
}

const finishAuthentication = async (result: UserCredential) => {
  toast.success("Logged in")

  // Check if account is already in keychain
  const { hasAccount, addAccount } = useKeychain()
  const user = result.user

  if (!hasAccount(user.uid)) {
    toast("Trust this device for 30 days?", {
      action: {
        label: "Yes",
        onClick: () => {
          const key = getFirebaseKey()
          if (key) {
            const sessionData = useStorage(key, null)
            if (sessionData.value) {
              addAccount({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                sessionData: sessionData.value as Record<string, unknown>,
              })
            }
          }
        },
      },
      duration: Infinity, // Give user time to decide
    })
  }

  if (getAdditionalUserInfo(result)?.isNewUser) {
    try {
      // Send welcome email
      const sendEmail = httpsCallable(functions, "sendEmail")

      await sendEmail({
        email: user.email,
        subject: "Welcome to Lectornaut!",
        template: "welcome",
        data: {
          displayName: user.displayName || "there",
          ctaUrl: `${window.location.origin}/welcome`,
        },
      }).catch((error) => console.error("Failed to send welcome email:", error))
    } catch (error) {
      console.error("Error initiating welcome email:", error)
    }

    setDefaultUserData()
    await router.push("/welcome")
  } else {
    updateUserData()

    const redirect = router.currentRoute.value.query.redirect
    await router.push(typeof redirect === "string" ? redirect : "/start")
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
      // Store intent to switch account so we can handle session expiry/failure on reload
      sessionStorage.setItem("pendingAccountSwitch", targetUid)

      const sessionData = useStorage<Record<string, unknown> | null>(key, null)
      sessionData.value = account.sessionData
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
    sessionStorage.removeItem("pendingAccountSwitch")
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
        .catch((error) => handleAuthError(error, "authenticateEmail"))
    }
  }
}

/**
 * Completes the OAuth sign-in process
 * Checks if the current URL has tokens and then signs the user in
 */
export const authenticateOAuth = async () => {
  const hash = window.location.hash.substring(1)
  const params = new URLSearchParams(hash)
  const idToken = params.get("id_token")
  const accessToken = params.get("access_token")
  const error = params.get("error")
  const state = params.get("state")

  if (error) {
    if (window.opener) {
      window.opener.postMessage(
        { type: "auth_error", error },
        window.location.origin
      )
      window.close()
    } else {
      toast.error(`Auth error: ${error}`)
    }
    return
  }

  if (idToken && window.opener) {
    window.opener.postMessage(
      {
        type: "auth_success",
        idToken,
        accessToken,
        state,
      },
      window.location.origin
    )
    window.close()
  }
}

const openAuthPopup = (url: URL, providerName: string) => {
  const popup = window.open(url.toString(), "_blank")

  if (!popup) {
    toast.error("Popup blocked. Please allow popups for this site.")
    return Promise.reject("Popup blocked")
  }

  return new Promise<void>((resolve, reject) => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data.type === "auth_success") {
        window.removeEventListener("message", handleMessage)

        const { idToken, accessToken } = event.data
        let credential

        if (providerName === "google") {
          credential = GoogleAuthProvider.credential(idToken, accessToken)
        } else {
          const providerId =
            providerName === "microsoft" ? "microsoft.com" : "apple.com"
          credential = new OAuthProvider(providerId).credential({
            idToken,
            accessToken: accessToken || undefined,
          })
        }

        if (credential) {
          try {
            const result = await signInWithCredential(auth, credential)
            lastAuthProvider.value = providerName
            finishAuthentication(result)
            resolve()
          } catch (error) {
            console.error(`Error in signInWith${providerName}:`, error)
            toast.error((error as FirebaseError).message)
            reject(error)
          }
        }
      } else if (event.data.type === "auth_error") {
        window.removeEventListener("message", handleMessage)
        reject(new Error(event.data.error))
      }
    }

    window.addEventListener("message", handleMessage)
  })
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
    .catch((error) => handleAuthError(error, "signUpWithEmailPassword"))
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
    .catch((error) => handleAuthError(error, "signInWithEmailPassword"))
}

/**
 * Initiates the Google Sign-In flow
 * Handles both Tauri (via local server loopback) and Web (via popup) environments
 */
export const signInWithGoogle = async () => {
  if (isTauri.value) {
    try {
      const nonce = generateRandomString()
      const response = await invoke<OAuthResponse>("login_oauth", {
        config: {
          auth_url: import.meta.env.VITE_GOOGLE_AUTH_URL,
          token_url: import.meta.env.VITE_GOOGLE_TOKEN_URL,
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          client_secret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET,
          redirect_uri: import.meta.env.VITE_GOOGLE_REDIRECT_URI,
          scopes: "openid email profile",
          extra_params: {
            access_type: "offline",
            nonce,
          },
        },
      })
      const credential = GoogleAuthProvider.credential(
        response.id_token,
        response.access_token
      )
      const result = await signInWithCredential(auth, credential)
      lastAuthProvider.value = "google"
      return finishAuthentication(result)
    } catch (error) {
      return handleAuthError(error, "signInWithGoogle (Tauri)")
    }
  } else {
    const state = generateRandomString()
    const redirectUri = `${window.location.origin}/enter`
    const url = new URL(import.meta.env.VITE_GOOGLE_AUTH_URL)
    url.searchParams.append("client_id", import.meta.env.VITE_GOOGLE_CLIENT_ID)
    url.searchParams.append("redirect_uri", redirectUri)
    url.searchParams.append("response_type", "id_token token")
    url.searchParams.append("scope", "openid email profile")
    url.searchParams.append("state", state)
    url.searchParams.append("nonce", generateRandomString())

    return openAuthPopup(url, "google")
  }
}

/**
 * Initiates the Microsoft Sign-In flow
 * Handles both Tauri (via local server loopback) and Web (via popup) environments
 */
export const signInWithMicrosoft = async () => {
  if (isTauri.value) {
    try {
      const nonce = generateRandomString()
      const response = await invoke<OAuthResponse>("login_oauth", {
        config: {
          auth_url: import.meta.env.VITE_MICROSOFT_AUTH_URL,
          token_url: import.meta.env.VITE_MICROSOFT_TOKEN_URL,
          client_id: import.meta.env.VITE_MICROSOFT_CLIENT_ID,
          client_secret: import.meta.env.VITE_MICROSOFT_CLIENT_SECRET,
          redirect_uri: import.meta.env.VITE_MICROSOFT_REDIRECT_URI,
          scopes: "openid email profile offline_access",
          extra_params: {
            nonce,
          },
        },
      })
      const provider = new OAuthProvider("microsoft.com")
      const credential = provider.credential({
        idToken: response.id_token,
        accessToken: response.access_token,
      })
      const result = await signInWithCredential(auth, credential)
      lastAuthProvider.value = "microsoft"
      return finishAuthentication(result)
    } catch (error) {
      return handleAuthError(error, "signInWithMicrosoft (Tauri)")
    }
  } else {
    const state = generateRandomString()
    const url = new URL(import.meta.env.VITE_MICROSOFT_AUTH_URL)
    url.searchParams.append(
      "client_id",
      import.meta.env.VITE_MICROSOFT_CLIENT_ID
    )
    url.searchParams.append("redirect_uri", `${window.location.origin}/enter`)
    url.searchParams.append("response_type", "id_token token")
    url.searchParams.append("scope", "openid email profile offline_access")
    url.searchParams.append("response_mode", "fragment")
    url.searchParams.append("state", state)
    url.searchParams.append("nonce", generateRandomString())

    return openAuthPopup(url, "microsoft")
  }
}

/**
 * Initiates the Apple Sign-In flow
 * Handles both Tauri (via local server loopback) and Web (via popup) environments
 */
export const signInWithApple = async () => {
  if (isTauri.value) {
    try {
      const nonce = generateRandomString()
      const response = await invoke<OAuthResponse>("login_oauth", {
        config: {
          auth_url: import.meta.env.VITE_APPLE_AUTH_URL,
          token_url: import.meta.env.VITE_APPLE_TOKEN_URL,
          client_id: import.meta.env.VITE_APPLE_CLIENT_ID,
          client_secret: import.meta.env.VITE_APPLE_CLIENT_SECRET,
          redirect_uri: import.meta.env.VITE_APPLE_REDIRECT_URI,
          scopes: "name email",
          extra_params: {
            response_mode: "form_post",
            nonce,
          },
        },
      })
      const provider = new OAuthProvider("apple.com")
      const credential = provider.credential({
        idToken: response.id_token,
        accessToken: response.access_token,
      })
      const result = await signInWithCredential(auth, credential)
      lastAuthProvider.value = "apple"
      return finishAuthentication(result)
    } catch (error) {
      return handleAuthError(error, "signInWithApple (Tauri)")
    }
  } else {
    const state = generateRandomString()
    const url = new URL(import.meta.env.VITE_APPLE_AUTH_URL)
    url.searchParams.append("client_id", import.meta.env.VITE_APPLE_CLIENT_ID)
    url.searchParams.append("redirect_uri", `${window.location.origin}/enter`)
    url.searchParams.append("response_type", "code id_token")
    url.searchParams.append("scope", "name email")
    url.searchParams.append("response_mode", "fragment")
    url.searchParams.append("state", state)
    url.searchParams.append("nonce", generateRandomString())

    return openAuthPopup(url, "apple")
  }
}

/**
 * Logs out the current user and redirects to the home page
 */
export const logout = async (removeFromKeychain: boolean = false) => {
  const { removeAccount } = useKeychain()
  const currentUserUid = auth.currentUser?.uid

  // Remove account from keychain if requested
  if (removeFromKeychain && currentUserUid) {
    removeAccount(currentUserUid)
  }

  return auth
    .signOut()
    .then(async () => {
      toast.dismiss()
      toast.success("Logged out")
      await router.push("/enter")
    })
    .catch((error) => handleAuthError(error, "logout"))
}

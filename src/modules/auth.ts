import { router } from "@/modules/router"
import { setDefaultUserData } from "@/queries/setDefaultUserData"
import { updateUserData } from "@/queries/updateUserData"
import type { FirebaseError } from "firebase/app"
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  getAuth,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  type UserCredential,
} from "firebase/auth"
import { toast } from "vue-sonner"

const auth = getAuth()

const actionCodeSettings = {
  url: `${window.location.origin}/enter`,
  handleCodeInApp: true,
}

export const sendAuthenticateEmail = async (email: string) => {
  return sendSignInLinkToEmail(auth, email, actionCodeSettings)
    .then(() => {
      window.localStorage.setItem("emailForSignIn", email)
      toast.success("Authentication email sent")
    })
    .catch((error) => {
      console.error("Error in sendAuthenticateEmail:", error)
      toast.error((error as FirebaseError).message)
      throw error
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

export const authenticateEmail = async () => {
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = window.localStorage.getItem("emailForSignIn")
    if (!email) {
      email = window.prompt("Please provide your email for confirmation")
    }
    if (email) {
      return signInWithEmailLink(auth, email, window.location.href)
        .then(async (result) => {
          window.localStorage.removeItem("emailForSignIn")
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

export const signUpWithEmailPassword = async (
  email: string,
  password: string
) => {
  return createUserWithEmailAndPassword(auth, email, password)
    .then(async (result) => {
      finishAuthentication(result)
    })
    .catch((error) => {
      console.error("Error in signUpWithEmail:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

export const signInWithEmailPassword = async (
  email: string,
  password: string
) => {
  return signInWithEmailAndPassword(auth, email, password)
    .then(async (result) => {
      finishAuthentication(result)
    })
    .catch((error) => {
      console.error("Error in signInWithEmail:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

export const resetEmailPassword = async (email: string) => {
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

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider()
  return signInWithPopup(auth, provider)
    .then(async (result) => {
      finishAuthentication(result)
    })
    .catch((error) => {
      console.error("Error in signInWithGoogle:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

export const signInWithMicrosoft = async () => {
  const provider = new OAuthProvider("microsoft.com")
  return signInWithPopup(auth, provider)
    .then(async (result) => {
      finishAuthentication(result)
    })
    .catch((error) => {
      console.error("Error in signInWithMicrosoft:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

export const signInWithApple = async () => {
  const provider = new OAuthProvider("apple.com")
  return signInWithPopup(auth, provider)
    .then(async (result) => {
      finishAuthentication(result)
    })
    .catch((error) => {
      console.error("Error in signInWithApple:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

export const logout = async () => {
  return auth
    .signOut()
    .then(async () => {
      toast.success("Logged out")
      await router.push("/")
    })
    .catch((error) => {
      console.error("Error in logout:", error)
      toast.error((error as FirebaseError).message)
      throw error
    })
}

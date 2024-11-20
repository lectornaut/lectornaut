import { router } from "@/modules/router"
import { setDefaultUserData } from "@/queries/setDefaultUserData"
import { updateUserData } from "@/queries/updateUserData"
import {
  getAdditionalUserInfo,
  getAuth,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  type UserCredential,
} from "firebase/auth"

const auth = getAuth()

const actionCodeSettings = {
  url: `${window.location.origin}/enter`,
  handleCodeInApp: true,
}

export const sendAuthenticateEmail = async (email: string) => {
  return sendSignInLinkToEmail(auth, email, actionCodeSettings)
    .then(() => {
      window.localStorage.setItem("emailForSignIn", email)
    })
    .catch((error) => {
      console.error("Error in sendAuthenticateEmail:", error)
      throw error
    })
}

const finishAuthentication = async (result: UserCredential) => {
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
          throw error
        })
    }
  }
}

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider()
  return signInWithPopup(auth, provider)
    .then(async (result) => {
      finishAuthentication(result)
    })
    .catch((error) => {
      console.error("Error in signInWithGoogle:", error)
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
      throw error
    })
}

export const logout = async () => {
  return auth
    .signOut()
    .then(async () => {
      await router.push("/")
    })
    .catch((error) => {
      console.error("Error in logout:", error)
      throw error
    })
}

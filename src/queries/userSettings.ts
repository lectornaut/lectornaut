import {
  getUserPreferencesRef,
  getUserRef,
} from "@/utils/firebase/firebase-helpers"
import {
  mutateSetDocument,
  mutateUpdateDocument,
} from "@/utils/firebase/firebase-sync-engine"
import { useCurrentUser } from "vuefire"

const getAuthenticatedUser = () => {
  const user = useCurrentUser()
  const current = user.value
  if (!current) {
    throw new Error("User not authenticated")
  }
  return current
}

export const syncCurrentUserAccountProfile = async (): Promise<void> => {
  const user = getAuthenticatedUser()

  await mutateSetDocument(
    getUserRef(user.uid),
    {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    },
    {
      source: "user.profile.syncAuthMetadata",
      merge: true,
    }
  )
}

export const updateCurrentUserProfileVisibility = async (
  isPublic: boolean
): Promise<void> => {
  const user = getAuthenticatedUser()

  await mutateUpdateDocument(
    getUserRef(user.uid),
    {
      isPublic,
    },
    {
      source: "user.profile.visibility",
    }
  )
}

export const setCurrentUserOnboardingState = async (
  onboarding: boolean
): Promise<void> => {
  const user = getAuthenticatedUser()

  await mutateSetDocument(
    getUserPreferencesRef(user.uid),
    {
      onboarding,
    },
    {
      source: "user.preferences.onboarding",
      merge: true,
    }
  )
}

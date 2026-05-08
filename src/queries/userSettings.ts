import {
  deleteCurrentUserAccountData as deleteCurrentUserAccountDataCallable,
  syncCurrentUserAccountProfileCallable,
  updateUserProfileVisibility,
} from "@/composables/useFunctions"
import { getUserPreferencesRef } from "@/utils/firebase/firebase-helpers"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
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
  getAuthenticatedUser()
  await syncCurrentUserAccountProfileCallable({})
}

export const updateCurrentUserProfileVisibility = async (
  isPublic: boolean
): Promise<void> => {
  getAuthenticatedUser()
  await updateUserProfileVisibility({ isPublic })
}

export const deleteCurrentUserAccountData = async (): Promise<void> => {
  getAuthenticatedUser()
  await deleteCurrentUserAccountDataCallable({})
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

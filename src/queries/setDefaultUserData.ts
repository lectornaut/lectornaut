import {
  defaultAccent,
  defaultBase,
  defaultCustomAccentColor,
  defaultCustomBaseColor,
  defaultFont,
  defaultLanguage,
  defaultSize,
  defaultTheme,
} from "@/helpers/defaults"
import { firestore } from "@/modules/firebase"
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/types/notifications"
import {
  getUserPreferencesRef,
  getUserRef,
} from "@/utils/firebase/firebase-helpers"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { doc } from "firebase/firestore"
import { useCurrentUser } from "vuefire"

export const setDefaultUserData = async (): Promise<void> => {
  const user = useCurrentUser()
  const uid = user.value?.uid
  if (!uid) return

  const userDocRef = getUserRef(uid)
  const userPreferencesDocRef = getUserPreferencesRef(uid)
  const notificationSettingsDocRef = doc(
    firestore,
    "users",
    uid,
    "settings",
    "notifications"
  )
  const themesDocRef = doc(firestore, "users", uid, "settings", "themes")

  await Promise.all([
    mutateSetDocument(
      userDocRef,
      {
        uid,
        email: user.value?.email,
        displayName: user.value?.displayName,
        photoURL: user.value?.photoURL,
        username: null,
        isPublic: false,
      },
      { source: "user.setDefaultUserData", merge: true }
    ),
    mutateSetDocument(
      userPreferencesDocRef,
      {
        currentTeamId: null,
        onboarding: true,
      },
      {
        source: "user.preferences.setDefault",
        merge: true,
      }
    ),
    mutateSetDocument(
      notificationSettingsDocRef,
      DEFAULT_NOTIFICATION_SETTINGS as unknown as Record<string, unknown>,
      {
        source: "settings.notifications.setDefault",
        merge: true,
      }
    ),
    mutateSetDocument(
      themesDocRef,
      {
        mode: defaultTheme,
        base: defaultBase,
        accent: defaultAccent,
        customBaseColor: defaultCustomBaseColor,
        customAccentColor: defaultCustomAccentColor,
        font: defaultFont,
        size: defaultSize,
        language: defaultLanguage,
      },
      {
        source: "settings.themes.setDefault",
        merge: true,
      }
    ),
  ])
}

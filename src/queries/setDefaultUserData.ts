import {
  defaultAccent,
  defaultBase,
  defaultFont,
  defaultLanguage,
  defaultSize,
} from "@/helpers/defaults"
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/types/notifications"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { doc } from "firebase/firestore"
import { useCurrentUser, useFirestore } from "vuefire"

export const setDefaultUserData = async (): Promise<void> => {
  const db = useFirestore()
  const user = useCurrentUser()
  const uid = user.value?.uid
  if (!uid) return

  const userDocRef = doc(db, "users", uid)
  const notificationSettingsDocRef = doc(
    db,
    "users",
    uid,
    "settings",
    "notifications"
  )
  const themesDocRef = doc(db, "users", uid, "settings", "themes")

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
        onboarding: true,
      },
      { source: "user.setDefaultUserData", merge: true }
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
        mode: "auto",
        base: defaultBase,
        accent: defaultAccent,
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

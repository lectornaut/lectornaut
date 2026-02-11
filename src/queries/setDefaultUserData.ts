import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { collection, doc } from "firebase/firestore"
import { useCurrentUser, useFirestore } from "vuefire"

export const setDefaultUserData = async (): Promise<void> => {
  const db = useFirestore()
  const user = useCurrentUser()
  const uid = user.value?.uid
  if (!uid) return

  await mutateSetDocument(
    doc(collection(db, "users"), uid),
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
  )
}

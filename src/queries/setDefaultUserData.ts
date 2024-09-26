import { Timestamp, collection, doc, setDoc } from "firebase/firestore"
import { useCurrentUser, useFirestore } from "vuefire"

export const setDefaultUserData = () => {
  const db = useFirestore()
  const user = useCurrentUser()

  setDoc(
    doc(collection(db, "users"), user.value?.uid),
    {
      displayName: user.value?.displayName,
      email: user.value?.email,
      createdAt: Timestamp.now(),
      accounts: [user.value?.email],
      uid: user.value?.uid,
      onboarding: true,
    },
    {
      merge: true,
    }
  )
}

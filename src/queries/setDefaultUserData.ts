import { Timestamp, collection, doc, setDoc } from "firebase/firestore"
import { useCurrentUser, useFirestore } from "vuefire"

export const setDefaultUserData = () => {
  const db = useFirestore()
  const user = useCurrentUser()

  setDoc(
    doc(collection(db, "users"), user.value?.uid),
    {
      uid: user.value?.uid,
      email: user.value?.email,
      displayName: user.value?.displayName,
      photoURL: user.value?.photoURL,
      username: null,
      isPublic: false,
      onboarding: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    {
      merge: true,
    }
  )
}

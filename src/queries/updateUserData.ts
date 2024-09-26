import { Timestamp, collection, doc, setDoc } from "firebase/firestore"
import { useCurrentUser, useFirestore } from "vuefire"

export const updateUserData = () => {
  const db = useFirestore()
  const user = useCurrentUser()

  setDoc(
    doc(collection(db, "users"), user.value?.uid),
    {
      displayName: user.value?.displayName,
      email: user.value?.email,
      updatedAt: Timestamp.now(),
      uid: user.value?.uid,
    },
    {
      merge: true,
    }
  )
}

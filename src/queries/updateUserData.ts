import {
  type DocumentData,
  Timestamp,
  collection,
  doc,
  setDoc,
} from "firebase/firestore"
import { useCurrentUser, useFirestore } from "vuefire"

export const updateUserData = (data?: Partial<DocumentData>) => {
  const db = useFirestore()
  const user = useCurrentUser()

  setDoc(
    doc(collection(db, "users"), user.value?.uid),
    {
      displayName: user.value?.displayName,
      email: user.value?.email,
      updatedAt: Timestamp.now(),
      uid: user.value?.uid,
      ...data,
    },
    {
      merge: true,
    }
  )
}

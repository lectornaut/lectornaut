import {
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "firebase/firestore"
import { useCurrentUser, useFirestore } from "vuefire"

export const updateUserData = async (data?: Partial<DocumentData>) => {
  const db = useFirestore()
  const user = useCurrentUser()

  return await updateDoc(doc(collection(db, "users"), user.value?.uid), {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

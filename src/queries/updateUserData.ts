import { mutateUpdateDocument } from "@/utils/firebase/firebase-sync-engine"
import { collection, doc, type DocumentData } from "firebase/firestore"
import { useCurrentUser, useFirestore } from "vuefire"

export const updateUserData = async (data?: Partial<DocumentData>) => {
  const db = useFirestore()
  const user = useCurrentUser()
  const uid = user.value?.uid
  if (!uid) return

  await mutateUpdateDocument(
    doc(collection(db, "users"), uid),
    (data ?? {}) as Record<string, unknown>,
    {
      source: "user.updateUserData",
    }
  )
}

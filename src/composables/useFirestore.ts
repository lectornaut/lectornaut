import type { FirebaseError } from "firebase/app"
import {
  addDoc,
  CollectionReference,
  deleteDoc,
  doc,
  updateDoc,
} from "firebase/firestore"
import { toast } from "vue-sonner"

export async function useAddDoc(colRef: CollectionReference, document: object) {
  try {
    await addDoc(colRef, document)
    toast.success("Added")
  } catch (error: FirebaseError | unknown) {
    toast.error((error as FirebaseError).message)
  }
}

export async function useDeleteDoc(
  colRef: CollectionReference,
  id: string,
  prevDoc: object
) {
  try {
    await deleteDoc(doc(colRef, id))
    toast.success("Deleted", {
      action: {
        label: "Undo",
        onClick: async () => {
          if (prevDoc) {
            await addDoc(colRef, prevDoc)
            toast.success("Restored")
          }
        },
      },
    })
  } catch (error: FirebaseError | unknown) {
    toast.error((error as FirebaseError).message)
  }
}

export async function useUpdateDoc(
  colRef: CollectionReference,
  id: string,
  document: object,
  prevDoc: object
) {
  try {
    await updateDoc(doc(colRef, id), document)
    toast.success("Updated", {
      action: {
        label: "Undo",
        onClick: async () => {
          if (prevDoc) {
            await updateDoc(doc(colRef, id), prevDoc)
            toast.success("Reverted")
          }
        },
      },
    })
  } catch (error: FirebaseError | unknown) {
    toast.error((error as FirebaseError).message)
  }
}

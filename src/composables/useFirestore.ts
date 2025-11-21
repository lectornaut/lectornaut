import type { FirebaseError } from "firebase/app"
import {
  addDoc,
  CollectionReference,
  deleteDoc,
  doc,
  type DocumentData,
  setDoc,
  updateDoc,
} from "firebase/firestore"
import { toast } from "vue-sonner"

export async function useAddDoc<T extends { id?: string }>(
  colRef: CollectionReference,
  document: T
) {
  try {
    if (document.id) {
      await setDoc(doc(colRef, document.id), document as DocumentData)
    } else {
      await addDoc(colRef, document as DocumentData)
    }
    toast.success("Added")
  } catch (error) {
    console.error("Error in useAddDoc:", error)
    toast.error((error as FirebaseError).message)
  }
}

export async function useDeleteDoc<T extends { id: string }>(
  colRef: CollectionReference,
  id: string,
  prevDoc: T
) {
  try {
    await deleteDoc(doc(colRef, id))
    toast.success("Deleted", {
      action: {
        label: "Undo",
        onClick: async () => {
          if (prevDoc) {
            await setDoc(doc(colRef, id), prevDoc as DocumentData)
            toast.success("Restored")
          }
        },
      },
    })
  } catch (error) {
    console.error("Error in useDeleteDoc", error)
    toast.error((error as FirebaseError).message)
  }
}

export async function useUpdateDoc<T extends { id: string }>(
  colRef: CollectionReference,
  id: string,
  document: Partial<T>,
  prevDoc: T
) {
  try {
    await updateDoc(doc(colRef, id), document as DocumentData)
    toast.success("Updated", {
      action: {
        label: "Undo",
        onClick: async () => {
          if (prevDoc) {
            await updateDoc(doc(colRef, id), prevDoc as DocumentData)
            toast.success("Reverted")
          }
        },
      },
    })
  } catch (error) {
    console.error("Error in useUpdateDoc", error)
    toast.error((error as FirebaseError).message)
  }
}

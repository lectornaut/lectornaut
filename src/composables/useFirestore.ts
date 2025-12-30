/**
 * Firestore CRUD Operations with Optimistic Update Support
 *
 * These functions are designed to be called from Pinia store actions only.
 * Components should never call these directly - use store actions instead.
 *
 * Optimistic updates are handled in the store layer, not here.
 * These functions focus on the Firestore operations and error handling.
 */

import type { FirebaseError } from "firebase/app"
import {
  addDoc,
  CollectionReference,
  deleteDoc,
  doc,
  type DocumentData,
  type DocumentReference,
  setDoc,
  updateDoc,
} from "firebase/firestore"
import { toast } from "vue-sonner"

/**
 * Options for Firestore operations
 */
export interface FirestoreOperationOptions {
  /** Whether to show success toast */
  showSuccessToast?: boolean
  /** Whether to show error toast */
  showErrorToast?: boolean
  /** Custom success message */
  successMessage?: string
  /** Custom error message */
  errorMessage?: string
  /** Undo callback for delete/update operations */
  onUndo?: () => Promise<void>
}

const defaultOptions: FirestoreOperationOptions = {
  showSuccessToast: true,
  showErrorToast: true,
}

/**
 * Add or set a document in Firestore
 * Returns the document reference on success
 *
 * @throws {FirebaseError} Re-throws Firestore errors after handling
 */
export async function firestoreAddDoc<T extends { id?: string }>(
  colRef: CollectionReference,
  document: T,
  options: FirestoreOperationOptions = {}
): Promise<DocumentReference> {
  const opts = { ...defaultOptions, ...options }

  try {
    let docRef: DocumentReference

    if (document.id) {
      docRef = doc(colRef, document.id)
      await setDoc(docRef, document as DocumentData)
    } else {
      docRef = await addDoc(colRef, document as DocumentData)
    }

    if (opts.showSuccessToast) {
      toast.success(opts.successMessage ?? "Added")
    }

    return docRef
  } catch (error) {
    console.error("Error in firestoreAddDoc:", error)

    if (opts.showErrorToast) {
      toast.error(opts.errorMessage ?? (error as FirebaseError).message)
    }

    throw error
  }
}

/**
 * Set a document in Firestore (create or overwrite)
 * Use this when you have a specific document ID
 *
 * @throws {FirebaseError} Re-throws Firestore errors after handling
 */
export async function firestoreSetDoc<T extends { id: string }>(
  colRef: CollectionReference,
  id: string,
  document: T,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  const opts = { ...defaultOptions, ...options }

  try {
    await setDoc(doc(colRef, id), document as DocumentData)

    if (opts.showSuccessToast) {
      toast.success(opts.successMessage ?? "Saved")
    }
  } catch (error) {
    console.error("Error in firestoreSetDoc:", error)

    if (opts.showErrorToast) {
      toast.error(opts.errorMessage ?? (error as FirebaseError).message)
    }

    throw error
  }
}

/**
 * Delete a document from Firestore
 *
 * @throws {FirebaseError} Re-throws Firestore errors after handling
 */
export async function firestoreDeleteDoc(
  colRef: CollectionReference,
  id: string,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  const opts = { ...defaultOptions, ...options }

  try {
    await deleteDoc(doc(colRef, id))

    if (opts.showSuccessToast) {
      if (opts.onUndo) {
        toast.success(opts.successMessage ?? "Deleted", {
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await opts.onUndo!()
                toast.success("Restored")
              } catch (undoError) {
                console.error("Error restoring document:", undoError)
                toast.error("Failed to restore")
              }
            },
          },
        })
      } else {
        toast.success(opts.successMessage ?? "Deleted")
      }
    }
  } catch (error) {
    console.error("Error in firestoreDeleteDoc:", error)

    if (opts.showErrorToast) {
      toast.error(opts.errorMessage ?? (error as FirebaseError).message)
    }

    throw error
  }
}

/**
 * Update a document in Firestore
 *
 * @throws {FirebaseError} Re-throws Firestore errors after handling
 */
export async function firestoreUpdateDoc<T extends { id: string }>(
  colRef: CollectionReference,
  id: string,
  updates: Partial<T>,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  const opts = { ...defaultOptions, ...options }

  try {
    await updateDoc(doc(colRef, id), updates as DocumentData)

    if (opts.showSuccessToast) {
      if (opts.onUndo) {
        toast.success(opts.successMessage ?? "Updated", {
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await opts.onUndo!()
                toast.success("Reverted")
              } catch (undoError) {
                console.error("Error reverting document:", undoError)
                toast.error("Failed to revert")
              }
            },
          },
        })
      } else {
        toast.success(opts.successMessage ?? "Updated")
      }
    }
  } catch (error) {
    console.error("Error in firestoreUpdateDoc:", error)

    if (opts.showErrorToast) {
      toast.error(opts.errorMessage ?? (error as FirebaseError).message)
    }

    throw error
  }
}

/**
 * Firestore CRUD Operations with Optimistic Update Support
 *
 * Designed for Pinia store actions only. Components should use store actions.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Configurable toast notifications via shared toast-helpers
 * - Undo support for destructive operations
 * - Type-safe error handling
 */

import {
  getFirestoreErrorMessage,
  isRetryableFirebaseError,
} from "@/utils/firebase-errors"
import { getBackoffDelay, sleep } from "@/utils/firebase-optimistic"
import { showErrorToast, showSuccessToast } from "@/utils/toast-helpers"
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

/** Options for Firestore operations */
export interface FirestoreOperationOptions {
  showSuccessToast?: boolean
  showErrorToast?: boolean
  successMessage?: string
  errorMessage?: string
  /** Undo callback for delete/update operations */
  onUndo?: () => Promise<void>
  maxRetries?: number
  retryBaseDelay?: number
}

const defaultOptions: FirestoreOperationOptions = {
  showSuccessToast: true,
  showErrorToast: true,
  maxRetries: 0,
  retryBaseDelay: 1000,
}

/** Execute an operation with retry logic */
async function withRetry<T>(
  operation: () => Promise<T>,
  options: Pick<FirestoreOperationOptions, "maxRetries" | "retryBaseDelay">
): Promise<T> {
  const { maxRetries = 0, retryBaseDelay = 1000 } = options
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      if (!isRetryableFirebaseError(error) || attempt >= maxRetries) {
        throw error
      }
      const delay = getBackoffDelay(attempt, retryBaseDelay)
      console.warn(
        `Firestore operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms`
      )
      await sleep(delay)
    }
  }

  throw lastError
}

/** Add or set a document in Firestore */
export async function firestoreAddDoc<T extends { id?: string }>(
  colRef: CollectionReference,
  document: T,
  options: FirestoreOperationOptions = {}
): Promise<DocumentReference> {
  const opts = { ...defaultOptions, ...options }

  try {
    const docRef = await withRetry(async () => {
      let ref: DocumentReference
      if (document.id) {
        ref = doc(colRef, document.id)
        await setDoc(ref, document as DocumentData)
      } else {
        ref = await addDoc(colRef, document as DocumentData)
      }
      return ref
    }, opts)

    if (opts.showSuccessToast) {
      showSuccessToast(opts.successMessage ?? "Added")
    }

    return docRef
  } catch (error) {
    console.error("Error in firestoreAddDoc:", error)
    if (opts.showErrorToast) {
      showErrorToast(opts.errorMessage ?? getFirestoreErrorMessage(error))
    }
    throw error
  }
}

/** Set a document in Firestore (create or overwrite) */
export async function firestoreSetDoc<T extends { id: string }>(
  colRef: CollectionReference,
  id: string,
  document: T,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  const opts = { ...defaultOptions, ...options }

  try {
    await withRetry(
      () => setDoc(doc(colRef, id), document as DocumentData),
      opts
    )

    if (opts.showSuccessToast) {
      showSuccessToast(opts.successMessage ?? "Saved")
    }
  } catch (error) {
    console.error("Error in firestoreSetDoc:", error)
    if (opts.showErrorToast) {
      showErrorToast(opts.errorMessage ?? getFirestoreErrorMessage(error))
    }
    throw error
  }
}

/** Delete a document from Firestore */
export async function firestoreDeleteDoc(
  colRef: CollectionReference,
  id: string,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  const opts = { ...defaultOptions, ...options }

  try {
    await withRetry(() => deleteDoc(doc(colRef, id)), opts)

    if (opts.showSuccessToast) {
      showSuccessToast(opts.successMessage ?? "Deleted", {
        onUndo: opts.onUndo,
      })
    }
  } catch (error) {
    console.error("Error in firestoreDeleteDoc:", error)
    if (opts.showErrorToast) {
      showErrorToast(opts.errorMessage ?? getFirestoreErrorMessage(error))
    }
    throw error
  }
}

/** Update a document in Firestore */
export async function firestoreUpdateDoc<T extends { id: string }>(
  colRef: CollectionReference,
  id: string,
  updates: Partial<T>,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  const opts = { ...defaultOptions, ...options }

  try {
    await withRetry(
      () => updateDoc(doc(colRef, id), updates as DocumentData),
      opts
    )

    if (opts.showSuccessToast) {
      showSuccessToast(opts.successMessage ?? "Updated", {
        onUndo: opts.onUndo,
      })
    }
  } catch (error) {
    console.error("Error in firestoreUpdateDoc:", error)
    if (opts.showErrorToast) {
      showErrorToast(opts.errorMessage ?? getFirestoreErrorMessage(error))
    }
    throw error
  }
}

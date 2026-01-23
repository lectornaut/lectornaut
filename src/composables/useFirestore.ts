/**
 * Firestore CRUD Operations with Optimistic Update Support
 *
 * These functions are designed to be called from Pinia store actions only.
 * Components should never call these directly - use store actions instead.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Configurable toast notifications
 * - Undo support for destructive operations
 * - Type-safe error handling
 * - User-friendly error messages
 *
 * Optimistic updates are handled in the store layer, not here.
 * These functions focus on the Firestore operations and error handling.
 */

import {
  getFirestoreErrorMessage,
  isRetryableFirebaseError,
} from "@/utils/firebase-errors"
import { getBackoffDelay, sleep } from "@/utils/firebase-optimistic"
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

// ============================================================================
// Types
// ============================================================================

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
  /** Number of retry attempts (default: 0) */
  maxRetries?: number
  /** Base delay for retry backoff in ms (default: 1000) */
  retryBaseDelay?: number
}

const defaultOptions: FirestoreOperationOptions = {
  showSuccessToast: true,
  showErrorToast: true,
  maxRetries: 0,
  retryBaseDelay: 1000,
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Execute an operation with retry logic
 */
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

      // Don't retry non-retryable errors or on final attempt
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

// ============================================================================
// CRUD Operations
// ============================================================================

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
      toast.success(opts.successMessage ?? "Added")
    }

    return docRef
  } catch (error) {
    console.error("Error in firestoreAddDoc:", error)

    if (opts.showErrorToast) {
      toast.error(opts.errorMessage ?? getFirestoreErrorMessage(error))
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
    await withRetry(
      () => setDoc(doc(colRef, id), document as DocumentData),
      opts
    )

    if (opts.showSuccessToast) {
      toast.success(opts.successMessage ?? "Saved")
    }
  } catch (error) {
    console.error("Error in firestoreSetDoc:", error)

    if (opts.showErrorToast) {
      toast.error(opts.errorMessage ?? getFirestoreErrorMessage(error))
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
    await withRetry(() => deleteDoc(doc(colRef, id)), opts)

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
      toast.error(opts.errorMessage ?? getFirestoreErrorMessage(error))
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
    await withRetry(
      () => updateDoc(doc(colRef, id), updates as DocumentData),
      opts
    )

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
      toast.error(opts.errorMessage ?? getFirestoreErrorMessage(error))
    }

    throw error
  }
}

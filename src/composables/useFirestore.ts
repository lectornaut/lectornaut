/**
 * Firestore CRUD Operations with Optimistic Update Support
 *
 * Designed for Pinia store actions only. Components should use store actions.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Configurable toast notifications via shared toast
 * - Undo support for destructive operations
 * - Type-safe error handling
 */

import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import {
  getFirestoreErrorMessage,
  isRetryableFirebaseError,
} from "@/utils/firebase/firebase-errors"
import { getBackoffDelay, sleep } from "@/utils/firebase/firebase-optimistic"
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

interface FirestoreExecutionOptions {
  operationName: string
  defaultSuccessMessage: string
  options: FirestoreOperationOptions
  successToast?: {
    onUndo?: () => Promise<void>
  }
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

async function executeFirestoreOperation<T>(
  operation: () => Promise<T>,
  executionOptions: FirestoreExecutionOptions
): Promise<T> {
  const opts = { ...defaultOptions, ...executionOptions.options }

  try {
    const result = await withRetry(operation, opts)

    if (opts.showSuccessToast) {
      showSuccessToast(
        opts.successMessage ?? executionOptions.defaultSuccessMessage,
        executionOptions.successToast
      )
    }

    return result
  } catch (error) {
    console.error(`Error in ${executionOptions.operationName}:`, error)
    if (opts.showErrorToast) {
      showErrorToast(opts.errorMessage ?? getFirestoreErrorMessage(error))
    }
    throw error
  }
}

/** Add or set a document in Firestore */
export async function firestoreAddDoc<T extends { id?: string }>(
  colRef: CollectionReference,
  document: T,
  options: FirestoreOperationOptions = {}
): Promise<DocumentReference> {
  return executeFirestoreOperation(
    async () => {
      let ref: DocumentReference
      if (document.id) {
        ref = doc(colRef, document.id)
        await setDoc(ref, document as DocumentData)
      } else {
        ref = await addDoc(colRef, document as DocumentData)
      }
      return ref
    },
    {
      operationName: "firestoreAddDoc",
      defaultSuccessMessage: "Added",
      options,
    }
  )
}

/** Set a document in Firestore (create or overwrite) */
export async function firestoreSetDoc<T extends { id: string }>(
  colRef: CollectionReference,
  id: string,
  document: T,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  await executeFirestoreOperation(
    () => setDoc(doc(colRef, id), document as DocumentData),
    {
      operationName: "firestoreSetDoc",
      defaultSuccessMessage: "Saved",
      options,
    }
  )
}

/** Delete a document from Firestore */
export async function firestoreDeleteDoc(
  colRef: CollectionReference,
  id: string,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  await executeFirestoreOperation(() => deleteDoc(doc(colRef, id)), {
    operationName: "firestoreDeleteDoc",
    defaultSuccessMessage: "Deleted",
    options,
    successToast: {
      onUndo: options.onUndo,
    },
  })
}

/** Update a document in Firestore */
export async function firestoreUpdateDoc<T extends { id: string }>(
  colRef: CollectionReference,
  id: string,
  updates: Partial<T>,
  options: FirestoreOperationOptions = {}
): Promise<void> {
  await executeFirestoreOperation(
    () => updateDoc(doc(colRef, id), updates as DocumentData),
    {
      operationName: "firestoreUpdateDoc",
      defaultSuccessMessage: "Updated",
      options,
      successToast: {
        onUndo: options.onUndo,
      },
    }
  )
}

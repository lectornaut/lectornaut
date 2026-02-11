/**
 * Shared Firebase Admin Initialization
 *
 * Single point of initialization for firebase-admin SDK.
 * All modules should import `db` and `auth` from here
 * instead of initializing their own instances.
 */

import admin from "firebase-admin"

if (!admin.apps.length) {
  admin.initializeApp()
}

/** Firestore database instance (singleton) */
export const db = admin.firestore()

/** Firebase Auth instance (singleton) */
export const auth = admin.auth()

/** Re-export admin for FieldValue, Timestamp, etc. */
export { admin }

/**
 * Shared Firebase Admin Initialization
 *
 * Single point of initialization for the firebase-admin SDK (modular API,
 * v14+). All modules import `db` and `auth` from here instead of initializing
 * their own instances. Firestore value helpers (`FieldValue`, `Timestamp`,
 * `FieldPath`) and types (`Transaction`, `DocumentReference`, ...) are imported
 * directly from `firebase-admin/firestore` at each call site — the v14 root
 * export no longer carries the legacy `admin.firestore.*` namespace.
 */

import { getApps, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"

if (!getApps().length) {
  initializeApp()
}

/** Firestore database instance (singleton) */
export const db = getFirestore()

/** Firebase Auth instance (singleton) */
export const auth = getAuth()

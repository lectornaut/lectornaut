/**
 * Auth Store - Authentication and User Profile Management
 *
 * Handles:
 * - Firebase authentication state (via VueFire)
 * - User profile CRUD with optimistic updates
 * - Auth state listeners
 *
 * Uses VueFire composables for reactive Firestore bindings
 */

import { firestore, storage } from "@/modules/firebase"
import type { IUser } from "@/types"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/optimistic"
import type { User } from "firebase/auth"
import {
  collectionGroup,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from "firebase/firestore"
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage"
import { defineStore } from "pinia"
import { updateCurrentUserProfile, useCurrentUser, useDocument } from "vuefire"

// Constants
const BATCH_SIZE = 450

// Helper to get document references
const getUserRef = (userId: string) => doc(firestore, "users", userId)

// Helper to process Firestore batch operations in chunks
async function processInBatches<T>(
  items: T[],
  processFn: (item: T, batch: ReturnType<typeof writeBatch>) => void
) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(firestore)
    chunk.forEach((item) => processFn(item, batch))
    await batch.commit()
  }
}

// Helper to update all memberships with new data
async function updateMemberships(
  queryRef: ReturnType<typeof query>,
  updateFn: (membershipData: Record<string, unknown>) => Record<string, unknown>
) {
  const membershipDocs = await getDocs(queryRef)
  await processInBatches(membershipDocs.docs, (docSnap, batch) => {
    const membershipData = docSnap.data() as Record<string, unknown>
    batch.update(docSnap.ref, {
      ...updateFn(membershipData),
      updatedAt: serverTimestamp(),
    })
  })
}

export const useAuthStore = defineStore("auth", () => {
  // ============================================================================
  // VueFire Reactive Bindings
  // ============================================================================

  // Auth state from VueFire - automatically syncs with Firebase Auth
  // Type assertion to break VueFire internal type chain
  const currentUser = useCurrentUser() as Ref<User | null>

  // Computed document reference - null when not authenticated
  const userDocRef = computed(() =>
    currentUser.value ? getUserRef(currentUser.value.uid) : null
  )

  // VueFire reactive document binding for user profile
  // Use intermediate variables with type assertions to isolate VueFire types
  const _vuefireUserDoc = useDocument<IUser>(userDocRef)
  const firestoreUserProfile: ComputedRef<IUser | null | undefined> = computed(
    () => _vuefireUserDoc.data.value
  )
  const isFirestoreLoading: ComputedRef<boolean> = computed(
    () => _vuefireUserDoc.pending.value
  )

  // ============================================================================
  // State (for optimistic updates)
  // ============================================================================

  // Local user profile that can be optimistically updated
  // Falls back to Firestore data when no pending operations
  const optimisticUserProfile = ref<IUser | null>(null)

  // Pending operation tracking
  const pendingUserIds = shallowRef(createPendingSet())

  // ============================================================================
  // Computed
  // ============================================================================

  // Merged user profile: optimistic updates take precedence when pending
  const userProfile = computed({
    get: () => {
      if (
        currentUser.value &&
        pendingUserIds.value.has(currentUser.value.uid)
      ) {
        return optimisticUserProfile.value
      }
      return firestoreUserProfile.value ?? optimisticUserProfile.value
    },
    set: (value) => {
      optimisticUserProfile.value = value
    },
  })

  const isLoading = computed(
    () => isFirestoreLoading.value && !optimisticUserProfile.value
  )

  const isUserPending = computed(
    () => (id: string) => pendingUserIds.value.has(id)
  )

  const hasAnyPendingOperation = computed(() => pendingUserIds.value.size > 0)

  const isAuthenticated = computed(() => !!currentUser.value)

  // ============================================================================
  // Auto-create User Profile
  // ============================================================================

  // Watch for new users and create their profile if it doesn't exist
  watch(
    [currentUser, firestoreUserProfile, isFirestoreLoading],
    async ([user, profile, loading]) => {
      if (!user || loading) return

      // User exists but no profile - create one
      if (!profile) {
        const userRef = getUserRef(user.uid)
        const newUser: IUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          currentTeamId: null,
          createdAt: serverTimestamp() as Timestamp,
          updatedAt: serverTimestamp() as Timestamp,
        }
        await setDoc(userRef, newUser)
        // Set optimistic profile immediately
        optimisticUserProfile.value = newUser
      }
    },
    { immediate: true }
  )

  // Sync optimistic profile with Firestore data when not pending
  watch(
    firestoreUserProfile,
    (profile) => {
      if (
        profile &&
        currentUser.value &&
        !pendingUserIds.value.has(currentUser.value.uid)
      ) {
        optimisticUserProfile.value = profile
      }
    },
    { immediate: true }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    optimisticUserProfile.value = null
    // VueFire handles subscription cleanup automatically
  }

  // Watch for logout to cleanup
  watch(currentUser, (user) => {
    if (!user) {
      cleanup()
    }
  })

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Update the current team ID for the user
   * Used by teamStore when switching/creating teams
   */
  async function setCurrentTeamId(teamId: string | null): Promise<void> {
    if (!currentUser.value || !userProfile.value) return

    const previousUserProfile = cloneState(userProfile.value)

    await withOptimisticUpdate(
      pendingUserIds.value,
      currentUser.value.uid,
      // Apply optimistic update
      () => {
        optimisticUserProfile.value = {
          ...userProfile.value!,
          currentTeamId: teamId,
        }
      },
      // Rollback on error
      () => {
        optimisticUserProfile.value = previousUserProfile
      },
      // Firestore operation
      async () => {
        await updateDoc(getUserRef(currentUser.value!.uid), {
          currentTeamId: teamId,
          updatedAt: serverTimestamp(),
        })
      }
    )
  }

  /**
   * Update user profile with optimistic update
   */
  async function updateUserProfile(updates: Partial<IUser>): Promise<void> {
    if (!currentUser.value || !userProfile.value) return

    const { photoURL, ...userUpdates } = updates
    const userRef = getUserRef(currentUser.value.uid)

    // Normalize photoURL
    const normalizedPhotoURL =
      photoURL === "" || photoURL === null ? null : photoURL

    // Clone previous state for rollback
    const previousUserProfile = cloneState(userProfile.value)

    await withOptimisticUpdate(
      pendingUserIds.value,
      currentUser.value.uid,
      // Apply optimistic update
      () => {
        optimisticUserProfile.value = {
          ...userProfile.value!,
          ...userUpdates,
          ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
        }
      },
      // Rollback on error
      () => {
        optimisticUserProfile.value = previousUserProfile
      },
      // Firestore operation
      async () => {
        // Update Auth Profile if needed
        if (photoURL !== undefined || userUpdates.displayName !== undefined) {
          const authPhotoURL =
            photoURL === "" || photoURL === null
              ? ""
              : (photoURL ?? currentUser.value!.photoURL ?? undefined)

          await updateCurrentUserProfile({
            displayName:
              userUpdates.displayName ||
              currentUser.value!.displayName ||
              undefined,
            photoURL: authPhotoURL,
          })
        }

        // Update User Document
        if (Object.keys(userUpdates).length > 0 || photoURL !== undefined) {
          await updateDoc(userRef, {
            ...userUpdates,
            ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
            updatedAt: serverTimestamp(),
          })
        }

        // Update all memberships with new user data
        const membershipsQuery = query(
          collectionGroup(firestore, "memberships"),
          where("userId", "==", currentUser.value!.uid)
        )

        await updateMemberships(membershipsQuery, (membershipData) => {
          const existingUser =
            (membershipData.user as Record<string, unknown>) || {}
          return {
            user: {
              ...existingUser,
              ...userUpdates,
              ...(photoURL !== undefined
                ? { photoURL: normalizedPhotoURL }
                : {}),
            },
          }
        })
      }
    )
  }

  /**
   * Upload user profile photo
   */
  async function uploadProfilePhoto(file: File): Promise<string> {
    if (!currentUser.value) throw new Error("Not authenticated")

    const fileRef = storageRef(
      storage,
      `users/${currentUser.value.uid}/profilePhoto`
    )
    await uploadBytes(fileRef, file)
    return await getDownloadURL(fileRef)
  }

  return {
    // State
    currentUser,
    userProfile,
    isLoading,

    // Pending state
    pendingUserIds,

    // Computed
    isUserPending,
    hasAnyPendingOperation,
    isAuthenticated,

    // Actions
    setCurrentTeamId,
    updateUserProfile,
    uploadProfilePhoto,

    // Lifecycle
    cleanup,
  }
})

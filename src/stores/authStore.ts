/**
 * Auth Store - Authentication and User Profile Management
 *
 * Handles:
 * - Firebase authentication state
 * - User profile CRUD with optimistic updates
 * - Auth state listeners
 */

import { auth, firestore, storage } from "@/modules/firebase"
import type { IUser } from "@/types"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/optimistic"
import { onAuthStateChanged, type User } from "firebase/auth"
import {
  collectionGroup,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore"
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage"
import { defineStore } from "pinia"
import { computed, ref, shallowRef, watch } from "vue"
import { updateCurrentUserProfile } from "vuefire"

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
  // State
  // ============================================================================

  const currentUser = ref<User | null>(null)
  const userProfile = ref<IUser | null>(null)
  const isLoading = ref(true)

  // Pending operation tracking
  const pendingUserIds = shallowRef(createPendingSet())

  // Subscription cleanup function
  let userUnsubscribe: (() => void) | null = null

  // ============================================================================
  // Computed
  // ============================================================================

  const isUserPending = computed(
    () => (id: string) => pendingUserIds.value.has(id)
  )

  const hasAnyPendingOperation = computed(() => pendingUserIds.value.size > 0)

  const isAuthenticated = computed(() => !!currentUser.value)

  // ============================================================================
  // Auth Listener
  // ============================================================================

  onAuthStateChanged(auth, (user) => {
    currentUser.value = user
    if (!user) {
      cleanup()
      isLoading.value = false
    }
  })

  // ============================================================================
  // User Profile Snapshot Listener
  // ============================================================================

  watch(
    currentUser,
    async (user) => {
      if (userUnsubscribe) {
        userUnsubscribe()
        userUnsubscribe = null
      }

      if (!user) return

      isLoading.value = true
      const userRef = getUserRef(user.uid)

      userUnsubscribe = onSnapshot(userRef, async (userSnap) => {
        // Skip snapshot update if user has pending operations
        if (pendingUserIds.value.has(user.uid)) {
          isLoading.value = false
          return
        }

        if (userSnap.exists()) {
          userProfile.value = userSnap.data() as IUser
          if (!userProfile.value.currentTeamId) {
            isLoading.value = false
          }
        } else {
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
          userProfile.value = newUser
          isLoading.value = false
        }
      })
    },
    { immediate: true }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    userProfile.value = null
    if (userUnsubscribe) {
      userUnsubscribe()
      userUnsubscribe = null
    }
  }

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
        userProfile.value = { ...userProfile.value!, currentTeamId: teamId }
      },
      // Rollback on error
      () => {
        userProfile.value = previousUserProfile
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
        userProfile.value = {
          ...userProfile.value!,
          ...userUpdates,
          ...(photoURL !== undefined ? { photoURL: normalizedPhotoURL } : {}),
        }
      },
      // Rollback on error
      () => {
        userProfile.value = previousUserProfile
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

  /**
   * Mark loading as complete (used by other stores after team loads)
   */
  function setLoadingComplete() {
    isLoading.value = false
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
    setLoadingComplete,

    // Lifecycle
    cleanup,
  }
})

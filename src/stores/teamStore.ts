/**
 * Team Store - Team CRUD Operations
 *
 * Handles:
 * - Team creation, update, deletion
 * - Current team selection and switching
 * - Team photo management
 *
 * Dependencies:
 * - authStore: User authentication and profile
 * - membershipStore: Team memberships and members
 *
 * Uses VueFire composables for reactive Firestore bindings
 */

import { firestore, storage } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { ITeam } from "@/types"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/optimistic"
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  type FieldValue,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
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
import { defineStore, storeToRefs } from "pinia"
import { computed, type ComputedRef, ref, shallowRef, watch } from "vue"
import { useDocument } from "vuefire"

// Constants
const BATCH_SIZE = 450

// Helper to get document references
const getTeamRef = (teamId: string) => doc(firestore, "teams", teamId)

const getMembershipRef = (teamId: string, userId: string) =>
  doc(firestore, "teams", teamId, "memberships", userId)

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

// Helper to upload team photo
async function uploadTeamPhoto(teamId: string, file: File): Promise<string> {
  const fileRef = storageRef(storage, `teams/${teamId}/profilePhoto`)
  await uploadBytes(fileRef, file)
  return await getDownloadURL(fileRef)
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

export const useTeamStore = defineStore("teams", () => {
  const authStore = useAuthStore()
  const membershipStore = useMembershipStore()

  const { currentUser, userProfile, pendingUserIds } = storeToRefs(authStore)
  const { memberships, teamMembers, pendingMembershipIds } =
    storeToRefs(membershipStore)

  // ============================================================================
  // VueFire Reactive Bindings
  // ============================================================================

  // Computed document reference - null when no team selected
  const teamDocRef = computed(() =>
    userProfile.value?.currentTeamId
      ? getTeamRef(userProfile.value.currentTeamId)
      : null
  )

  // VueFire reactive document binding for current team
  // Use intermediate variables with type assertions to isolate VueFire types
  const _vuefireTeamDoc = useDocument<ITeam>(teamDocRef)
  const firestoreCurrentTeam: ComputedRef<ITeam | null | undefined> = computed(
    () => _vuefireTeamDoc.data.value
  )
  const isFirestoreLoading: ComputedRef<boolean> = computed(
    () => _vuefireTeamDoc.pending.value
  )

  // ============================================================================
  // State (for optimistic updates)
  // ============================================================================

  // Local team that can be optimistically updated
  const optimisticCurrentTeam = ref<ITeam | null>(null)

  // Pending operation tracking
  const pendingTeamIds = shallowRef(createPendingSet())

  // ============================================================================
  // Computed
  // ============================================================================

  // Merged current team: optimistic updates take precedence when pending
  const currentTeam = computed({
    get: () => {
      const teamId = userProfile.value?.currentTeamId
      if (teamId && pendingTeamIds.value.has(teamId)) {
        return optimisticCurrentTeam.value
      }
      return firestoreCurrentTeam.value ?? optimisticCurrentTeam.value
    },
    set: (value) => {
      optimisticCurrentTeam.value = value
    },
  })

  const isLoading = computed(
    () => isFirestoreLoading.value && !optimisticCurrentTeam.value
  )

  const isTeamPending = computed(
    () => (id: string) => pendingTeamIds.value.has(id)
  )

  const hasAnyPendingOperation = computed(
    () =>
      pendingTeamIds.value.size > 0 ||
      pendingUserIds.value.size > 0 ||
      pendingMembershipIds.value.size > 0
  )

  // ============================================================================
  // Sync Optimistic State with Firestore
  // ============================================================================

  // Sync optimistic team with Firestore data when not pending
  watch(
    firestoreCurrentTeam,
    (team) => {
      const teamId = userProfile.value?.currentTeamId
      if (team && teamId && !pendingTeamIds.value.has(teamId)) {
        optimisticCurrentTeam.value = team
      }
    },
    { immediate: true }
  )

  // Also try to get team from cached memberships for faster initial load
  watch(
    () => userProfile.value?.currentTeamId,
    (teamId) => {
      if (!teamId) {
        optimisticCurrentTeam.value = null
        return
      }

      // Skip if team has pending operations or already have data
      if (pendingTeamIds.value.has(teamId) || firestoreCurrentTeam.value) {
        return
      }

      // Try to get team from cached memberships first (optimistic)
      const cachedMembership = memberships.value.find(
        (m) => m.teamId === teamId
      )
      if (cachedMembership?.team) {
        optimisticCurrentTeam.value = cachedMembership.team
      }
    },
    { immediate: true }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    optimisticCurrentTeam.value = null
    authStore.cleanup()
    membershipStore.cleanup()
  }

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Create a new team with optimistic update
   */
  async function createTeam(name: string, photoFile?: File): Promise<void> {
    if (!currentUser.value || !userProfile.value) return

    const teamRef = doc(collection(firestore, "teams"))
    const teamId = teamRef.id
    const timestamp = serverTimestamp()

    // Clone previous state for rollback
    const previousUserProfile = cloneState(userProfile.value)
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousMemberships = cloneState(memberships.value)
    const previousTeamMembers = cloneState(teamMembers.value)

    let photoURL: string | null = null
    if (photoFile) {
      try {
        photoURL = await uploadTeamPhoto(teamId, photoFile)
      } catch (error) {
        console.error("Error uploading team photo:", error)
      }
    }

    const newTeam: ITeam = {
      id: teamId,
      name,
      photoURL,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    const newMembership = await membershipStore.createOwnerMembership(
      teamId,
      newTeam
    )
    const membershipKey = `${teamId}-${currentUser.value.uid}`

    await withOptimisticUpdate(
      pendingTeamIds.value,
      teamId,
      // Apply optimistic updates
      () => {
        pendingUserIds.value.add(currentUser.value!.uid)
        membershipStore.markPending(membershipKey)

        // Update user profile through authStore (optimistically)
        authStore.setCurrentTeamId(teamId)
        optimisticCurrentTeam.value = newTeam
        membershipStore.addMembershipOptimistic(newMembership)
      },
      // Rollback on error
      () => {
        authStore.setCurrentTeamId(previousUserProfile?.currentTeamId ?? null)
        optimisticCurrentTeam.value = previousCurrentTeam
        membershipStore.rollbackMemberships(previousMemberships)
        membershipStore.rollbackTeamMembers(previousTeamMembers)
      },
      // Firestore operation
      async () => {
        try {
          await runTransaction(firestore, async (transaction) => {
            transaction.set(teamRef, newTeam)
            transaction.set(
              getMembershipRef(teamId, currentUser.value!.uid),
              newMembership
            )
            transaction.update(getUserRef(currentUser.value!.uid), {
              currentTeamId: teamId,
              updatedAt: serverTimestamp(),
            })
          })
        } finally {
          pendingUserIds.value.delete(currentUser.value!.uid)
          membershipStore.clearPending(membershipKey)
        }
      }
    )
  }

  /**
   * Switch to a different team with optimistic update
   */
  async function switchTeam(teamId: string): Promise<void> {
    if (!currentUser.value || !userProfile.value) return

    // Clone previous state for rollback
    const previousCurrentTeam = cloneState(currentTeam.value)

    const cachedMembership = memberships.value.find((m) => m.teamId === teamId)

    await withOptimisticUpdate(
      pendingUserIds.value,
      currentUser.value.uid,
      // Apply optimistic update
      () => {
        if (cachedMembership?.team) {
          optimisticCurrentTeam.value = cloneState(cachedMembership.team)
        }
        authStore.setCurrentTeamId(teamId)
      },
      // Rollback on error
      () => {
        authStore.setCurrentTeamId(
          userProfile.value?.currentTeamId ?? previousCurrentTeam?.id ?? null
        )
        optimisticCurrentTeam.value = previousCurrentTeam
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
   * Update team details with optimistic update
   */
  async function updateTeam(
    teamId: string,
    updates: { name?: string; photoFile?: File | null }
  ): Promise<void> {
    if (!currentUser.value) return

    const { name, photoFile } = updates
    const updateData: {
      name?: string
      photoURL?: string | null
      updatedAt: FieldValue
    } = {
      updatedAt: serverTimestamp(),
    }

    if (name) updateData.name = name

    if (photoFile !== undefined) {
      updateData.photoURL =
        photoFile === null ? null : await uploadTeamPhoto(teamId, photoFile)
    }

    // Clone previous state for rollback
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousMemberships = cloneState(memberships.value)

    await withOptimisticUpdate(
      pendingTeamIds.value,
      teamId,
      // Apply optimistic update
      () => {
        if (currentTeam.value?.id === teamId) {
          optimisticCurrentTeam.value = {
            ...currentTeam.value,
            ...(name ? { name } : {}),
            ...(updateData.photoURL !== undefined
              ? { photoURL: updateData.photoURL }
              : {}),
          }
        }

        membershipStore.updateTeamInMemberships(teamId, {
          ...(name ? { name } : {}),
          ...(updateData.photoURL !== undefined
            ? { photoURL: updateData.photoURL }
            : {}),
        })
      },
      // Rollback on error
      () => {
        optimisticCurrentTeam.value = previousCurrentTeam
        membershipStore.rollbackMemberships(previousMemberships)
      },
      // Firestore operation
      async () => {
        await updateDoc(getTeamRef(teamId), updateData)

        // Update all memberships for this team
        const membershipsQuery = query(
          collectionGroup(firestore, "memberships"),
          where("teamId", "==", teamId)
        )

        await updateMemberships(membershipsQuery, (membershipData) => {
          const existingTeam =
            (membershipData.team as Record<string, unknown>) || {}
          const updatedTeam: Record<string, unknown> = {
            ...existingTeam,
            ...updateData,
          }
          Object.keys(updatedTeam).forEach(
            (key) => updatedTeam[key] === undefined && delete updatedTeam[key]
          )
          return { team: updatedTeam }
        })
      }
    )
  }

  /**
   * Delete a team with optimistic update
   */
  async function deleteTeam(teamId: string): Promise<void> {
    if (!currentUser.value) return

    const membership = memberships.value.find((m) => m.teamId === teamId)
    if (!membership || membership.role !== "owner") {
      throw new Error("Only team owners can delete the team")
    }

    // Clone previous state for rollback
    const previousMemberships = cloneState(memberships.value)
    const previousCurrentTeam = cloneState(currentTeam.value)
    const previousUserProfile = cloneState(userProfile.value)

    await withOptimisticUpdate(
      pendingTeamIds.value,
      teamId,
      // Apply optimistic update
      () => {
        membershipStore.removeMembershipsForTeam(teamId)
        if (currentTeam.value?.id === teamId) {
          optimisticCurrentTeam.value = null
          authStore.setCurrentTeamId(null)
        }
      },
      // Rollback on error
      () => {
        membershipStore.rollbackMemberships(previousMemberships)
        optimisticCurrentTeam.value = previousCurrentTeam
        authStore.setCurrentTeamId(previousUserProfile?.currentTeamId ?? null)
      },
      // Firestore operation
      async () => {
        // Find all memberships and users to update
        const membershipsQuery = query(
          collectionGroup(firestore, "memberships"),
          where("teamId", "==", teamId)
        )
        const usersQuery = query(
          collection(firestore, "users"),
          where("currentTeamId", "==", teamId)
        )

        const [membershipDocs, userDocs] = await Promise.all([
          getDocs(membershipsQuery),
          getDocs(usersQuery),
        ])

        // Delete team document
        await deleteDoc(getTeamRef(teamId))

        // Delete all memberships and update users in batches
        await Promise.all([
          processInBatches(membershipDocs.docs, (docSnap, batch) =>
            batch.delete(docSnap.ref)
          ),
          processInBatches(userDocs.docs, (docSnap, batch) =>
            batch.update(docSnap.ref, {
              currentTeamId: null,
              updatedAt: serverTimestamp(),
            })
          ),
        ])
      }
    )
  }

  return {
    // State
    currentUser,
    userProfile,
    currentTeam,
    memberships,
    teamMembers,
    isLoading,

    // Pending state
    pendingTeamIds,
    pendingUserIds,
    pendingMembershipIds,

    // Computed
    isTeamPending,
    isUserPending: authStore.isUserPending,
    isMembershipPending: membershipStore.isMembershipPending,
    hasAnyPendingOperation,

    // Team Actions
    createTeam,
    switchTeam,
    updateTeam,
    deleteTeam,

    // Lifecycle
    cleanup,
  }
})

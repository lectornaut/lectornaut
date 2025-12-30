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
  getDoc,
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
import { computed, ref, shallowRef, watch } from "vue"

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
  // State
  // ============================================================================

  const currentTeam = ref<ITeam | null>(null)
  const isLoading = ref(true)

  // Pending operation tracking
  const pendingTeamIds = shallowRef(createPendingSet())

  // ============================================================================
  // Computed
  // ============================================================================

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
  // Team Data Fetching
  // ============================================================================

  // Watch for currentTeamId changes to fetch current team data
  watch(
    () => userProfile.value?.currentTeamId,
    async (teamId) => {
      if (!teamId) {
        currentTeam.value = null
        isLoading.value = false
        return
      }

      // Skip if team has pending operations
      if (pendingTeamIds.value.has(teamId)) {
        isLoading.value = false
        return
      }

      // Try to get team from cached memberships first (optimistic)
      const cachedMembership = memberships.value.find(
        (m) => m.teamId === teamId
      )
      if (cachedMembership?.team) {
        currentTeam.value = cachedMembership.team
        isLoading.value = false
      }

      // Fetch fresh team data
      const teamSnap = await getDoc(getTeamRef(teamId))
      if (teamSnap.exists()) {
        // Only update if no pending operation
        if (!pendingTeamIds.value.has(teamId)) {
          currentTeam.value = teamSnap.data() as ITeam
        }
      } else if (!cachedMembership?.team) {
        currentTeam.value = null
      }
      isLoading.value = false
    }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    currentTeam.value = null
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
        userProfile.value = { ...userProfile.value!, currentTeamId: teamId }
        currentTeam.value = newTeam
        membershipStore.addMembershipOptimistic(newMembership)
      },
      // Rollback on error
      () => {
        userProfile.value = previousUserProfile
        currentTeam.value = previousCurrentTeam
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
    const previousUserProfile = cloneState(userProfile.value)
    const previousCurrentTeam = cloneState(currentTeam.value)

    const cachedMembership = memberships.value.find((m) => m.teamId === teamId)

    await withOptimisticUpdate(
      pendingUserIds.value,
      currentUser.value.uid,
      // Apply optimistic update
      () => {
        if (cachedMembership?.team) {
          currentTeam.value = cloneState(cachedMembership.team)
        }
        userProfile.value = { ...userProfile.value!, currentTeamId: teamId }
      },
      // Rollback on error
      () => {
        userProfile.value = previousUserProfile
        currentTeam.value = previousCurrentTeam
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
          currentTeam.value = {
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
        currentTeam.value = previousCurrentTeam
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
          currentTeam.value = null
          if (userProfile.value) {
            userProfile.value = { ...userProfile.value, currentTeamId: null }
          }
        }
      },
      // Rollback on error
      () => {
        membershipStore.rollbackMemberships(previousMemberships)
        currentTeam.value = previousCurrentTeam
        userProfile.value = previousUserProfile
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

/**
 * Membership Store - Team Memberships and Role Management
 *
 * Handles:
 * - Team memberships (user's teams they belong to)
 * - Team members (members of the current team)
 * - Role management (owner, admin, member)
 * - Invite/remove members
 *
 * Uses VueFire composables for reactive Firestore bindings
 */

import { firestore } from "@/modules/firebase"
import { useAuthStore } from "@/stores/authStore"
import type { IMembership, ITeam, IUser } from "@/types"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/optimistic"
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref, shallowRef, watch, type ComputedRef } from "vue"
import { useCollection } from "vuefire"

// Helper to get document references
const getMembershipRef = (teamId: string, userId: string) =>
  doc(firestore, "teams", teamId, "memberships", userId)

const getUserRef = (userId: string) => doc(firestore, "users", userId)

// Helper to get ownership count
const getOwnerCount = (members: IMembership[]) =>
  members.filter((m) => m.role === "owner").length

// Helper to validate member can be removed
function validateMemberRemoval(
  membershipData: IMembership,
  teamMembers: IMembership[]
) {
  if (teamMembers.length <= 1) {
    throw new Error(
      "Cannot remove the last member. Every team must have at least one member."
    )
  }
  if (membershipData.role === "owner" && getOwnerCount(teamMembers) <= 1) {
    throw new Error(
      "Cannot remove the last owner. Please assign another owner first."
    )
  }
}

export const useMembershipStore = defineStore("memberships", () => {
  const authStore = useAuthStore()
  const { currentUser, userProfile, pendingUserIds } = storeToRefs(authStore)

  // ============================================================================
  // VueFire Reactive Bindings
  // ============================================================================

  // Query for user's memberships - null when not authenticated
  const membershipsQueryRef = computed(() =>
    currentUser.value
      ? query(
          collectionGroup(firestore, "memberships"),
          where("userId", "==", currentUser.value.uid)
        )
      : null
  )

  // VueFire reactive collection binding for memberships
  // Use intermediate variables with type assertions to isolate VueFire types
  const _vuefireMemberships = useCollection<IMembership>(membershipsQueryRef)
  const firestoreMemberships: ComputedRef<IMembership[]> = computed(
    () => _vuefireMemberships.data.value ?? []
  )

  // Query for team members - null when no team selected
  const currentTeamId = computed(() => userProfile.value?.currentTeamId ?? null)

  const teamMembersQueryRef = computed(() =>
    currentTeamId.value
      ? collection(firestore, "teams", currentTeamId.value, "memberships")
      : null
  )

  // VueFire reactive collection binding for team members
  const _vuefireTeamMembers = useCollection<IMembership>(teamMembersQueryRef)
  const firestoreTeamMembers: ComputedRef<IMembership[]> = computed(
    () => _vuefireTeamMembers.data.value ?? []
  )

  // ============================================================================
  // State (for optimistic updates)
  // ============================================================================

  /** Local memberships that can be optimistically updated */
  const optimisticMemberships = ref<IMembership[]>([])

  /** Local team members that can be optimistically updated */
  const optimisticTeamMembers = ref<IMembership[]>([])

  // Pending operation tracking
  const pendingMembershipIds = shallowRef(createPendingSet())

  // ============================================================================
  // Computed - Merged State
  // ============================================================================

  /** All memberships for the current user (teams they belong to) */
  const memberships = computed({
    get: () => {
      const pending = pendingMembershipIds.value
      if (pending.size === 0) {
        return firestoreMemberships.value
      }

      // Merge Firestore data with optimistic updates
      const result: IMembership[] = []
      const firestoreData = firestoreMemberships.value

      // Add Firestore memberships, replacing with optimistic if pending
      firestoreData.forEach((m) => {
        const key = `${m.teamId}-${m.userId}`
        if (pending.has(key)) {
          const optimistic = optimisticMemberships.value.find(
            (om) => om.teamId === m.teamId && om.userId === m.userId
          )
          if (optimistic) {
            result.push(optimistic)
            return
          }
        }
        result.push(m)
      })

      // Add any optimistically added memberships not yet in Firestore
      optimisticMemberships.value.forEach((m) => {
        const key = `${m.teamId}-${m.userId}`
        if (
          pending.has(key) &&
          !result.some((r) => r.teamId === m.teamId && r.userId === m.userId)
        ) {
          result.push(m)
        }
      })

      return result
    },
    set: (value) => {
      optimisticMemberships.value = value
    },
  })

  /** Members of the currently selected team */
  const teamMembers = computed({
    get: () => {
      // Return empty array if no team is selected
      if (!currentTeamId.value) {
        return []
      }

      const pending = pendingMembershipIds.value
      if (pending.size === 0) {
        return firestoreTeamMembers.value
      }

      // Merge Firestore data with optimistic updates
      const result: IMembership[] = []
      const firestoreData = firestoreTeamMembers.value

      firestoreData.forEach((m) => {
        const key = `${m.teamId}-${m.userId}`
        if (pending.has(key)) {
          const optimistic = optimisticTeamMembers.value.find(
            (om) => om.userId === m.userId
          )
          if (optimistic) {
            result.push(optimistic)
            return
          }
        }
        result.push(m)
      })

      // Add optimistically added members
      optimisticTeamMembers.value.forEach((m) => {
        const key = `${m.teamId}-${m.userId}`
        if (pending.has(key) && !result.some((r) => r.userId === m.userId)) {
          result.push(m)
        }
      })

      return result
    },
    set: (value) => {
      optimisticTeamMembers.value = value
    },
  })

  // ============================================================================
  // Computed
  // ============================================================================

  const isMembershipPending = computed(
    () => (id: string) => pendingMembershipIds.value.has(id)
  )

  const hasAnyPendingOperation = computed(
    () => pendingMembershipIds.value.size > 0
  )

  /** Get the current user's membership for a specific team */
  const getMembershipForTeam = computed(
    () => (teamId: string) => memberships.value.find((m) => m.teamId === teamId)
  )

  /** Get the current user's role in the current team */
  const currentUserRole = computed(() => {
    if (!currentUser.value || !currentTeamId.value) return null
    const membership = teamMembers.value.find(
      (m) => m.userId === currentUser.value?.uid
    )
    return membership?.role ?? null
  })

  /** Check if current user is an owner of the current team */
  const isOwner = computed(() => currentUserRole.value === "owner")

  /** Count of owners in the current team */
  const ownerCount = computed(() => getOwnerCount(teamMembers.value))

  // ============================================================================
  // Sync Optimistic State with Firestore
  // ============================================================================

  // Sync optimistic memberships with Firestore data when not pending
  watch(
    firestoreMemberships,
    (data) => {
      if (data && pendingMembershipIds.value.size === 0) {
        optimisticMemberships.value = [...data]
      }
    },
    { immediate: true }
  )

  // Sync optimistic team members with Firestore data when not pending
  watch(
    firestoreTeamMembers,
    (data) => {
      if (data && pendingMembershipIds.value.size === 0) {
        optimisticTeamMembers.value = [...data]
      }
    },
    { immediate: true }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    optimisticMemberships.value = []
    optimisticTeamMembers.value = []
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
   * Add a membership optimistically (used by teamStore when creating teams)
   */
  function addMembershipOptimistic(membership: IMembership) {
    optimisticMemberships.value = [...memberships.value, membership]
    optimisticTeamMembers.value = [membership]
  }

  /**
   * Update team data in memberships (used by teamStore when updating teams)
   */
  function updateTeamInMemberships(
    teamId: string,
    teamUpdates: Partial<ITeam>
  ) {
    optimisticMemberships.value = memberships.value.map((m) => {
      if (m.teamId === teamId && m.team) {
        return {
          ...m,
          team: { ...m.team, ...teamUpdates },
        }
      }
      return m
    })
  }

  /**
   * Remove memberships for a team (used by teamStore when deleting teams)
   */
  function removeMembershipsForTeam(teamId: string) {
    optimisticMemberships.value = memberships.value.filter(
      (m) => m.teamId !== teamId
    )
  }

  /**
   * Clear team members (used when deleting/exiting the current team)
   */
  function clearTeamMembers() {
    optimisticTeamMembers.value = []
  }

  /**
   * Rollback memberships state
   */
  function rollbackMemberships(previousMemberships: IMembership[]) {
    optimisticMemberships.value = previousMemberships
  }

  /**
   * Rollback team members state
   */
  function rollbackTeamMembers(previousTeamMembers: IMembership[]) {
    optimisticTeamMembers.value = previousTeamMembers
  }

  /**
   * Invite a member to the current team with optimistic update
   */
  async function inviteMember(
    teamId: string,
    team: ITeam,
    email: string,
    role: IMembership["role"] = "member"
  ): Promise<void> {
    if (!currentUser.value) return

    // Find user by email
    const usersQuery = query(
      collection(firestore, "users"),
      where("email", "==", email)
    )
    const querySnapshot = await getDocs(usersQuery)

    if (querySnapshot.empty) {
      throw new Error("User not found")
    }

    const userDoc = querySnapshot.docs[0]!
    const userData = userDoc.data() as IUser
    const userId = userDoc.id

    // Check if already a member
    const membershipRef = getMembershipRef(teamId, userId)
    const membershipSnap = await getDoc(membershipRef)

    if (membershipSnap.exists()) {
      throw new Error("User is already a member")
    }

    const timestamp = serverTimestamp()
    const newMembership: IMembership = {
      id: userId,
      userId,
      teamId,
      role,
      user: userData,
      team: cloneState(team),
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    const membershipKey = `${teamId}-${userId}`
    const previousTeamMembers = cloneState(teamMembers.value)

    await withOptimisticUpdate(
      pendingMembershipIds.value,
      membershipKey,
      // Apply optimistic update
      () => {
        optimisticTeamMembers.value = [...teamMembers.value, newMembership]
      },
      // Rollback on error
      () => {
        optimisticTeamMembers.value = previousTeamMembers
      },
      // Firestore operation
      async () => {
        await setDoc(membershipRef, newMembership)
      }
    )
  }

  /**
   * Change a member's role with optimistic update
   */
  async function changeRole(
    teamId: string,
    userId: string,
    newRole: IMembership["role"]
  ): Promise<void> {
    const membershipRef = getMembershipRef(teamId, userId)
    const membershipSnap = await getDoc(membershipRef)

    if (!membershipSnap.exists()) {
      throw new Error("Membership not found")
    }

    const currentMembership = membershipSnap.data() as IMembership

    // Prevent changing role if this is the last owner
    if (currentMembership.role === "owner" && newRole !== "owner") {
      if (getOwnerCount(teamMembers.value) <= 1) {
        throw new Error("Cannot change role: Team must have at least one owner")
      }
    }

    const membershipKey = `${teamId}-${userId}`
    const previousTeamMembers = cloneState(teamMembers.value)

    await withOptimisticUpdate(
      pendingMembershipIds.value,
      membershipKey,
      // Apply optimistic update
      () => {
        optimisticTeamMembers.value = teamMembers.value.map((m) =>
          m.userId === userId ? { ...m, role: newRole } : m
        )
      },
      // Rollback on error
      () => {
        optimisticTeamMembers.value = previousTeamMembers
      },
      // Firestore operation
      async () => {
        await updateDoc(membershipRef, {
          role: newRole,
          updatedAt: serverTimestamp(),
        })
      }
    )
  }

  /**
   * Remove a member from the team with optimistic update
   */
  async function removeMember(teamId: string, userId: string): Promise<void> {
    if (!currentUser.value) return

    const membershipRef = getMembershipRef(teamId, userId)
    const membershipSnap = await getDoc(membershipRef)

    if (!membershipSnap.exists()) {
      throw new Error("Membership not found")
    }

    const membershipData = membershipSnap.data() as IMembership
    validateMemberRemoval(membershipData, teamMembers.value)

    const membershipKey = `${teamId}-${userId}`
    const previousTeamMembers = cloneState(teamMembers.value)
    const previousMemberships = cloneState(memberships.value)
    const previousUserProfile = cloneState(userProfile.value)

    const isRemovingSelf = userId === currentUser.value.uid

    await withOptimisticUpdate(
      pendingMembershipIds.value,
      membershipKey,
      // Apply optimistic update
      () => {
        optimisticTeamMembers.value = teamMembers.value.filter(
          (m) => m.userId !== userId
        )
        if (isRemovingSelf) {
          pendingUserIds.value.add(userId)
          optimisticMemberships.value = memberships.value.filter(
            (m) => m.teamId !== teamId
          )
          if (userProfile.value) {
            authStore.setCurrentTeamId(null)
          }
        }
      },
      // Rollback on error
      () => {
        optimisticTeamMembers.value = previousTeamMembers
        optimisticMemberships.value = previousMemberships
        if (isRemovingSelf && previousUserProfile?.currentTeamId) {
          // Restore user's current team through authStore
          authStore.setCurrentTeamId(previousUserProfile.currentTeamId)
        }
      },
      // Firestore operation
      async () => {
        try {
          if (isRemovingSelf) {
            await updateDoc(getUserRef(userId), {
              currentTeamId: null,
              updatedAt: serverTimestamp(),
            })
          }

          await runTransaction(firestore, async (transaction) => {
            transaction.delete(membershipRef)
          })
        } finally {
          if (isRemovingSelf) {
            pendingUserIds.value.delete(userId)
          }
        }
      }
    )
  }

  /**
   * Create a membership for a new team (used by teamStore)
   */
  async function createOwnerMembership(
    teamId: string,
    team: ITeam
  ): Promise<IMembership> {
    if (!currentUser.value || !userProfile.value) {
      throw new Error("Not authenticated")
    }

    const timestamp = serverTimestamp()
    const newMembership: IMembership = {
      id: currentUser.value.uid,
      userId: currentUser.value.uid,
      teamId,
      role: "owner",
      user: userProfile.value,
      team,
      createdAt: timestamp as Timestamp,
      updatedAt: timestamp as Timestamp,
    }

    return newMembership
  }

  /**
   * Mark a membership as pending
   */
  function markPending(key: string) {
    pendingMembershipIds.value.add(key)
  }

  /**
   * Clear pending status for a membership
   */
  function clearPending(key: string) {
    pendingMembershipIds.value.delete(key)
  }

  return {
    // State
    memberships,
    teamMembers,
    currentTeamId,

    // Pending state
    pendingMembershipIds,

    // Computed
    isMembershipPending,
    hasAnyPendingOperation,
    getMembershipForTeam,
    currentUserRole,
    isOwner,
    ownerCount,

    // Actions
    inviteMember,
    changeRole,
    removeMember,
    createOwnerMembership,

    // Internal helpers (for teamStore)
    addMembershipOptimistic,
    updateTeamInMemberships,
    removeMembershipsForTeam,
    clearTeamMembers,
    rollbackMemberships,
    rollbackTeamMembers,
    markPending,
    clearPending,

    // Lifecycle
    cleanup,
  }
})

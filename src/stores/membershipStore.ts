/**
 * Membership Store - Team Memberships and Role Management
 *
 * Handles:
 * - Team memberships (user's teams they belong to)
 * - Team members (members of the current team)
 * - Role management (owner, admin, member)
 * - Invite/remove members
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
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Timestamp,
  updateDoc,
  where,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref, shallowRef, watch } from "vue"

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
  // State
  // ============================================================================

  /** All memberships for the current user (teams they belong to) */
  const memberships = ref<IMembership[]>([])

  /** Members of the currently selected team */
  const teamMembers = ref<IMembership[]>([])

  /** Currently selected team ID (synced from userProfile) */
  const currentTeamId = computed(() => userProfile.value?.currentTeamId ?? null)

  // Pending operation tracking
  const pendingMembershipIds = shallowRef(createPendingSet())

  // Subscription cleanup functions
  let membershipsUnsubscribe: (() => void) | null = null
  let teamMembersUnsubscribe: (() => void) | null = null

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
  // Snapshot Listeners
  // ============================================================================

  // Watch for userProfile changes to fetch memberships
  watch(
    () => userProfile.value?.uid,
    (uid) => {
      if (membershipsUnsubscribe) {
        membershipsUnsubscribe()
        membershipsUnsubscribe = null
      }

      if (!uid) {
        memberships.value = []
        return
      }

      const membershipsQuery = query(
        collectionGroup(firestore, "memberships"),
        where("userId", "==", uid)
      )

      membershipsUnsubscribe = onSnapshot(membershipsQuery, (snapshot) => {
        // Build new memberships, preserving optimistic updates
        const newMemberships: IMembership[] = []
        const pendingSet = pendingMembershipIds.value

        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as IMembership
          const membershipKey = `${data.teamId}-${data.userId}`

          // If this membership has a pending operation, keep the optimistic version
          if (pendingSet.has(membershipKey)) {
            const optimistic = memberships.value.find(
              (m) => m.teamId === data.teamId && m.userId === data.userId
            )
            if (optimistic) {
              newMemberships.push(optimistic)
              return
            }
          }

          newMemberships.push(data)
        })

        // Preserve any optimistically added memberships not in Firestore yet
        memberships.value.forEach((m) => {
          const membershipKey = `${m.teamId}-${m.userId}`
          if (
            pendingSet.has(membershipKey) &&
            !newMemberships.some(
              (nm) => nm.teamId === m.teamId && nm.userId === m.userId
            )
          ) {
            newMemberships.push(m)
          }
        })

        memberships.value = newMemberships
      })
    }
  )

  // Watch currentTeamId to fetch its members
  watch(currentTeamId, (teamId) => {
    if (teamMembersUnsubscribe) {
      teamMembersUnsubscribe()
      teamMembersUnsubscribe = null
    }

    if (!teamId) {
      teamMembers.value = []
      return
    }

    const membersRef = collection(firestore, "teams", teamId, "memberships")
    teamMembersUnsubscribe = onSnapshot(membersRef, (snapshot) => {
      // Build new team members, preserving optimistic updates
      const newMembers: IMembership[] = []
      const pendingSet = pendingMembershipIds.value

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as IMembership
        const membershipKey = `${data.teamId}-${data.userId}`

        if (pendingSet.has(membershipKey)) {
          const optimistic = teamMembers.value.find(
            (m) => m.teamId === data.teamId && m.userId === data.userId
          )
          if (optimistic) {
            newMembers.push(optimistic)
            return
          }
        }

        newMembers.push(data)
      })

      // Preserve optimistically added members
      teamMembers.value.forEach((m) => {
        const membershipKey = `${m.teamId}-${m.userId}`
        if (
          pendingSet.has(membershipKey) &&
          !newMembers.some((nm) => nm.userId === m.userId)
        ) {
          newMembers.push(m)
        }
      })

      teamMembers.value = newMembers
    })
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    memberships.value = []
    teamMembers.value = []
    if (membershipsUnsubscribe) {
      membershipsUnsubscribe()
      membershipsUnsubscribe = null
    }
    if (teamMembersUnsubscribe) {
      teamMembersUnsubscribe()
      teamMembersUnsubscribe = null
    }
  }

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Add a membership optimistically (used by teamStore when creating teams)
   */
  function addMembershipOptimistic(membership: IMembership) {
    memberships.value = [...memberships.value, membership]
    teamMembers.value = [membership]
  }

  /**
   * Update team data in memberships (used by teamStore when updating teams)
   */
  function updateTeamInMemberships(
    teamId: string,
    teamUpdates: Partial<ITeam>
  ) {
    memberships.value = memberships.value.map((m) => {
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
    memberships.value = memberships.value.filter((m) => m.teamId !== teamId)
  }

  /**
   * Rollback memberships state
   */
  function rollbackMemberships(previousMemberships: IMembership[]) {
    memberships.value = previousMemberships
  }

  /**
   * Rollback team members state
   */
  function rollbackTeamMembers(previousTeamMembers: IMembership[]) {
    teamMembers.value = previousTeamMembers
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
        teamMembers.value = [...teamMembers.value, newMembership]
      },
      // Rollback on error
      () => {
        teamMembers.value = previousTeamMembers
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
        teamMembers.value = teamMembers.value.map((m) =>
          m.userId === userId ? { ...m, role: newRole } : m
        )
      },
      // Rollback on error
      () => {
        teamMembers.value = previousTeamMembers
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
        teamMembers.value = teamMembers.value.filter((m) => m.userId !== userId)
        if (isRemovingSelf) {
          pendingUserIds.value.add(userId)
          memberships.value = memberships.value.filter(
            (m) => m.teamId !== teamId
          )
          if (userProfile.value) {
            authStore.setCurrentTeamId(null)
          }
        }
      },
      // Rollback on error
      () => {
        teamMembers.value = previousTeamMembers
        memberships.value = previousMemberships
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
    rollbackMemberships,
    rollbackTeamMembers,
    markPending,
    clearPending,

    // Lifecycle
    cleanup,
  }
})

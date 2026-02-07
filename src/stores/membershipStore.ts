/**
 * Membership Store - Team Memberships and Role Management
 *
 * Handles:
 * - Team memberships (user's teams they belong to)
 * - Team members (members of the current team)
 * - Role management (owner, admin, member)
 * - Invite/remove members
 *
 * Uses VueFire composables for reactive Firestore bindings.
 * All mutations go through Cloud Functions for automatic audit logging.
 */

import {
  assignRoleToUser as assignRoleToUserFn,
  removeMember as removeMemberFn,
  removeMembers as removeMembersFn,
  sendInvitation as sendInvitationFn,
} from "@/composables/useFunctions"
import { defaultTeamRole } from "@/helpers/defaults"
import { useAuthStore } from "@/stores/authStore"
import type { IMembership, IMembershipRole, ITeam } from "@/types"
import {
  getAllMembershipsGroup,
  getTeamMembershipsCollection,
} from "@/utils/firebase-helpers"
import {
  addPending,
  cloneState,
  createPendingSet,
  removePending,
  withOptimisticUpdate,
} from "@/utils/firebase-optimistic"
import { can, Capabilities, hasExactRole } from "@/utils/permissions"
import {
  getDocs,
  query,
  serverTimestamp,
  where,
  type Timestamp,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref, shallowRef } from "vue"
import { useCollection } from "vuefire"

// Helper to get ownership count (used for ownerCount computed property)
const getOwnerCount = (members: IMembership[]) =>
  members.filter((m) => m.role === "owner").length

export const useMembershipStore = defineStore("memberships", () => {
  const authStore = useAuthStore()
  const { currentUser, userProfile, pendingUserIds, currentTeamId } =
    storeToRefs(authStore)

  // ============================================================================
  // VueFire Reactive Bindings
  // ============================================================================

  // Query for user's memberships - null when not authenticated
  const membershipsQueryRef = computed(() =>
    currentUser.value
      ? query(
          getAllMembershipsGroup(),
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

  const teamMembersQueryRef = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null

    // Guard: Ensure user is a member of the team before trying to list its members.
    // This prevents the "Missing or insufficient permissions" error.
    // Note: memberships.value comes from the user's own membership list (collectionGroup), which is safe.
    const isMember = memberships.value.some((m) => m.teamId === teamId)
    if (!isMember) return null

    return getTeamMembershipsCollection(teamId)
  })

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

  const isLoading = computed(() => _vuefireMemberships.pending.value)

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
  const isOwner = computed(() => hasExactRole(currentUserRole.value, "owner"))

  /** Check if current user is an admin of the current team */
  const isAdmin = computed(() => hasExactRole(currentUserRole.value, "admin"))

  /** Check if current user is a member of the current team */
  const isMember = computed(() => hasExactRole(currentUserRole.value, "member"))

  /** Check if current user can manage workspaces (member or higher) */
  const canManageWorkspaces = computed(() =>
    can(currentUser.value, Capabilities.CREATE_WORKSPACE, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )

  /** Check if current user can manage team members (admin or higher) */
  const canManageMembers = computed(() =>
    can(currentUser.value, Capabilities.INVITE_MEMBER, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )

  /** Count of owners in the current team */
  const ownerCount = computed(() => getOwnerCount(teamMembers.value))

  // ============================================================================
  // Team Member Counts - Reactive map of team ID to member count
  // ============================================================================

  /** Cache of member counts for each team */
  const teamMemberCounts = ref<Record<string, number>>({})

  /** Get member count for a specific team */
  const getTeamMemberCount = (teamId: string): number => {
    return teamMemberCounts.value[teamId] ?? 1
  }

  /** Fetch member counts for all teams the user is a member of */
  async function fetchTeamMemberCounts() {
    const teamIds = memberships.value.map((m) => m.teamId)
    const counts: Record<string, number> = {}

    await Promise.all(
      teamIds.map(async (teamId) => {
        try {
          const membersSnapshot = await getDocs(
            getTeamMembershipsCollection(teamId)
          )
          counts[teamId] = membersSnapshot.size
        } catch (error) {
          console.error(
            `[membershipStore] Failed to fetch member count for team ${teamId}:`,
            error
          )
          counts[teamId] = 1
        }
      })
    )

    teamMemberCounts.value = counts
  }

  // Fetch member counts when memberships change
  watch(
    () => memberships.value.map((m) => m.teamId).join(","),
    () => {
      fetchTeamMemberCounts()
    },
    { immediate: true }
  )

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
   * Invite a member to the current team.
   */
  async function inviteMember(
    teamId: string,
    email: string,
    role: IMembership["role"] = defaultTeamRole
  ): Promise<void> {
    if (!currentUser.value) return

    const membership = memberships.value.find(
      (m) => m.teamId === teamId && m.userId === currentUser.value?.uid
    )
    if (
      !membership ||
      !can(currentUser.value, Capabilities.INVITE_MEMBER, {
        scope: "team",
        teamRole: membership.role,
      })
    ) {
      throw new Error("You do not have permission to invite members")
    }

    await sendInvitationFn({
      teamId,
      email,
      role,
    })
  }

  /**
   * Change a member's role with optimistic update.
   * Uses Cloud Function for automatic audit logging.
   */
  async function changeRole(
    teamId: string,
    userId: string,
    newRole: IMembershipRole
  ): Promise<void> {
    if (
      !can(currentUser.value, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: currentUserRole.value,
      })
    ) {
      throw new Error("You do not have permission to change member roles")
    }

    const membershipKey = `${teamId}-${userId}`
    const previousTeamMembers = cloneState(teamMembers.value)

    await withOptimisticUpdate(
      pendingMembershipIds,
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
      // Cloud Function call
      async () => {
        await assignRoleToUserFn({
          teamId,
          userId,
          role: newRole,
        })
      }
    )
  }

  /**
   * Remove a member from the team with optimistic update.
   * Uses Cloud Function for automatic audit logging.
   */
  async function removeMember(teamId: string, userId: string): Promise<void> {
    if (!currentUser.value) return

    // If removing someone else, check permissions
    if (userId !== currentUser.value.uid) {
      if (
        !can(currentUser.value, Capabilities.REMOVE_MEMBER, {
          scope: "team",
          teamRole: currentUserRole.value,
        })
      ) {
        throw new Error("You do not have permission to remove members")
      }
    }

    const membershipKey = `${teamId}-${userId}`
    const previousTeamMembers = cloneState(teamMembers.value)
    const previousMemberships = cloneState(memberships.value)
    const previousUserProfile = cloneState(userProfile.value)

    const isRemovingSelf = userId === currentUser.value.uid

    await withOptimisticUpdate(
      pendingMembershipIds,
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
      // Cloud Function call
      async () => {
        try {
          await removeMemberFn({ teamId, userId })
        } finally {
          if (isRemovingSelf) {
            pendingUserIds.value.delete(userId)
          }
        }
      }
    )
  }

  /**
   * Remove multiple members from a team with optimistic update.
   * Uses Cloud Function for automatic audit logging.
   */
  async function removeMembers(
    teamId: string,
    userIds: string[]
  ): Promise<void> {
    if (!currentUser.value) return

    if (
      !can(currentUser.value, Capabilities.REMOVE_MEMBER, {
        scope: "team",
        teamRole: currentUserRole.value,
      })
    ) {
      throw new Error("You do not have permission to remove members")
    }

    if (!userIds || userIds.length === 0) return

    const userIdSet = new Set(userIds)
    const membershipKeys = userIds.map((userId) => `${teamId}-${userId}`)
    const previousTeamMembers = cloneState(teamMembers.value)
    const previousMemberships = cloneState(memberships.value)
    const previousUserProfile = cloneState(userProfile.value)

    const isRemovingSelf = userIds.includes(currentUser.value.uid)

    try {
      // Mark all membership keys as pending
      membershipKeys.forEach((k) => addPending(pendingMembershipIds, k))

      // Apply optimistic updates
      optimisticTeamMembers.value = teamMembers.value.filter(
        (m) => !userIdSet.has(m.userId)
      )

      if (isRemovingSelf) {
        pendingUserIds.value.add(currentUser.value.uid)
        optimisticMemberships.value = memberships.value.filter(
          (m) => m.teamId !== teamId
        )
        if (userProfile.value) {
          authStore.setCurrentTeamId(null)
        }
      }

      // Cloud Function call
      await removeMembersFn({ teamId, userIds })
    } catch (error) {
      // Rollback optimistic state on error
      optimisticTeamMembers.value = previousTeamMembers
      optimisticMemberships.value = previousMemberships
      if (isRemovingSelf && previousUserProfile?.currentTeamId) {
        authStore.setCurrentTeamId(previousUserProfile.currentTeamId)
      }
      throw error
    } finally {
      // Clear pending flags
      if (isRemovingSelf) {
        pendingUserIds.value.delete(currentUser.value.uid)
      }
      membershipKeys.forEach((k) => removePending(pendingMembershipIds, k))
    }
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
    addPending(pendingMembershipIds, key)
  }

  /**
   * Clear pending status for a membership
   */
  function clearPending(key: string) {
    removePending(pendingMembershipIds, key)
  }

  /**
   * Get members for a specific team (without switching current team)
   */
  async function getMembersForTeam(teamId: string): Promise<IMembership[]> {
    try {
      const membersSnapshot = await getDocs(
        getTeamMembershipsCollection(teamId)
      )
      return membersSnapshot.docs.map((doc) => doc.data() as IMembership)
    } catch (error) {
      console.error(
        `[membershipStore] Failed to fetch members for team ${teamId}:`,
        error
      )
      return []
    }
  }

  /**
   * Fetch all memberships for the current user
   */
  async function fetchUserMemberships(): Promise<IMembership[]> {
    if (!currentUser.value) return []
    try {
      const q = query(
        getAllMembershipsGroup(),
        where("userId", "==", currentUser.value.uid)
      )
      const snapshot = await getDocs(q)
      return snapshot.docs.map((doc) => doc.data() as IMembership)
    } catch (error) {
      console.error(
        "[membershipStore] Failed to fetch user memberships:",
        error
      )
      return []
    }
  }

  return {
    // State
    memberships,
    teamMembers,
    currentTeamId,
    teamMemberCounts,
    isLoading,

    // Pending state
    pendingMembershipIds,

    // Computed
    isMembershipPending,
    hasAnyPendingOperation,
    getMembershipForTeam,
    currentUserRole,
    isOwner,
    isAdmin,
    isMember,
    canManageWorkspaces,
    canManageMembers,
    ownerCount,
    getTeamMemberCount,

    // Actions
    inviteMember,
    changeRole,
    removeMember,
    removeMembers,
    createOwnerMembership,
    fetchTeamMemberCounts,
    getMembersForTeam,
    fetchUserMemberships,

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

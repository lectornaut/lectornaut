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
import { parseSafe } from "@/schemas/_utils"
import { membershipSchema } from "@/schemas/membership"
import { useAuthStore } from "@/stores/authStore"
import type { ITeam } from "@/types/domain"
import {
  isMembershipRole,
  type IMembership,
  type IMembershipRole,
} from "@/types/membership"
import { can, Capabilities, hasExactRole } from "@/types/permissions"
import { getDocsCached } from "@/utils/firebase/firebase-cache"
import {
  getAllMembershipsGroup,
  getMembershipRef,
  getTeamMembershipsCollection,
} from "@/utils/firebase/firebase-helpers"
import { useLocalHydration } from "@/utils/firebase/firebase-hydration"
import {
  addPending,
  cloneState,
  createPendingSet,
  mergeOptimisticCollectionByKey,
  removePending,
  withCloudSyncOperation,
  withOptimisticUpdate,
} from "@/utils/firebase/firebase-optimistic"
import {
  getCountFromServer,
  getDoc,
  query,
  Timestamp,
  where,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref, shallowRef } from "vue"
import { useCollection } from "vuefire"

// Helper to get ownership count (used for ownerCount computed property)
const getOwnerCount = (members: IMembership[]) =>
  members.filter((m) => m.role === "owner").length

const membershipKey = (membership: Pick<IMembership, "teamId" | "userId">) =>
  `${membership.teamId}-${membership.userId}`

const isPermissionDeniedError = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "permission-denied"
  )

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

  // ============================================================================
  // State (for optimistic updates) — declared early so teamMembersQueryRef
  // guard can check membership without a forward reference to the merged computed.
  // ============================================================================

  /** Local memberships that can be optimistically updated */
  const optimisticMemberships = ref<IMembership[]>([])

  /** Local team members that can be optimistically updated */
  const optimisticTeamMembers = ref<IMembership[]>([])

  // Pending operation tracking
  const pendingMembershipIds = shallowRef(createPendingSet())

  // Hydrate from localStorage for instant cold-start rendering.
  // Must happen before teamMembersQueryRef so the guard has cached membership data.
  useLocalHydration("memberships", optimisticMemberships)

  // Query for team members - null when no team selected

  const teamMembersQueryRef = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null

    // Guard: Ensure user is a member of the team before trying to list its members.
    // This prevents the "Missing or insufficient permissions" error.
    // Uses firestoreMemberships (not merged `memberships` computed) to avoid forward reference
    // during cold-start hydration when currentTeamId may already be set from localStorage cache.
    const isMember =
      firestoreMemberships.value.some((m) => m.teamId === teamId) ||
      optimisticMemberships.value.some((m) => m.teamId === teamId)
    if (!isMember) return null

    return getTeamMembershipsCollection(teamId)
  })

  // VueFire reactive collection binding for team members
  const _vuefireTeamMembers = useCollection<IMembership>(teamMembersQueryRef)
  const firestoreTeamMembers: ComputedRef<IMembership[]> = computed(
    () => _vuefireTeamMembers.data.value ?? []
  )

  // ============================================================================
  // Computed - Merged State
  // ============================================================================

  /** All memberships for the current user (teams they belong to) */
  const memberships = computed({
    get: () =>
      mergeOptimisticCollectionByKey(
        firestoreMemberships.value,
        optimisticMemberships.value,
        pendingMembershipIds.value,
        membershipKey
      ),
    set: (value) => {
      optimisticMemberships.value = value
    },
  })

  /** Members of the currently selected team */
  const teamMembers = computed({
    get: () =>
      currentTeamId.value
        ? mergeOptimisticCollectionByKey(
            firestoreTeamMembers.value,
            optimisticTeamMembers.value,
            pendingMembershipIds.value,
            membershipKey
          )
        : [],
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

  const membershipsByTeamId = computed(
    () =>
      new Map(
        memberships.value.map((membership) => [membership.teamId, membership])
      )
  )

  const teamMembersByUserId = computed(
    () => new Map(teamMembers.value.map((member) => [member.userId, member]))
  )

  /** Get the current user's membership for a specific team */
  const getMembershipForTeam = computed(
    () => (teamId: string) => membershipsByTeamId.value.get(teamId)
  )

  /** Get the current user's role in the current team */
  const currentUserRole = computed(() => {
    if (!currentUser.value || !currentTeamId.value) return null
    const membership = teamMembersByUserId.value.get(currentUser.value.uid)
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

  /**
   * Resolve the current user's role for a specific team.
   * Always derive role from the target team to avoid cross-team permission leaks.
   */
  const resolveActorRoleForTeam = (
    teamId: string
  ): IMembershipRole | null | undefined => {
    if (!currentUser.value) return null
    return membershipsByTeamId.value.get(teamId)?.role
  }

  /**
   * Resolve a membership for the target team without relying on currentTeam context.
   */
  const resolveMembershipForTeamUser = async (
    teamId: string,
    userId: string
  ): Promise<IMembership | null> => {
    if (currentTeamId.value === teamId) {
      return teamMembersByUserId.value.get(userId) ?? null
    }

    const membershipSnap = await getDoc(getMembershipRef(teamId, userId))
    if (!membershipSnap.exists()) return null
    // Snapshot is already validated against membershipDocDataSchema by the
    // converter on getMembershipRef; re-parse against the stricter
    // membershipSchema to confirm denormalized user/team snapshots are
    // fully populated before returning to the caller.
    return parseSafe(
      membershipSchema,
      membershipSnap.data(),
      `membership:${membershipSnap.ref.path}`
    )
  }

  /**
   * Resolve multiple memberships for a target team without relying on currentTeam context.
   */
  const resolveMembershipsForTeamUsers = async (
    teamId: string,
    userIds: string[]
  ): Promise<IMembership[]> => {
    if (currentTeamId.value === teamId) {
      const userIdSet = new Set(userIds)
      return teamMembers.value.filter((member) => userIdSet.has(member.userId))
    }

    const snapshots = await Promise.all(
      userIds.map((userId) => getDoc(getMembershipRef(teamId, userId)))
    )
    return snapshots
      .filter((snapshot) => snapshot.exists())
      .map((snapshot) =>
        parseSafe(
          membershipSchema,
          snapshot.data(),
          `membership:${snapshot.ref.path}`
        )
      )
      .filter((m): m is IMembership => m !== null)
  }

  // ============================================================================
  // Team Member Counts - Reactive map of team ID to member count
  // ============================================================================

  /** Cache of member counts for each team */
  const teamMemberCounts = ref<Record<string, number>>({})
  let latestMemberCountRequestId = 0

  /** Get member count for a specific team */
  const getTeamMemberCount = (teamId: string): number => {
    return teamMemberCounts.value[teamId] ?? 1
  }

  const fetchSingleTeamMemberCount = async (
    teamId: string
  ): Promise<number> => {
    // If this is the current team and members are loaded, use local count
    if (currentTeamId.value === teamId && !_vuefireTeamMembers.pending.value) {
      return Math.max(teamMembers.value.length, 1)
    }

    const membersCollection = getTeamMembershipsCollection(teamId)

    try {
      const countSnapshot = await getCountFromServer(membersCollection)
      return Math.max(countSnapshot.data().count, 1)
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return 1
      }

      try {
        const membersSnapshot = await getDocsCached(membersCollection)
        return Math.max(membersSnapshot.size, 1)
      } catch (fallbackError) {
        if (isPermissionDeniedError(fallbackError)) {
          return 1
        }

        throw fallbackError
      }
    }
  }

  /** Fetch member counts for all teams the user is a member of */
  async function fetchTeamMemberCounts() {
    const requestId = ++latestMemberCountRequestId
    const teamIds = [...new Set(memberships.value.map((m) => m.teamId))].sort()

    if (teamIds.length === 0) {
      if (requestId === latestMemberCountRequestId) {
        teamMemberCounts.value = {}
      }
      return
    }

    const counts: Record<string, number> = {}
    teamIds.forEach((teamId) => {
      counts[teamId] = 1
    })

    // We cannot use collectionGroup("memberships").where("teamId", "in", ...)
    // here because security rules only allow reads on membership docs owned by
    // the signed-in user in collectionGroup queries. Count each team directly.
    await Promise.all(
      teamIds.map(async (teamId) => {
        try {
          counts[teamId] = await fetchSingleTeamMemberCount(teamId)
        } catch (error) {
          if (isPermissionDeniedError(error)) {
            counts[teamId] = 1
            return
          }

          console.error(
            `[membershipStore] Failed to fetch member count for team ${teamId}:`,
            error
          )
          counts[teamId] = 1
        }
      })
    )

    teamIds.forEach((teamId) => {
      if ((counts[teamId] ?? 0) <= 0) {
        counts[teamId] = 1
      }
    })

    if (requestId !== latestMemberCountRequestId) return
    teamMemberCounts.value = counts
  }

  // Fetch member counts when memberships change
  watch(
    () => [...new Set(memberships.value.map((m) => m.teamId))].sort().join(","),
    () => {
      void fetchTeamMemberCounts()
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
    latestMemberCountRequestId += 1
    teamMemberCounts.value = {}
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
    if (!isMembershipRole(role)) {
      throw new Error("Invalid invitation role")
    }

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
    const isCurrentTeamTarget = currentTeamId.value === teamId
    const actorRole = resolveActorRoleForTeam(teamId)
    if (
      !can(currentUser.value, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new Error("You do not have permission to change member roles")
    }

    const targetMembership = await resolveMembershipForTeamUser(teamId, userId)
    if (
      actorRole !== "owner" &&
      (newRole === "owner" || targetMembership?.role === "owner")
    ) {
      throw new Error("Only team owners can manage owner roles")
    }

    const membershipKey = `${teamId}-${userId}`
    const previousTeamMembers = isCurrentTeamTarget
      ? cloneState(teamMembers.value)
      : []

    await withOptimisticUpdate(
      pendingMembershipIds,
      membershipKey,
      // Apply optimistic update
      () => {
        if (isCurrentTeamTarget) {
          optimisticTeamMembers.value = teamMembers.value.map((m) =>
            m.userId === userId ? { ...m, role: newRole } : m
          )
        }
      },
      // Rollback on error
      () => {
        if (isCurrentTeamTarget) {
          optimisticTeamMembers.value = previousTeamMembers
        }
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

    const isCurrentTeamTarget = currentTeamId.value === teamId
    const actorRole = resolveActorRoleForTeam(teamId)

    // If removing someone else, check permissions
    if (userId !== currentUser.value.uid) {
      if (
        !can(currentUser.value, Capabilities.REMOVE_MEMBER, {
          scope: "team",
          teamRole: actorRole,
        })
      ) {
        throw new Error("You do not have permission to remove members")
      }
    }

    const targetMembership = await resolveMembershipForTeamUser(teamId, userId)
    if (targetMembership?.role === "owner" && actorRole !== "owner") {
      throw new Error("Only team owners can remove owners")
    }

    const membershipKey = `${teamId}-${userId}`
    const previousTeamMembers = isCurrentTeamTarget
      ? cloneState(teamMembers.value)
      : []
    const previousMemberships = cloneState(memberships.value)
    const previousCurrentTeamId = currentTeamId.value

    const isRemovingSelf = userId === currentUser.value.uid
    const isRemovingSelfFromCurrentTeam = isRemovingSelf && isCurrentTeamTarget

    await withOptimisticUpdate(
      pendingMembershipIds,
      membershipKey,
      // Apply optimistic update
      () => {
        if (isCurrentTeamTarget) {
          optimisticTeamMembers.value = teamMembers.value.filter(
            (m) => m.userId !== userId
          )
        }

        if (isRemovingSelf) {
          addPending(pendingUserIds, userId)
          optimisticMemberships.value = memberships.value.filter(
            (m) => m.teamId !== teamId
          )
          if (isRemovingSelfFromCurrentTeam && userProfile.value) {
            authStore.setCurrentTeamIdLocal(null)
          }
        }
      },
      // Rollback on error
      () => {
        if (isCurrentTeamTarget) {
          optimisticTeamMembers.value = previousTeamMembers
        }
        optimisticMemberships.value = previousMemberships
        if (isRemovingSelfFromCurrentTeam) {
          authStore.setCurrentTeamIdLocal(previousCurrentTeamId ?? null)
        }
      },
      // Cloud Function call
      async () => {
        try {
          await removeMemberFn({ teamId, userId })
        } finally {
          if (isRemovingSelf) {
            removePending(pendingUserIds, userId)
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
    const isCurrentTeamTarget = currentTeamId.value === teamId
    const currentUserId = currentUser.value.uid
    const actorRole = resolveActorRoleForTeam(teamId)

    if (
      !can(currentUser.value, Capabilities.REMOVE_MEMBER, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new Error("You do not have permission to remove members")
    }

    if (!userIds || userIds.length === 0) return

    const userIdSet = new Set(userIds)
    const targetMemberships = await resolveMembershipsForTeamUsers(
      teamId,
      userIds
    )
    const includesOwner = targetMemberships.some(
      (member) => member.role === "owner"
    )
    if (includesOwner && actorRole !== "owner") {
      throw new Error("Only team owners can remove owners")
    }
    const membershipKeys = userIds.map((userId) => `${teamId}-${userId}`)
    const previousTeamMembers = isCurrentTeamTarget
      ? cloneState(teamMembers.value)
      : []
    const previousMemberships = cloneState(memberships.value)
    const previousCurrentTeamId = currentTeamId.value

    const isRemovingSelf = userIds.includes(currentUserId)
    const isRemovingSelfFromCurrentTeam = isRemovingSelf && isCurrentTeamTarget

    await withCloudSyncOperation(
      async () => {
        try {
          // Mark all membership keys as pending
          membershipKeys.forEach((k) => addPending(pendingMembershipIds, k))

          // Apply optimistic updates
          if (isCurrentTeamTarget) {
            optimisticTeamMembers.value = teamMembers.value.filter(
              (m) => !userIdSet.has(m.userId)
            )
          }

          if (isRemovingSelf) {
            addPending(pendingUserIds, currentUserId)
            optimisticMemberships.value = memberships.value.filter(
              (m) => m.teamId !== teamId
            )
            if (isRemovingSelfFromCurrentTeam && userProfile.value) {
              authStore.setCurrentTeamIdLocal(null)
            }
          }

          // Cloud Function call
          await removeMembersFn({ teamId, userIds })
        } catch (error) {
          // Rollback optimistic state on error
          if (isCurrentTeamTarget) {
            optimisticTeamMembers.value = previousTeamMembers
          }
          optimisticMemberships.value = previousMemberships
          if (isRemovingSelfFromCurrentTeam) {
            authStore.setCurrentTeamIdLocal(previousCurrentTeamId ?? null)
          }
          throw error
        } finally {
          // Clear pending flags
          if (isRemovingSelf) {
            removePending(pendingUserIds, currentUserId)
          }
          membershipKeys.forEach((k) => removePending(pendingMembershipIds, k))
        }
      },
      {
        id: `${teamId}:${userIds.join(",")}`,
        source: "membership.removeMembers",
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

    const now = Timestamp.now()
    const newMembership: IMembership = {
      userId: currentUser.value.uid,
      teamId,
      role: "owner",
      user: userProfile.value,
      team,
      createdAt: now,
      updatedAt: now,
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
    if (currentTeamId.value === teamId && !_vuefireTeamMembers.pending.value) {
      return cloneState(teamMembers.value)
    }

    try {
      const membersSnapshot = await getDocsCached(
        getTeamMembershipsCollection(teamId)
      )
      return membersSnapshot.docs
        .map((doc) =>
          parseSafe(membershipSchema, doc.data(), `membership:${doc.ref.path}`)
        )
        .filter((m): m is IMembership => m !== null)
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
      const snapshot = await getDocsCached(q)
      return snapshot.docs
        .map((doc) =>
          parseSafe(membershipSchema, doc.data(), `membership:${doc.ref.path}`)
        )
        .filter((m): m is IMembership => m !== null)
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

/**
 * Membership Store - Team Memberships and Role Management
 *
 * Handles:
 * - Team memberships (user's teams they belong to)
 * - Team members (members of the current team)
 * - Role management (owner, admin, member)
 * - Invite/remove members
 *
 * Reactive Firestore reads flow through TanStack Query (onSnapshot-backed).
 * All mutations go through Cloud Functions for automatic audit logging.
 */

import {
  addTeamAgentMember as addTeamAgentMemberFn,
  assignRoleToUser as assignRoleToUserFn,
  removeMember as removeMemberFn,
  removeMembers as removeMembersFn,
  removeTeamAgentMember as removeTeamAgentMemberFn,
  sendInvitation as sendInvitationFn,
} from "@/composables/useFunctions"
import { defaultTeamRole } from "@/helpers/defaults"
import { queryClient } from "@/modules/queryClient"
import { parseSafe } from "@/schemas/_utils"
import { membershipSchema, teamMemberSchema } from "@/schemas/membership"
import { useAuthStore } from "@/stores/authStore"
import type { ITeam } from "@/types/domain"
import {
  isAgentMembership,
  isMembershipRole,
  isUserMembership,
  type IAgentMembership,
  type IMembership,
  type IMembershipAgentSnapshot,
  type IMembershipRole,
  type ITeamMember,
} from "@/types/membership"
import { can, Capabilities, hasExactRole } from "@/types/permissions"
import { getDocsCached } from "@/utils/firebase/firebase-cache"
import {
  getAllMembershipsGroup,
  getMembershipRef,
  getTeamMembershipsCollection,
} from "@/utils/firebase/firebase-helpers"
import { useFirestoreMutation } from "@/utils/firebase/firebase-mutation"
import {
  addPending,
  cloneState,
  createPendingSet,
  removePending,
} from "@/utils/firebase/firebase-optimistic"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
import {
  getCountFromServer,
  getDoc,
  getDocsFromCache,
  query,
  Timestamp,
  where,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, ref, shallowRef } from "vue"

// Helper to get ownership count (used for ownerCount computed property)
const getOwnerCount = (members: ITeamMember[]) =>
  members.filter((m) => m.role === "owner").length

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
  // Realtime Firestore bindings (TanStack Query)
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

  // Realtime collection binding (TanStack Query + onSnapshot) for memberships.
  // `membershipsQueryRef` is a collectionGroup query (no `.path`), so the cache
  // identity is a synthetic "memberships" group key disambiguated by userId.
  const membershipsQuery = useCollectionQuery<IMembership>(() => {
    const query = membershipsQueryRef.value
    const uid = currentUser.value?.uid
    return query && uid
      ? { query, path: "memberships", params: { userId: uid } }
      : null
  })
  const firestoreMemberships: ComputedRef<IMembership[]> = computed(
    () => membershipsQuery.data.value ?? []
  )

  // ============================================================================
  // State (for optimistic updates) — declared early so teamMembersQueryRef
  // guard can check membership without a forward reference to the merged computed.
  // ============================================================================

  // Pending operation tracking (per-membership-key; drives `isMembershipPending`).
  const pendingMembershipIds = shallowRef(createPendingSet())

  // Cache keys matching the realtime read queries. Per-mutation optimism writes
  // the optimistic value directly into these cache entries and holds them until
  // the server-applied snapshot reconciles (see runMembershipMutation).
  const membershipsCacheKey = (): FirestoreQueryKey | null =>
    currentUser.value
      ? queryKeys.list("memberships", { userId: currentUser.value.uid })
      : null
  const teamMembersCacheKey = (teamId: string): FirestoreQueryKey =>
    queryKeys.list(`teams/${teamId}/memberships`)

  const readMemberships = (): IMembership[] => {
    const key = membershipsCacheKey()
    return key ? (queryClient.getQueryData<IMembership[]>(key) ?? []) : []
  }
  const readTeamMembers = (teamId: string): ITeamMember[] =>
    queryClient.getQueryData<ITeamMember[]>(teamMembersCacheKey(teamId)) ?? []

  // One mutation drives every membership/teamMember list write. Callers pass the
  // affected cache key(s) + optimistic apply/rollback + the Cloud Function call.
  const membershipMutation = useFirestoreMutation<
    {
      keys: FirestoreQueryKey[]
      apply: () => void
      rollback: () => void
      run: () => Promise<void>
    },
    void
  >({
    mutationFn: (vars) => vars.run(),
    optimistic: (vars) => ({
      keys: vars.keys,
      apply: vars.apply,
      rollback: vars.rollback,
    }),
    source: "membership",
  })

  const runMembershipMutation = (
    keys: FirestoreQueryKey[],
    apply: () => void,
    rollback: () => void,
    run: () => Promise<void>
  ): Promise<void> =>
    membershipMutation.mutateAsync({ keys, apply, rollback, run })

  // Query for team members - null when no team selected

  const teamMembersQueryRef = computed(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null

    // Guard: Ensure user is a member of the team before trying to list its members.
    // This prevents the "Missing or insufficient permissions" error.
    // Uses firestoreMemberships (not merged `memberships` computed) to avoid forward reference
    // during cold-start hydration when currentTeamId may already be set from localStorage cache.
    const isMember = firestoreMemberships.value.some((m) => m.teamId === teamId)
    if (!isMember) return null

    return getTeamMembershipsCollection(teamId)
  })

  // Realtime collection binding (TanStack Query + onSnapshot) for team members.
  const teamMembersQuery = useCollectionQuery<ITeamMember>(() => {
    const query = teamMembersQueryRef.value
    return query ? { query, path: query.path } : null
  })
  const firestoreTeamMembers: ComputedRef<ITeamMember[]> = computed(
    () => teamMembersQuery.data.value ?? []
  )

  // ============================================================================
  // Computed - Merged State
  // ============================================================================

  /** All memberships for the current user (straight from the realtime cache). */
  const memberships = computed(() => firestoreMemberships.value)

  /** Members of the currently selected team (straight from the realtime cache). */
  const teamMembers = computed(() =>
    currentTeamId.value ? firestoreTeamMembers.value : []
  )

  // ============================================================================
  // Computed
  // ============================================================================

  const isLoading = computed(() => membershipsQuery.isLoading.value)

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
    () =>
      new Map(
        teamMembers.value
          .filter(isUserMembership)
          .map((member) => [member.userId, member])
      )
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
      return teamMembers.value
        .filter(isUserMembership)
        .filter((member) => userIdSet.has(member.userId))
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
  const TEAM_MEMBER_COUNT_REFRESH_DELAY_MS = 300
  const TEAM_MEMBER_COUNT_BATCH_SIZE = 4
  let latestMemberCountRequestId = 0
  let teamMemberCountRefreshTimer: ReturnType<typeof setTimeout> | null = null

  const getMembershipTeamIds = () =>
    [
      ...new Set(memberships.value.map((membership) => membership.teamId)),
    ].sort()

  const syncCurrentTeamMemberCount = () => {
    const teamId = currentTeamId.value
    if (!teamId || teamMembersQuery.isLoading.value) return

    const nextCount = Math.max(teamMembers.value.length, 1)
    if (teamMemberCounts.value[teamId] === nextCount) return

    teamMemberCounts.value = {
      ...teamMemberCounts.value,
      [teamId]: nextCount,
    }
  }

  /** Get member count for a specific team */
  const getTeamMemberCount = (teamId: string): number => {
    if (currentTeamId.value === teamId && !teamMembersQuery.isLoading.value) {
      return Math.max(teamMembers.value.length, 1)
    }

    return teamMemberCounts.value[teamId] ?? 1
  }

  const fetchSingleTeamMemberCount = async (
    teamId: string
  ): Promise<number> => {
    // If this is the current team and members are loaded, use local count
    if (currentTeamId.value === teamId && !teamMembersQuery.isLoading.value) {
      return Math.max(teamMembers.value.length, 1)
    }

    const membersCollection = getTeamMembershipsCollection(teamId)

    try {
      const cachedMembersSnapshot = await getDocsFromCache(membersCollection)
      return Math.max(cachedMembersSnapshot.size, 1)
    } catch {
      // Cache miss - fall through to server-backed counting below.
    }

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
  async function fetchTeamMemberCounts(teamIds = getMembershipTeamIds()) {
    const requestId = ++latestMemberCountRequestId
    const uniqueTeamIds = [...new Set(teamIds)].sort()

    if (uniqueTeamIds.length === 0) {
      if (requestId === latestMemberCountRequestId) {
        teamMemberCounts.value = {}
      }
      return
    }

    const counts: Record<string, number> = {}
    uniqueTeamIds.forEach((teamId) => {
      counts[teamId] = teamMemberCounts.value[teamId] ?? 1
    })

    // We cannot use collectionGroup("memberships").where("teamId", "in", ...)
    // here because security rules only allow reads on membership docs owned by
    // the signed-in user in collectionGroup queries. Count each team directly,
    // but in small batches so startup doesn't fan out a request storm.
    for (
      let index = 0;
      index < uniqueTeamIds.length;
      index += TEAM_MEMBER_COUNT_BATCH_SIZE
    ) {
      const batch = uniqueTeamIds.slice(
        index,
        index + TEAM_MEMBER_COUNT_BATCH_SIZE
      )

      await Promise.all(
        batch.map(async (teamId) => {
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

      if (requestId !== latestMemberCountRequestId) return
    }

    uniqueTeamIds.forEach((teamId) => {
      if ((counts[teamId] ?? 0) <= 0) {
        counts[teamId] = 1
      }
    })

    if (requestId !== latestMemberCountRequestId) return
    teamMemberCounts.value = counts
  }

  const scheduleTeamMemberCountsRefresh = () => {
    const teamIds = getMembershipTeamIds()

    if (teamMemberCountRefreshTimer) {
      clearTimeout(teamMemberCountRefreshTimer)
      teamMemberCountRefreshTimer = null
    }

    if (teamIds.length === 0) {
      latestMemberCountRequestId += 1
      teamMemberCounts.value = {}
      return
    }

    teamMemberCountRefreshTimer = setTimeout(() => {
      teamMemberCountRefreshTimer = null
      void fetchTeamMemberCounts(teamIds)
    }, TEAM_MEMBER_COUNT_REFRESH_DELAY_MS)
  }

  // Fetch member counts when memberships change
  watch(
    () => [...new Set(memberships.value.map((m) => m.teamId))].sort().join(","),
    () => {
      scheduleTeamMemberCountsRefresh()
    },
    { immediate: true }
  )

  watch(
    [
      currentTeamId,
      firestoreTeamMembers,
      () => teamMembersQuery.isLoading.value,
    ],
    () => {
      syncCurrentTeamMemberCount()
    },
    { immediate: true }
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  function cleanup() {
    latestMemberCountRequestId += 1
    if (teamMemberCountRefreshTimer) {
      clearTimeout(teamMemberCountRefreshTimer)
      teamMemberCountRefreshTimer = null
    }
    teamMemberCounts.value = {}
    // Read state lives in the query cache (cleared centrally on logout); realtime
    // listeners are torn down automatically once their queries go unused (gc).
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
    const mKey = membershipsCacheKey()
    if (mKey) {
      queryClient.setQueryData<IMembership[]>(mKey, [
        ...readMemberships(),
        membership,
      ])
    }
    queryClient.setQueryData<ITeamMember[]>(
      teamMembersCacheKey(membership.teamId),
      [membership]
    )
  }

  /**
   * Update team data in memberships (used by teamStore when updating teams)
   */
  function updateTeamInMemberships(
    teamId: string,
    teamUpdates: Partial<ITeam>
  ) {
    const mKey = membershipsCacheKey()
    if (!mKey) return
    queryClient.setQueryData<IMembership[]>(
      mKey,
      readMemberships().map((m) =>
        m.teamId === teamId && m.team
          ? { ...m, team: { ...m.team, ...teamUpdates } }
          : m
      )
    )
  }

  /**
   * Remove memberships for a team (used by teamStore when deleting teams)
   */
  function removeMembershipsForTeam(teamId: string) {
    const mKey = membershipsCacheKey()
    if (!mKey) return
    queryClient.setQueryData<IMembership[]>(
      mKey,
      readMemberships().filter((m) => m.teamId !== teamId)
    )
  }

  /**
   * Clear the current team's members (used when deleting/exiting the team)
   */
  function clearTeamMembers() {
    const teamId = currentTeamId.value
    if (teamId) {
      queryClient.setQueryData<ITeamMember[]>(teamMembersCacheKey(teamId), [])
    }
  }

  /**
   * Rollback memberships to a prior cache snapshot
   */
  function rollbackMemberships(previousMemberships: IMembership[]) {
    const mKey = membershipsCacheKey()
    if (mKey) queryClient.setQueryData(mKey, previousMemberships)
  }

  /**
   * Rollback the current team's members to a prior cache snapshot
   */
  function rollbackTeamMembers(previousTeamMembers: ITeamMember[]) {
    const teamId = currentTeamId.value
    if (teamId) {
      queryClient.setQueryData(teamMembersCacheKey(teamId), previousTeamMembers)
    }
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
    const teamKey = teamMembersCacheKey(teamId)
    const previousTeamMembers = isCurrentTeamTarget
      ? readTeamMembers(teamId)
      : []

    markPending(membershipKey)
    try {
      await runMembershipMutation(
        isCurrentTeamTarget ? [teamKey] : [],
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData<ITeamMember[]>(
              teamKey,
              readTeamMembers(teamId).map((m) =>
                isUserMembership(m) && m.userId === userId
                  ? { ...m, role: newRole }
                  : m
              )
            )
          }
        },
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData(teamKey, previousTeamMembers)
          }
        },
        async () => {
          await assignRoleToUserFn({ teamId, userId, role: newRole })
        }
      )
    } finally {
      setTimeout(() => clearPending(membershipKey), 120)
    }
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
    const teamKey = teamMembersCacheKey(teamId)
    const mKey = membershipsCacheKey()
    const previousTeamMembers = isCurrentTeamTarget
      ? readTeamMembers(teamId)
      : []
    const previousMemberships = readMemberships()
    const previousCurrentTeamId = currentTeamId.value

    const isRemovingSelf = userId === currentUser.value.uid
    const isRemovingSelfFromCurrentTeam = isRemovingSelf && isCurrentTeamTarget

    const keys: FirestoreQueryKey[] = []
    if (isCurrentTeamTarget) keys.push(teamKey)
    if (isRemovingSelf && mKey) keys.push(mKey)

    markPending(membershipKey)
    if (isRemovingSelf) addPending(pendingUserIds, userId)
    try {
      await runMembershipMutation(
        keys,
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData<ITeamMember[]>(
              teamKey,
              readTeamMembers(teamId).filter(
                (m) => isAgentMembership(m) || m.userId !== userId
              )
            )
          }
          if (isRemovingSelf) {
            if (mKey) {
              queryClient.setQueryData<IMembership[]>(
                mKey,
                readMemberships().filter((m) => m.teamId !== teamId)
              )
            }
            if (isRemovingSelfFromCurrentTeam && userProfile.value) {
              authStore.setCurrentTeamIdLocal(null)
            }
          }
        },
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData(teamKey, previousTeamMembers)
          }
          if (mKey) queryClient.setQueryData(mKey, previousMemberships)
          if (isRemovingSelfFromCurrentTeam) {
            authStore.setCurrentTeamIdLocal(previousCurrentTeamId ?? null)
          }
        },
        async () => {
          await removeMemberFn({ teamId, userId })
        }
      )
    } finally {
      if (isRemovingSelf) removePending(pendingUserIds, userId)
      setTimeout(() => clearPending(membershipKey), 120)
    }
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
    const teamKey = teamMembersCacheKey(teamId)
    const mKey = membershipsCacheKey()
    const previousTeamMembers = isCurrentTeamTarget
      ? readTeamMembers(teamId)
      : []
    const previousMemberships = readMemberships()
    const previousCurrentTeamId = currentTeamId.value

    const isRemovingSelf = userIds.includes(currentUserId)
    const isRemovingSelfFromCurrentTeam = isRemovingSelf && isCurrentTeamTarget

    const keys: FirestoreQueryKey[] = []
    if (isCurrentTeamTarget) keys.push(teamKey)
    if (isRemovingSelf && mKey) keys.push(mKey)

    membershipKeys.forEach((key) => markPending(key))
    if (isRemovingSelf) addPending(pendingUserIds, currentUserId)
    try {
      await runMembershipMutation(
        keys,
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData<ITeamMember[]>(
              teamKey,
              readTeamMembers(teamId).filter(
                (m) => isAgentMembership(m) || !userIdSet.has(m.userId)
              )
            )
          }
          if (isRemovingSelf) {
            if (mKey) {
              queryClient.setQueryData<IMembership[]>(
                mKey,
                readMemberships().filter((m) => m.teamId !== teamId)
              )
            }
            if (isRemovingSelfFromCurrentTeam && userProfile.value) {
              authStore.setCurrentTeamIdLocal(null)
            }
          }
        },
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData(teamKey, previousTeamMembers)
          }
          if (mKey) queryClient.setQueryData(mKey, previousMemberships)
          if (isRemovingSelfFromCurrentTeam) {
            authStore.setCurrentTeamIdLocal(previousCurrentTeamId ?? null)
          }
        },
        async () => {
          await removeMembersFn({ teamId, userIds })
        }
      )
    } finally {
      if (isRemovingSelf) removePending(pendingUserIds, currentUserId)
      membershipKeys.forEach((key) => setTimeout(() => clearPending(key), 120))
    }
  }

  /**
   * Add an agent (custom or built-in) to the team as a member. Agents are
   * always added with the "member" role and there's no invitation
   * handshake — the membership is written directly via Cloud Function. The
   * optimistic row borrows the team snapshot from the actor's own
   * membership so the list updates instantly; if that's unavailable we
   * skip the optimistic insert and let the Firestore subscription catch up.
   */
  async function addAgentMember(
    teamId: string,
    agentId: string,
    agentSnapshot: IMembershipAgentSnapshot
  ): Promise<void> {
    if (!currentUser.value) return

    const actorRole = resolveActorRoleForTeam(teamId)
    if (
      !can(currentUser.value, Capabilities.INVITE_MEMBER, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new Error("You do not have permission to add agents")
    }

    const isCurrentTeamTarget = currentTeamId.value === teamId
    const key = `${teamId}-agent:${agentId}`
    const teamKey = teamMembersCacheKey(teamId)
    const previousTeamMembers = isCurrentTeamTarget
      ? readTeamMembers(teamId)
      : []
    const teamSnapshot = membershipsByTeamId.value.get(teamId)?.team

    markPending(key)
    try {
      await runMembershipMutation(
        isCurrentTeamTarget && teamSnapshot ? [teamKey] : [],
        () => {
          if (!isCurrentTeamTarget || !teamSnapshot) return
          const now = Timestamp.now()
          const optimisticMember: IAgentMembership = {
            kind: "agent",
            agentId,
            teamId,
            role: "member",
            agent: agentSnapshot,
            team: teamSnapshot,
            createdAt: now,
            updatedAt: now,
          }
          queryClient.setQueryData<ITeamMember[]>(teamKey, [
            ...readTeamMembers(teamId),
            optimisticMember,
          ])
        },
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData(teamKey, previousTeamMembers)
          }
        },
        async () => {
          await addTeamAgentMemberFn({ teamId, agentId })
        }
      )
    } finally {
      setTimeout(() => clearPending(key), 120)
    }
  }

  /**
   * Remove an agent membership from the team. Leaves the underlying agent
   * persona (custom doc / built-in) intact — only the membership row goes.
   */
  async function removeAgentMember(
    teamId: string,
    agentId: string
  ): Promise<void> {
    if (!currentUser.value) return

    const actorRole = resolveActorRoleForTeam(teamId)
    if (
      !can(currentUser.value, Capabilities.REMOVE_MEMBER, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new Error("You do not have permission to remove agents")
    }

    const isCurrentTeamTarget = currentTeamId.value === teamId
    const key = `${teamId}-agent:${agentId}`
    const teamKey = teamMembersCacheKey(teamId)
    const previousTeamMembers = isCurrentTeamTarget
      ? readTeamMembers(teamId)
      : []

    markPending(key)
    try {
      await runMembershipMutation(
        isCurrentTeamTarget ? [teamKey] : [],
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData<ITeamMember[]>(
              teamKey,
              readTeamMembers(teamId).filter(
                (member) =>
                  !(isAgentMembership(member) && member.agentId === agentId)
              )
            )
          }
        },
        () => {
          if (isCurrentTeamTarget) {
            queryClient.setQueryData(teamKey, previousTeamMembers)
          }
        },
        async () => {
          await removeTeamAgentMemberFn({ teamId, agentId })
        }
      )
    } finally {
      setTimeout(() => clearPending(key), 120)
    }
  }

  /**
   * Build an owner membership object for a newly created team. Pure/synchronous
   * — it performs no I/O, so it isn't `async` (callers shouldn't have to await a
   * plain object construction).
   */
  function createOwnerMembership(teamId: string, team: ITeam): IMembership {
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
  async function getMembersForTeam(teamId: string): Promise<ITeamMember[]> {
    if (currentTeamId.value === teamId && !teamMembersQuery.isLoading.value) {
      return cloneState(teamMembers.value)
    }

    try {
      const membersSnapshot = await getDocsCached(
        getTeamMembershipsCollection(teamId)
      )
      return membersSnapshot.docs
        .map((doc) =>
          parseSafe(teamMemberSchema, doc.data(), `membership:${doc.ref.path}`)
        )
        .filter((m): m is ITeamMember => m !== null)
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
    addAgentMember,
    removeAgentMember,
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

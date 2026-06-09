/**
 * Membership Store — the signed-in user's team memberships + the current team's
 * member roster.
 *
 * Responsibilities:
 * - `memberships`  — every team the user belongs to (collectionGroup read).
 * - `teamMembers`  — the current team's members (human + agent rows).
 * - Role-derived permission flags for the current team.
 * - Member mutations: invite, change role, remove, add/remove agent members.
 * - Per-team member-count cache for surfaces that show counts without switching
 *   into the team.
 * - Cache helpers consumed by teamStore (the team doc denormalizes onto each
 *   membership row, so team writes must patch the memberships list too).
 *
 * Reads flow through TanStack Query (onSnapshot-backed); mutations go through
 * Cloud Functions (audit logging) wrapped in the optimistic cache layer.
 */

import {
  addTeamAgentMember as addTeamAgentMemberFn,
  assignRoleToUser as assignRoleToUserFn,
  removeMember as removeMemberFn,
  removeMembers as removeMembersFn,
  removeTeamAgentMember as removeTeamAgentMemberFn,
} from "@/composables/useFunctions"
import { queryClient } from "@/modules/queryClient"
import { parseSafe } from "@/schemas/_utils"
import { membershipSchema, teamMemberSchema } from "@/schemas/membership"
import { useAuthStore } from "@/stores/authStore"
import type { ITeam } from "@/types/domain"
import {
  isAgentMembership,
  isUserMembership,
  type IAgentMembership,
  type IMembership,
  type IMembershipAgentSnapshot,
  type IMembershipRole,
  type IMembershipWorkspaceRecord,
  type ITeamMember,
} from "@/types/membership"
import {
  can,
  Capabilities,
  effectiveRole,
  hasExactRole,
} from "@/types/permissions"
import { getDocsCached } from "@/utils/firebase/firebase-cache"
import {
  getAllMembershipsGroup,
  getMembershipRef,
  getMembershipWorkspacesCollection,
  getTeamMembershipsCollection,
} from "@/utils/firebase/firebase-helpers"
import { useRunWrite } from "@/utils/firebase/firebase-mutation"
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

const countOwners = (members: ITeamMember[]) =>
  members.filter((m) => m.role === "owner").length

const isPermissionDenied = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "permission-denied"

export const useMembershipStore = defineStore("memberships", () => {
  const authStore = useAuthStore()
  const { currentUser, userProfile, pendingUserIds, currentTeamId } =
    storeToRefs(authStore)

  // ── Realtime reads ──────────────────────────────────────────────────────────

  // The user's memberships across all teams (collectionGroup, no `.path`, so the
  // cache identity is a synthetic "memberships" group keyed by userId).
  const membershipsQuery = useCollectionQuery<IMembership>(() => {
    const uid = currentUser.value?.uid
    if (!uid) return null
    return {
      query: query(getAllMembershipsGroup(), where("userId", "==", uid)),
      path: "memberships",
      params: { userId: uid },
    }
  })
  const firestoreMemberships = computed(() => membershipsQuery.data.value ?? [])

  const pendingMembershipIds = shallowRef(createPendingSet())

  // Cache keys that mirror the realtime reads — optimistic writes target these
  // directly and the mutation layer holds them until the server snapshot lands.
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

  // The current team's member roster. Guarded on membership: listing a team's
  // members before we know the user belongs to it would hit a rules denial.
  // Uses firestoreMemberships (not the merged computed) to avoid a forward
  // reference during cold-start hydration.
  const teamMembersQuery = useCollectionQuery<ITeamMember>(() => {
    const teamId = currentTeamId.value
    if (!teamId) return null
    const isMember = firestoreMemberships.value.some((m) => m.teamId === teamId)
    if (!isMember) return null
    const collectionRef = getTeamMembershipsCollection(teamId)
    return { query: collectionRef, path: collectionRef.path }
  })
  const firestoreTeamMembers = computed(() => teamMembersQuery.data.value ?? [])

  // The signed-in user's OWN per-workspace role overrides for the current team
  // (`teams/{teamId}/memberships/{uid}/workspaces`). Each doc carries the
  // elevate-only direct `role` plus the denormalized group-derived `groupRole`;
  // the doc id is the workspace id. Lets workspace-scoped affordances honor a
  // per-workspace grant instead of collapsing to the team role. Guarded on
  // confirmed membership (mirroring teamMembersQuery) to avoid a rules denial
  // before we know the user belongs to the team. Most users have none, so this
  // is typically an empty, cheap listener.
  const myWorkspaceOverridesQuery =
    useCollectionQuery<IMembershipWorkspaceRecord>(() => {
      const teamId = currentTeamId.value
      const uid = currentUser.value?.uid
      if (!teamId || !uid) return null
      const isMember = firestoreMemberships.value.some(
        (m) => m.teamId === teamId
      )
      if (!isMember) return null
      const collectionRef = getMembershipWorkspacesCollection(teamId, uid)
      return { query: collectionRef, path: collectionRef.path }
    })

  // workspaceId → the user's elevate-only per-workspace role = max(direct
  // override, group-derived role). Absent entry = no elevation (use team role).
  const myWorkspaceRoleById = computed(() => {
    const map = new Map<string, IMembershipRole>()
    for (const rec of myWorkspaceOverridesQuery.data.value ?? []) {
      const role = effectiveRole(rec.role ?? null, rec.groupRole ?? null)
      if (role) map.set(rec.id, role)
    }
    return map
  })

  /**
   * The signed-in user's per-workspace role override for one workspace in the
   * current team (`null` = none). Feed into `can(…, { scope: "workspace",
   * teamRole, workspaceRole })`, which folds it over the team role elevate-only.
   */
  const getWorkspaceRoleOverride = (
    workspaceId: string
  ): IMembershipRole | null =>
    myWorkspaceRoleById.value.get(workspaceId) ?? null

  // ── Merged state ────────────────────────────────────────────────────────────
  const memberships = computed(() => firestoreMemberships.value)
  const teamMembers = computed(() =>
    currentTeamId.value ? firestoreTeamMembers.value : []
  )

  const isLoading = computed(() => membershipsQuery.isLoading.value)
  // Terminal failure of the collectionGroup read (e.g. token-warm-up
  // permission-denied). When errored, `memberships` is an empty fallback that
  // does NOT mean "the user has no teams" — consumers that act on absence
  // (stale-selection cleanup) must treat this as "unknown", not "confirmed".
  const isError = computed(() => membershipsQuery.isError.value)
  // True while serving localStorage-restored cache a live snapshot hasn't
  // reconfirmed — non-null but possibly behind the user's real membership set.
  const isStale = computed(() => membershipsQuery.isStale.value)
  const isMembershipPending = computed(
    () => (id: string) => pendingMembershipIds.value.has(id)
  )
  const hasAnyPendingOperation = computed(
    () => pendingMembershipIds.value.size > 0
  )

  const membershipsByTeamId = computed(
    () => new Map(memberships.value.map((m) => [m.teamId, m]))
  )
  const teamMembersByUserId = computed(
    () =>
      new Map(
        teamMembers.value
          .filter(isUserMembership)
          .map((member) => [member.userId, member])
      )
  )

  const getMembershipForTeam = computed(
    () => (teamId: string) => membershipsByTeamId.value.get(teamId)
  )

  const currentUserRole = computed(() => {
    if (!currentUser.value || !currentTeamId.value) return null
    const member = teamMembersByUserId.value.get(currentUser.value.uid)
    if (!member) return null
    return member.role
  })
  const isOwner = computed(() => hasExactRole(currentUserRole.value, "owner"))
  const isAdmin = computed(() => hasExactRole(currentUserRole.value, "admin"))
  const isMember = computed(() => hasExactRole(currentUserRole.value, "member"))

  const canManageWorkspaces = computed(() =>
    can(currentUser.value, Capabilities.CREATE_WORKSPACE, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )
  const canManageMembers = computed(() =>
    can(currentUser.value, Capabilities.INVITE_MEMBER, {
      scope: "team",
      teamRole: currentUserRole.value,
    })
  )
  const ownerCount = computed(() => countOwners(teamMembers.value))

  // ── Cross-team role/membership resolution ───────────────────────────────────
  // Always derive the actor's role from the TARGET team to avoid leaking the
  // current team's elevated role onto a mutation aimed at a different team.
  const resolveActorRoleForTeam = (
    teamId: string
  ): IMembershipRole | null | undefined =>
    currentUser.value ? membershipsByTeamId.value.get(teamId)?.role : null

  const resolveMembershipForTeamUser = async (
    teamId: string,
    userId: string
  ): Promise<IMembership | null> => {
    if (currentTeamId.value === teamId) {
      return teamMembersByUserId.value.get(userId) ?? null
    }
    const snap = await getDoc(getMembershipRef(teamId, userId))
    if (!snap.exists()) return null
    return parseSafe(
      membershipSchema,
      snap.data(),
      `membership:${snap.ref.path}`
    )
  }

  const resolveMembershipsForTeamUsers = async (
    teamId: string,
    userIds: string[]
  ): Promise<IMembership[]> => {
    if (currentTeamId.value === teamId) {
      const wanted = new Set(userIds)
      return teamMembers.value
        .filter(isUserMembership)
        .filter((member) => wanted.has(member.userId))
    }
    const snapshots = await Promise.all(
      userIds.map((userId) => getDoc(getMembershipRef(teamId, userId)))
    )
    return snapshots
      .filter((snap) => snap.exists())
      .map((snap) =>
        parseSafe(membershipSchema, snap.data(), `membership:${snap.ref.path}`)
      )
      .filter((m): m is IMembership => m !== null)
  }

  // ── Optimistic mutation runner ──────────────────────────────────────────────
  // Thin positional adapter over the shared `runWrite` seam. Kept (rather than
  // inlining at the 5 callsites) because membership's pending dance — batch
  // `pendingKeys`, the `isSelf` extra on `pendingUserIds`, and the exported
  // `markPending`/`clearPending` — is wired around the call by hand.
  const runWrite = useRunWrite("membership")
  const runMembershipMutation = (
    keys: FirestoreQueryKey[],
    apply: () => void,
    rollback: () => void,
    run: () => Promise<void>
  ): Promise<void> => runWrite({ keys, apply, rollback, fn: run })

  function markPending(key: string) {
    addPending(pendingMembershipIds, key)
  }
  function clearPending(key: string) {
    removePending(pendingMembershipIds, key)
  }

  // ── Member counts (per team, without switching) ─────────────────────────────
  const teamMemberCounts = ref<Record<string, number>>({})
  const COUNT_REFRESH_DELAY_MS = 300
  const COUNT_BATCH_SIZE = 4
  let latestCountRequestId = 0
  let countRefreshTimer: ReturnType<typeof setTimeout> | null = null

  const membershipTeamIds = () =>
    [...new Set(memberships.value.map((m) => m.teamId))].sort()

  const syncCurrentTeamCount = () => {
    const teamId = currentTeamId.value
    if (!teamId || teamMembersQuery.isLoading.value) return
    const next = Math.max(teamMembers.value.length, 1)
    if (teamMemberCounts.value[teamId] === next) return
    teamMemberCounts.value = { ...teamMemberCounts.value, [teamId]: next }
  }

  const getTeamMemberCount = (teamId: string): number => {
    if (currentTeamId.value === teamId && !teamMembersQuery.isLoading.value) {
      return Math.max(teamMembers.value.length, 1)
    }
    return teamMemberCounts.value[teamId] ?? 1
  }

  const fetchSingleTeamMemberCount = async (
    teamId: string
  ): Promise<number> => {
    if (currentTeamId.value === teamId && !teamMembersQuery.isLoading.value) {
      return Math.max(teamMembers.value.length, 1)
    }

    const collectionRef = getTeamMembershipsCollection(teamId)
    try {
      const cached = await getDocsFromCache(collectionRef)
      return Math.max(cached.size, 1)
    } catch {
      // Cache miss — fall through to the server count.
    }
    try {
      const counted = await getCountFromServer(collectionRef)
      return Math.max(counted.data().count, 1)
    } catch (error) {
      if (isPermissionDenied(error)) return 1
      try {
        const fallback = await getDocsCached(collectionRef)
        return Math.max(fallback.size, 1)
      } catch (fallbackError) {
        if (isPermissionDenied(fallbackError)) return 1
        throw fallbackError
      }
    }
  }

  async function fetchTeamMemberCounts(teamIds = membershipTeamIds()) {
    const requestId = ++latestCountRequestId
    const uniqueTeamIds = [...new Set(teamIds)].sort()

    if (uniqueTeamIds.length === 0) {
      if (requestId === latestCountRequestId) teamMemberCounts.value = {}
      return
    }

    const counts: Record<string, number> = {}
    uniqueTeamIds.forEach((teamId) => {
      counts[teamId] = teamMemberCounts.value[teamId] ?? 1
    })

    // Count teams directly in small batches (collectionGroup `teamId in [...]`
    // is blocked by rules — only own-membership docs are readable that way), so
    // startup doesn't fan out a request storm.
    for (let i = 0; i < uniqueTeamIds.length; i += COUNT_BATCH_SIZE) {
      const batch = uniqueTeamIds.slice(i, i + COUNT_BATCH_SIZE)
      await Promise.all(
        batch.map(async (teamId) => {
          try {
            counts[teamId] = await fetchSingleTeamMemberCount(teamId)
          } catch (error) {
            if (!isPermissionDenied(error)) {
              console.error(
                `[membershipStore] member count failed for ${teamId}:`,
                error
              )
            }
            counts[teamId] = 1
          }
        })
      )
      if (requestId !== latestCountRequestId) return
    }

    uniqueTeamIds.forEach((teamId) => {
      if ((counts[teamId] ?? 0) <= 0) counts[teamId] = 1
    })
    if (requestId !== latestCountRequestId) return
    teamMemberCounts.value = counts
  }

  const scheduleCountsRefresh = () => {
    const teamIds = membershipTeamIds()
    if (countRefreshTimer) {
      clearTimeout(countRefreshTimer)
      countRefreshTimer = null
    }
    if (teamIds.length === 0) {
      latestCountRequestId += 1
      teamMemberCounts.value = {}
      return
    }
    countRefreshTimer = setTimeout(() => {
      countRefreshTimer = null
      void fetchTeamMemberCounts(teamIds)
    }, COUNT_REFRESH_DELAY_MS)
  }

  watch(
    () => membershipTeamIds().join(","),
    () => scheduleCountsRefresh(),
    { immediate: true }
  )
  watch(
    [
      currentTeamId,
      firestoreTeamMembers,
      () => teamMembersQuery.isLoading.value,
    ],
    () => syncCurrentTeamCount(),
    { immediate: true }
  )

  // ── Cache helpers (used by teamStore) ───────────────────────────────────────
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

  function removeMembershipsForTeam(teamId: string) {
    const mKey = membershipsCacheKey()
    if (!mKey) return
    queryClient.setQueryData<IMembership[]>(
      mKey,
      readMemberships().filter((m) => m.teamId !== teamId)
    )
  }

  function clearTeamMembers() {
    const teamId = currentTeamId.value
    if (teamId) {
      queryClient.setQueryData<ITeamMember[]>(teamMembersCacheKey(teamId), [])
    }
  }

  function rollbackMemberships(previous: IMembership[]) {
    const mKey = membershipsCacheKey()
    if (mKey) queryClient.setQueryData(mKey, previous)
  }

  function rollbackTeamMembers(previous: ITeamMember[]) {
    const teamId = currentTeamId.value
    if (teamId) queryClient.setQueryData(teamMembersCacheKey(teamId), previous)
  }

  // ── Member mutations ────────────────────────────────────────────────────────
  async function changeRole(
    teamId: string,
    userId: string,
    newRole: IMembershipRole
  ): Promise<void> {
    const isCurrent = currentTeamId.value === teamId
    const actorRole = resolveActorRoleForTeam(teamId)
    if (
      !can(currentUser.value, Capabilities.UPDATE_MEMBER_ROLE, {
        scope: "team",
        teamRole: actorRole,
      })
    ) {
      throw new Error("You do not have permission to change member roles")
    }

    const target = await resolveMembershipForTeamUser(teamId, userId)
    if (
      actorRole !== "owner" &&
      (newRole === "owner" || target?.role === "owner")
    ) {
      throw new Error("Only team owners can manage owner roles")
    }

    const pendingKey = `${teamId}-${userId}`
    const teamKey = teamMembersCacheKey(teamId)
    const previousMembers = isCurrent ? readTeamMembers(teamId) : []

    markPending(pendingKey)
    try {
      await runMembershipMutation(
        isCurrent ? [teamKey] : [],
        () => {
          if (!isCurrent) return
          queryClient.setQueryData<ITeamMember[]>(
            teamKey,
            readTeamMembers(teamId).map((m) =>
              isUserMembership(m) && m.userId === userId
                ? { ...m, role: newRole }
                : m
            )
          )
        },
        () => {
          if (isCurrent) queryClient.setQueryData(teamKey, previousMembers)
        },
        async () => {
          await assignRoleToUserFn({ teamId, userId, role: newRole })
        }
      )
    } finally {
      setTimeout(() => clearPending(pendingKey), 120)
    }
  }

  async function removeMember(teamId: string, userId: string): Promise<void> {
    if (!currentUser.value) return

    const isCurrent = currentTeamId.value === teamId
    const actorRole = resolveActorRoleForTeam(teamId)
    const isSelf = userId === currentUser.value.uid

    if (!isSelf) {
      if (
        !can(currentUser.value, Capabilities.REMOVE_MEMBER, {
          scope: "team",
          teamRole: actorRole,
        })
      ) {
        throw new Error("You do not have permission to remove members")
      }
    }

    const target = await resolveMembershipForTeamUser(teamId, userId)
    if (target?.role === "owner" && actorRole !== "owner") {
      throw new Error("Only team owners can remove owners")
    }

    const pendingKey = `${teamId}-${userId}`
    const teamKey = teamMembersCacheKey(teamId)
    const mKey = membershipsCacheKey()
    const previousMembers = isCurrent ? readTeamMembers(teamId) : []
    const previousMemberships = readMemberships()
    const previousTeamId = currentTeamId.value
    const isSelfFromCurrent = isSelf && isCurrent

    const keys: FirestoreQueryKey[] = []
    if (isCurrent) keys.push(teamKey)
    if (isSelf && mKey) keys.push(mKey)

    markPending(pendingKey)
    if (isSelf) addPending(pendingUserIds, userId)
    try {
      await runMembershipMutation(
        keys,
        () => {
          if (isCurrent) {
            queryClient.setQueryData<ITeamMember[]>(
              teamKey,
              readTeamMembers(teamId).filter(
                (m) => isAgentMembership(m) || m.userId !== userId
              )
            )
          }
          if (isSelf) {
            if (mKey) {
              queryClient.setQueryData<IMembership[]>(
                mKey,
                readMemberships().filter((m) => m.teamId !== teamId)
              )
            }
            if (isSelfFromCurrent && userProfile.value) {
              authStore.setCurrentTeamIdLocal(null)
            }
          }
        },
        () => {
          if (isCurrent) queryClient.setQueryData(teamKey, previousMembers)
          if (mKey) queryClient.setQueryData(mKey, previousMemberships)
          if (isSelfFromCurrent) {
            authStore.setCurrentTeamIdLocal(previousTeamId ?? null)
          }
        },
        async () => {
          await removeMemberFn({ teamId, userId })
        }
      )
    } finally {
      if (isSelf) removePending(pendingUserIds, userId)
      setTimeout(() => clearPending(pendingKey), 120)
    }
  }

  async function removeMembers(
    teamId: string,
    userIds: string[]
  ): Promise<void> {
    if (!currentUser.value) return
    if (!userIds || userIds.length === 0) return

    const isCurrent = currentTeamId.value === teamId
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

    const wanted = new Set(userIds)
    const targets = await resolveMembershipsForTeamUsers(teamId, userIds)
    if (targets.some((m) => m.role === "owner") && actorRole !== "owner") {
      throw new Error("Only team owners can remove owners")
    }

    const pendingKeys = userIds.map((userId) => `${teamId}-${userId}`)
    const teamKey = teamMembersCacheKey(teamId)
    const mKey = membershipsCacheKey()
    const previousMembers = isCurrent ? readTeamMembers(teamId) : []
    const previousMemberships = readMemberships()
    const previousTeamId = currentTeamId.value

    const isSelf = userIds.includes(currentUserId)
    const isSelfFromCurrent = isSelf && isCurrent

    const keys: FirestoreQueryKey[] = []
    if (isCurrent) keys.push(teamKey)
    if (isSelf && mKey) keys.push(mKey)

    pendingKeys.forEach((key) => markPending(key))
    if (isSelf) addPending(pendingUserIds, currentUserId)
    try {
      await runMembershipMutation(
        keys,
        () => {
          if (isCurrent) {
            queryClient.setQueryData<ITeamMember[]>(
              teamKey,
              readTeamMembers(teamId).filter(
                (m) => isAgentMembership(m) || !wanted.has(m.userId)
              )
            )
          }
          if (isSelf) {
            if (mKey) {
              queryClient.setQueryData<IMembership[]>(
                mKey,
                readMemberships().filter((m) => m.teamId !== teamId)
              )
            }
            if (isSelfFromCurrent && userProfile.value) {
              authStore.setCurrentTeamIdLocal(null)
            }
          }
        },
        () => {
          if (isCurrent) queryClient.setQueryData(teamKey, previousMembers)
          if (mKey) queryClient.setQueryData(mKey, previousMemberships)
          if (isSelfFromCurrent) {
            authStore.setCurrentTeamIdLocal(previousTeamId ?? null)
          }
        },
        async () => {
          await removeMembersFn({ teamId, userIds })
        }
      )
    } finally {
      if (isSelf) removePending(pendingUserIds, currentUserId)
      pendingKeys.forEach((key) => setTimeout(() => clearPending(key), 120))
    }
  }

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

    const isCurrent = currentTeamId.value === teamId
    const pendingKey = `${teamId}-agent:${agentId}`
    const teamKey = teamMembersCacheKey(teamId)
    const previousMembers = isCurrent ? readTeamMembers(teamId) : []
    // Borrow the team snapshot from the actor's own membership so the optimistic
    // row is complete; without it, skip the insert and let Firestore catch up.
    const teamSnapshot = membershipsByTeamId.value.get(teamId)?.team

    markPending(pendingKey)
    try {
      await runMembershipMutation(
        isCurrent && teamSnapshot ? [teamKey] : [],
        () => {
          if (!isCurrent || !teamSnapshot) return
          const now = Timestamp.now()
          const optimistic: IAgentMembership = {
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
            optimistic,
          ])
        },
        () => {
          if (isCurrent) queryClient.setQueryData(teamKey, previousMembers)
        },
        async () => {
          await addTeamAgentMemberFn({ teamId, agentId })
        }
      )
    } finally {
      setTimeout(() => clearPending(pendingKey), 120)
    }
  }

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

    const isCurrent = currentTeamId.value === teamId
    const pendingKey = `${teamId}-agent:${agentId}`
    const teamKey = teamMembersCacheKey(teamId)
    const previousMembers = isCurrent ? readTeamMembers(teamId) : []

    markPending(pendingKey)
    try {
      await runMembershipMutation(
        isCurrent ? [teamKey] : [],
        () => {
          if (!isCurrent) return
          queryClient.setQueryData<ITeamMember[]>(
            teamKey,
            readTeamMembers(teamId).filter(
              (member) =>
                !(isAgentMembership(member) && member.agentId === agentId)
            )
          )
        },
        () => {
          if (isCurrent) queryClient.setQueryData(teamKey, previousMembers)
        },
        async () => {
          await removeTeamAgentMemberFn({ teamId, agentId })
        }
      )
    } finally {
      setTimeout(() => clearPending(pendingKey), 120)
    }
  }

  // Pure constructor for a freshly-created team's owner membership row.
  function createOwnerMembership(teamId: string, team: ITeam): IMembership {
    if (!currentUser.value || !userProfile.value) {
      throw new Error("Not authenticated")
    }
    const now = Timestamp.now()
    return {
      userId: currentUser.value.uid,
      teamId,
      role: "owner",
      user: userProfile.value,
      team,
      createdAt: now,
      updatedAt: now,
    }
  }

  // ── One-shot reads (no subscription) ────────────────────────────────────────
  async function getMembersForTeam(teamId: string): Promise<ITeamMember[]> {
    if (currentTeamId.value === teamId && !teamMembersQuery.isLoading.value) {
      return cloneState(teamMembers.value)
    }
    try {
      const snapshot = await getDocsCached(getTeamMembershipsCollection(teamId))
      return snapshot.docs
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

  async function fetchUserMemberships(): Promise<IMembership[]> {
    if (!currentUser.value) return []
    try {
      const snapshot = await getDocsCached(
        query(
          getAllMembershipsGroup(),
          where("userId", "==", currentUser.value.uid)
        )
      )
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

  // ── Teardown ────────────────────────────────────────────────────────────────
  function cleanup() {
    latestCountRequestId += 1
    if (countRefreshTimer) {
      clearTimeout(countRefreshTimer)
      countRefreshTimer = null
    }
    teamMemberCounts.value = {}
    // Read state lives in the query cache (cleared centrally on logout); live
    // listeners are torn down by gc once unobserved.
  }

  watch(currentUser, (user) => {
    if (!user) cleanup()
  })

  return {
    // State
    memberships,
    teamMembers,
    currentTeamId,
    teamMemberCounts,
    isLoading,
    isError,
    isStale,

    // Pending
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
    getWorkspaceRoleOverride,

    // Actions
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
    membershipsCacheKey,
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

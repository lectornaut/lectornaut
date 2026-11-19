/**
 * useWorkspaceBotSessions — admin-scoped view over every bot chat session
 * in the currently-selected team/workspace.
 *
 * Distinct from `useBotChat`'s session refs, which are user-scoped
 * (`mySessions`, `sharedSessions`, `archivedMySessions`) and powered by
 * `where("ownerUid", "==", uid)` / `where("visibility", "==", "shared")`
 * queries. This composable runs an *unfiltered* `botSessions` query so
 * the team admin/owner can see every member's chat — owned, shared, or
 * private — in one list. Agent-owned sessions (headless workflow
 * runs, `ownerUid = agentId`) are then dropped client-side: they have their
 * own home in Settings → Workflows plus the run-history view and would
 * otherwise flood this human-chat admin table. The unfiltered query needs
 * the logged "view as admin" grant (`useAdminView`): the Firestore rule
 * admits it only while that grant is live. Until then the table lists shared
 * chats plus the admin's own.
 *
 * Mutations reuse the same Cloud Function callables as the per-user
 * sidebar (`renameBotSession`, `archiveBotSession`, `deleteBotSession`).
 * The server's `assertCanMutate` already permits team admins to act on
 * any session, so admins can rename/archive/delete others' chats from
 * this surface.
 */

import { useAdminView } from "@/composables/useAdminView"
import { useCurrentTeamRole } from "@/composables/useCurrentTeamRole"
import {
  archiveBotSession,
  deleteBotSession,
  renameBotSession,
} from "@/composables/useFunctions"
import { isBuiltInAgentId } from "@/data/builtInAgents"
import { queryClient } from "@/modules/queryClient"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IBotSession } from "@/types/domain"
import { isAgentMembership } from "@/types/membership"
import {
  createBotSessionsQuery,
  createSharedBotSessionsQuery,
  createWorkspaceBotSessionsQuery,
} from "@/utils/firebase/firebase-helpers"
import {
  holdOptimistic,
  useCollectionQuery,
} from "@/utils/firebase/firebase-query"
import { queryKeys } from "@/utils/firebase/firebase-query-keys"
import { Timestamp, type Query } from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed, ref, type ComputedRef, type Ref } from "vue"
import { toast } from "vue-sonner"

export interface UseWorkspaceBotSessionsReturn {
  /** Every bot session in the current workspace, ordered by `updatedAt` desc. */
  sessions: ComputedRef<IBotSession[]>
  /** True while the query is still settling the initial snapshot. */
  isLoading: ComputedRef<boolean>
  /** Admin-or-owner gate. False = render the no-permission empty state. */
  canManage: ComputedRef<boolean>
  /** True for the duration of any rename/archive/delete call below. */
  isMutating: Ref<boolean>
  rename: (id: string, title: string) => Promise<boolean>
  archive: (id: string, archived: boolean) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
}

export function useWorkspaceBotSessions(): UseWorkspaceBotSessionsReturn {
  const { currentTeamId, currentWorkspaceId } = storeToRefs(useAuthStore())
  const { canManageBotSessions } = useCurrentTeamRole(currentTeamId)
  const { teamMembers } = storeToRefs(useMembershipStore())

  const { currentUser } = storeToRefs(useAuthStore())
  // The logged "view as admin" step: the unfiltered query is allowed by rules
  // only while the admin's grant is live. Without it the table lists what the
  // rules give any member: shared chats plus the admin's own.
  const adminView = useAdminView("sessions")
  const seesAll = computed(
    () => canManageBotSessions.value && adminView.active.value
  )

  // One slot per query the table may run. `null` skips subscribing (also the
  // no-permission short-circuit, so a rule denial never costs a read).
  const sessionQuery = (
    scope: "workspace-all" | "manage-shared" | "manage-own",
    enabled: () => boolean,
    build: (teamId: string, workspaceId: string) => Query<IBotSession> | null
  ) =>
    useCollectionQuery<IBotSession>(() => {
      const teamId = currentTeamId.value
      const workspaceId = currentWorkspaceId.value
      if (!canManageBotSessions.value || !enabled()) return null
      if (!teamId || !workspaceId) return null
      const query = build(teamId, workspaceId)
      return query
        ? {
            query,
            path: `teams/${teamId}/workspaces/${workspaceId}/botSessions`,
            // Distinguishes these from useBotChat's owned/shared queries on
            // the same collection.
            params: { scope },
          }
        : null
    })
  const allQuery = sessionQuery(
    "workspace-all",
    () => seesAll.value,
    createWorkspaceBotSessionsQuery
  )
  const sharedQuery = sessionQuery(
    "manage-shared",
    () => !seesAll.value,
    createSharedBotSessionsQuery
  )
  const ownQuery = sessionQuery(
    "manage-own",
    () => !seesAll.value,
    (teamId, workspaceId) => {
      const uid = currentUser.value?.uid
      return uid ? createBotSessionsQuery(teamId, workspaceId, uid) : null
    }
  )
  const activeScopes = computed(() =>
    seesAll.value
      ? (["workspace-all"] as const)
      : (["manage-shared", "manage-own"] as const)
  )
  const rows = computed<IBotSession[]>(() => {
    if (seesAll.value) return allQuery.data.value ?? []
    // Merge shared + own, dedupe by id, newest first (the queries' order).
    const byId = new Map<string, IBotSession>()
    for (const s of sharedQuery.data.value ?? []) byId.set(s.id, s)
    for (const s of ownQuery.data.value ?? []) byId.set(s.id, s)
    return [...byId.values()].sort(
      (a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0)
    )
  })

  // Custom team agents enrolled as agent memberships. A headless workflow run
  // persists a fresh session owned by the agent it ran as (`ownerUid =
  // agentId`; see `runHeadlessAgentTurn`).
  const customAgentUids = computed(
    () =>
      new Set(teamMembers.value.filter(isAgentMembership).map((m) => m.agentId))
  )

  // True when a session is owned by an agent rather than a human. Two cases,
  // because not every agent is a membership doc:
  //   • built-in agents (e.g. the Default agent `_default`) are `_`-prefixed
  //     and have NO membership doc — `getMembershipRoleOrNull` synthesizes
  //     their role — so the membership set alone misses them. Predefined
  //     workflows run as `_default`, so this is the COMMON case, not an edge.
  //   • custom team agents are enrolled, so they appear in `customAgentUids`.
  const isAgentOwned = (uid: string): boolean =>
    isBuiltInAgentId(uid) || customAgentUids.value.has(uid)

  // Exclude agent-owned (workflow-run) sessions: they have their own home in
  // Settings → Workflows + the run-history view, and listing them here mixes
  // unattended automation runs into the human-chat admin table.
  const sessions = computed<IBotSession[]>(() =>
    rows.value.filter((s) => !isAgentOwned(s.ownerUid))
  )

  const isLoading = computed<boolean>(() =>
    seesAll.value
      ? allQuery.isLoading.value
      : sharedQuery.isLoading.value || ownQuery.isLoading.value
  )

  // Single in-flight flag shared across all mutation paths — bulk
  // actions in the UI iterate sequentially and rely on this guard to
  // disable buttons while a batch runs.
  const isMutating = ref(false)

  // Optimistic cache write: patch the live botSessions cache (keyed with the
  // same `scope:workspace-all` params as the admin query), hold the key against
  // the listener, run the callable, then reconcile on release / roll back on
  // error. `isMutating` still gates the dialog spinner + sequential bulk
  // actions; this just makes the LIST reflect the change instantly.
  const runSessionWrite = async (
    teamId: string,
    workspaceId: string,
    applyOptimistic: (current: IBotSession[]) => IBotSession[],
    run: () => Promise<unknown>
  ): Promise<void> => {
    // Patch every cache key the current view subscribes to.
    const keys = activeScopes.value.map((scope) =>
      queryKeys.list(`teams/${teamId}/workspaces/${workspaceId}/botSessions`, {
        scope,
      })
    )
    const snapshots = keys.map(
      (key) => [key, queryClient.getQueryData<IBotSession[]>(key)] as const
    )
    const releases = keys.map((key) => holdOptimistic(key))
    for (const [key, previous] of snapshots) {
      queryClient.setQueryData<IBotSession[]>(
        key,
        applyOptimistic(previous ?? [])
      )
    }
    try {
      await run()
    } catch (error) {
      for (const [key, previous] of snapshots) {
        queryClient.setQueryData(key, previous)
      }
      throw error
    } finally {
      setTimeout(() => releases.forEach((release) => release()), 120)
    }
  }

  const rename = async (id: string, title: string): Promise<boolean> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return false
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error("Chat title cannot be empty.")
      return false
    }
    if (isMutating.value) return false
    isMutating.value = true
    try {
      await runSessionWrite(
        teamId,
        workspaceId,
        (current) =>
          current.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
        () =>
          renameBotSession({
            teamId,
            workspaceId,
            sessionId: id,
            title: trimmed,
          })
      )
      return true
    } catch (error) {
      console.error("[useWorkspaceBotSessions] rename failed:", error)
      toast.error("Failed to rename chat.")
      return false
    } finally {
      isMutating.value = false
    }
  }

  const archive = async (id: string, archived: boolean): Promise<boolean> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return false
    if (isMutating.value) return false
    isMutating.value = true
    try {
      await runSessionWrite(
        teamId,
        workspaceId,
        (current) =>
          current.map((s) =>
            s.id === id
              ? { ...s, archivedAt: archived ? Timestamp.now() : null }
              : s
          ),
        () =>
          archiveBotSession({ teamId, workspaceId, sessionId: id, archived })
      )
      return true
    } catch (error) {
      console.error("[useWorkspaceBotSessions] archive failed:", error)
      toast.error("Failed to update chat.")
      return false
    } finally {
      isMutating.value = false
    }
  }

  const remove = async (id: string): Promise<boolean> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return false
    if (isMutating.value) return false
    isMutating.value = true
    try {
      await runSessionWrite(
        teamId,
        workspaceId,
        (current) => current.filter((s) => s.id !== id),
        () => deleteBotSession({ teamId, workspaceId, sessionId: id })
      )
      return true
    } catch (error) {
      console.error("[useWorkspaceBotSessions] delete failed:", error)
      toast.error("Failed to delete chat.")
      return false
    } finally {
      isMutating.value = false
    }
  }

  return {
    sessions,
    isLoading,
    canManage: canManageBotSessions,
    isMutating,
    rename,
    archive,
    remove,
  }
}

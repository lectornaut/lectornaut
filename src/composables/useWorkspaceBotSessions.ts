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
 * otherwise flood this human-chat admin table. Non-admins receive an empty
 * snapshot because the Firestore rule clause requires `isTeamAdmin(teamId)`.
 *
 * Mutations reuse the same Cloud Function callables as the per-user
 * sidebar (`renameBotSession`, `archiveBotSession`, `deleteBotSession`).
 * The server's `assertCanMutate` already permits team admins to act on
 * any session, so admins can rename/archive/delete others' chats from
 * this surface.
 */

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
import { createWorkspaceBotSessionsQuery } from "@/utils/firebase/firebase-helpers"
import {
  holdOptimistic,
  useCollectionQuery,
} from "@/utils/firebase/firebase-query"
import { queryKeys } from "@/utils/firebase/firebase-query-keys"
import { Timestamp } from "firebase/firestore"
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
  rename: (id: string, title: string) => Promise<void>
  archive: (id: string, archived: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useWorkspaceBotSessions(): UseWorkspaceBotSessionsReturn {
  const { currentTeamId, currentWorkspaceId } = storeToRefs(useAuthStore())
  const { canManageBotSessions } = useCurrentTeamRole(currentTeamId)
  const { teamMembers } = storeToRefs(useMembershipStore())

  const queryRef = computed(() => {
    // Short-circuit when the user can't manage: skip subscribing
    // entirely so we don't waste a Firestore read budget on a rule
    // denial that would always return empty anyway.
    if (!canManageBotSessions.value) return null
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return null
    return createWorkspaceBotSessionsQuery(teamId, workspaceId)
  })

  const sessionsQuery = useCollectionQuery<IBotSession>(() => {
    const activeQuery = queryRef.value
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    return activeQuery && teamId && workspaceId
      ? {
          query: activeQuery,
          path: `teams/${teamId}/workspaces/${workspaceId}/botSessions`,
          // Distinguishes this unfiltered admin view from useBotChat's
          // owned/shared queries on the same collection.
          params: { scope: "workspace-all" },
        }
      : null
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
  // Owner-less legacy docs (ownerUid absent) are treated as human and kept.
  const isAgentOwned = (uid: string | undefined): boolean =>
    !!uid && (isBuiltInAgentId(uid) || customAgentUids.value.has(uid))

  // Exclude agent-owned (workflow-run) sessions: they have their own home in
  // Settings → Workflows + the run-history view, and listing them here mixes
  // unattended automation runs into the human-chat admin table.
  const sessions = computed<IBotSession[]>(() =>
    (sessionsQuery.data.value ?? []).filter((s) => !isAgentOwned(s.ownerUid))
  )

  const isLoading = computed<boolean>(() => sessionsQuery.isLoading.value)

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
    const key = queryKeys.list(
      `teams/${teamId}/workspaces/${workspaceId}/botSessions`,
      { scope: "workspace-all" }
    )
    const previous = queryClient.getQueryData<IBotSession[]>(key)
    const release = holdOptimistic(key)
    queryClient.setQueryData<IBotSession[]>(
      key,
      applyOptimistic(previous ?? [])
    )
    try {
      await run()
    } catch (error) {
      queryClient.setQueryData(key, previous)
      throw error
    } finally {
      setTimeout(() => release(), 120)
    }
  }

  const rename = async (id: string, title: string): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error("Chat title cannot be empty.")
      return
    }
    if (isMutating.value) return
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
    } catch (error) {
      console.error("[useWorkspaceBotSessions] rename failed:", error)
      toast.error("Failed to rename chat.")
    } finally {
      isMutating.value = false
    }
  }

  const archive = async (id: string, archived: boolean): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    if (isMutating.value) return
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
    } catch (error) {
      console.error("[useWorkspaceBotSessions] archive failed:", error)
      toast.error("Failed to update chat.")
    } finally {
      isMutating.value = false
    }
  }

  const remove = async (id: string): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    if (isMutating.value) return
    isMutating.value = true
    try {
      await runSessionWrite(
        teamId,
        workspaceId,
        (current) => current.filter((s) => s.id !== id),
        () => deleteBotSession({ teamId, workspaceId, sessionId: id })
      )
    } catch (error) {
      console.error("[useWorkspaceBotSessions] delete failed:", error)
      toast.error("Failed to delete chat.")
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

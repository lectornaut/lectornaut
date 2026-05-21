/**
 * useWorkspaceBotSessions — admin-scoped view over every bot chat session
 * in the currently-selected team/workspace.
 *
 * Distinct from `useBotChat`'s session refs, which are user-scoped
 * (`mySessions`, `sharedSessions`, `archivedMySessions`) and powered by
 * `where("ownerUid", "==", uid)` / `where("visibility", "==", "shared")`
 * queries. This composable runs an *unfiltered* `botSessions` query so
 * the team admin/owner can see every member's chat — owned, shared, or
 * private — in one list. Non-admins receive an empty snapshot because
 * the Firestore rule clause requires `isTeamAdmin(teamId)`.
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
import { useAuthStore } from "@/stores/authStore"
import type { IBotSession } from "@/types/domain"
import { createWorkspaceBotSessionsQuery } from "@/utils/firebase/firebase-helpers"
import { storeToRefs } from "pinia"
import { computed, ref, type ComputedRef, type Ref } from "vue"
import { toast } from "vue-sonner"
import { useCollection } from "vuefire"

export interface UseWorkspaceBotSessionsReturn {
  /** Every bot session in the current workspace, ordered by `updatedAt` desc. */
  sessions: ComputedRef<IBotSession[]>
  /** True while vuefire is still settling the initial snapshot. */
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

  const _vuefireSessions = useCollection<IBotSession>(queryRef, {
    reset: true,
  })

  const sessions = computed<IBotSession[]>(
    () => _vuefireSessions.data.value ?? []
  )

  const isLoading = computed<boolean>(() => _vuefireSessions.pending.value)

  // Single in-flight flag shared across all mutation paths — bulk
  // actions in the UI iterate sequentially and rely on this guard to
  // disable buttons while a batch runs.
  const isMutating = ref(false)

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
      await renameBotSession({
        teamId,
        workspaceId,
        sessionId: id,
        title: trimmed,
      })
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
      await archiveBotSession({
        teamId,
        workspaceId,
        sessionId: id,
        archived,
      })
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
      await deleteBotSession({ teamId, workspaceId, sessionId: id })
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

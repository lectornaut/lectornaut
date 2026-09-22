/**
 * Shared mutations for a user's bot sessions.
 *
 * Chat surfaces own their navigation and dialog state, but all call the
 * same session endpoints and should present consistent feedback while a
 * mutation is in flight.
 */
import {
  archiveBotSession,
  deleteBotSession,
  pinBotSession,
  renameBotSession,
} from "@/composables/useFunctions"
import { useAuthStore } from "@/stores/authStore"
import { storeToRefs } from "pinia"
import { ref } from "vue"
import { toast } from "vue-sonner"

type SessionWrite = (target: {
  teamId: string
  workspaceId: string
}) => Promise<unknown>

export function useBotSessionActions() {
  const { currentTeamId, currentWorkspaceId } = storeToRefs(useAuthStore())
  const isMutating = ref(false)

  const run = async (
    action: string,
    write: SessionWrite,
    errorMessage: string,
    successMessage?: string
  ): Promise<boolean> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId || isMutating.value) return false

    isMutating.value = true
    try {
      await write({ teamId, workspaceId })
      if (successMessage) toast.success(successMessage)
      return true
    } catch (error) {
      console.error(`[useBotSessionActions] ${action} failed:`, error)
      toast.error(errorMessage)
      return false
    } finally {
      isMutating.value = false
    }
  }

  const renameSession = (id: string, title: string): Promise<boolean> => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error("Chat title cannot be empty.")
      return Promise.resolve(false)
    }

    return run(
      "renameBotSession",
      ({ teamId, workspaceId }) =>
        renameBotSession({
          teamId,
          workspaceId,
          sessionId: id,
          title: trimmed,
        }),
      "Failed to rename chat."
    )
  }

  const archiveSession = (id: string, archived: boolean): Promise<boolean> =>
    run(
      "archiveBotSession",
      ({ teamId, workspaceId }) =>
        archiveBotSession({ teamId, workspaceId, sessionId: id, archived }),
      "Failed to update chat.",
      archived ? "Chat archived." : "Chat restored."
    )

  const pinSession = (id: string, pinned: boolean): Promise<boolean> =>
    run(
      "pinBotSession",
      ({ teamId, workspaceId }) =>
        pinBotSession({ teamId, workspaceId, sessionId: id, pinned }),
      "Failed to update chat."
    )

  const removeSession = (id: string): Promise<boolean> =>
    run(
      "deleteBotSession",
      ({ teamId, workspaceId }) =>
        deleteBotSession({ teamId, workspaceId, sessionId: id }),
      "Failed to delete chat.",
      "Chat deleted."
    )

  return {
    isMutating,
    renameSession,
    archiveSession,
    pinSession,
    removeSession,
  }
}

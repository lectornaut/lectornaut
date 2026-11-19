/**
 * useAdminView — the logged "view as admin" step.
 *
 * Firestore rules let a team admin read other members' PRIVATE chats or
 * memories only while a grant written by the audited `startAdminView` callable
 * is live. `active` tells a table whether to run its read-everything query;
 * without it an admin sees what any member sees (own + shared).
 *
 * Grants are remembered per workspace + kind for the app session, so leaving
 * and reopening a settings tab inside the window does not log a second entry.
 */
import { startAdminView } from "@/composables/useFunctions"
import { useAuthStore } from "@/stores/authStore"
import type { AdminViewKind } from "@lectornaut/shared/domain"
import { storeToRefs } from "pinia"
import { computed, reactive, ref } from "vue"

// Stop a little early so the client never queries on a grant the rules
// (server clock) already consider expired.
const EXPIRY_MARGIN_MS = 30_000

const expiries = reactive<Record<string, number>>({})
// One app-wide clock so every table drops back when its grant lapses.
const now = ref(Date.now())
setInterval(() => (now.value = Date.now()), 10_000)

export function useAdminView(kind: AdminViewKind) {
  const { currentTeamId, currentWorkspaceId } = storeToRefs(useAuthStore())
  const key = computed(
    () => `${currentTeamId.value}:${currentWorkspaceId.value}:${kind}`
  )
  const expiresAt = computed(() => expiries[key.value] ?? 0)
  const active = computed(() => expiresAt.value - EXPIRY_MARGIN_MS > now.value)
  const isStarting = ref(false)

  /** Throws on failure so the confirm dialog stays open. */
  const start = async (): Promise<void> => {
    const teamId = currentTeamId.value
    const workspaceId = currentWorkspaceId.value
    if (!teamId || !workspaceId) return
    isStarting.value = true
    try {
      const { data } = await startAdminView({ teamId, workspaceId, kind })
      expiries[`${teamId}:${workspaceId}:${kind}`] = data.expiresAt
    } finally {
      isStarting.value = false
    }
  }

  return { active, expiresAt, isStarting, start }
}

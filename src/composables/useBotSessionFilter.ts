/**
 * useBotSessionFilter — reactive filter + search state for bot chat
 * lists. Used by the `/bot` page's history sidebar and the node
 * inspector's Bot tab, each with its own independent instance.
 *
 * Filters available:
 *   - `search`         text — matches against title and preview
 *                      (case-insensitive substring)
 *   - `sharing`        toggle — when true, restrict to sessions not
 *                      owned by the current user (i.e. "shared with me")
 *   - `nodeAttached`   toggle — when true, restrict to sessions with a
 *                      `pinnedNodeKey` set (i.e. node-bound chats)
 *   - `modes`          set — empty = all; otherwise match `lastMode`
 *   - `visibilities`   set — empty = all; otherwise match `visibility`
 *
 * Match semantics are defensively pure: callers pass a session and the
 * current user uid; we return a boolean. This keeps the composable
 * usable from `computed()` blocks without coupling it to a particular
 * session list source.
 */
import type { BotChatMode } from "@/composables/useFunctions"
import { useAuthStore } from "@/stores/authStore"
import type { IBotSession, IBotSessionVisibility } from "@/types/domain"
import { storeToRefs } from "pinia"
import { computed, reactive } from "vue"

export interface BotSessionFilterState {
  search: string
  /** True = only show sessions where I'm NOT the owner. */
  onlyShared: boolean
  /** True = only show sessions with a `pinnedNodeKey` (node-bound). */
  onlyNodeAttached: boolean
  /** Empty set = match all modes. */
  modes: Set<BotChatMode>
  /** Empty set = match all visibilities. */
  visibilities: Set<IBotSessionVisibility>
}

export const BOT_CHAT_MODE_VALUES: readonly BotChatMode[] = [
  "auto",
  "agent",
  "manual",
] as const

export const BOT_CHAT_VISIBILITY_VALUES: readonly IBotSessionVisibility[] = [
  "private",
  "shared",
  "public",
] as const

const defaultState = (): BotSessionFilterState => ({
  search: "",
  onlyShared: false,
  onlyNodeAttached: false,
  modes: new Set(),
  visibilities: new Set(),
})

export function useBotSessionFilter() {
  const authStore = useAuthStore()
  const { currentUser } = storeToRefs(authStore)

  // `reactive` instead of `ref(...)` so callers can `v-model` individual
  // properties (`state.search`, `state.onlyShared`) without unwrapping
  // and so Set mutations are tracked without re-creating the Set object
  // each toggle.
  const state = reactive<BotSessionFilterState>(defaultState())

  const isActive = computed(
    () =>
      state.search.trim().length > 0 ||
      state.onlyShared ||
      state.onlyNodeAttached ||
      state.modes.size > 0 ||
      state.visibilities.size > 0
  )

  /**
   * Apply every active filter to a single session. Returns `true` when
   * the session passes all filters. Designed to be cheap (no allocation
   * in the hot path) so callers can pipe a whole `mySessions` list
   * through a `.filter` without worrying about cost.
   */
  const matches = (session: IBotSession): boolean => {
    const uid = currentUser.value?.uid ?? null

    if (state.onlyShared) {
      // "Shared with me" — I am not the owner. If we don't yet know
      // who the caller is (auth still resolving) we conservatively
      // exclude the session so we never falsely show "not yours" rows.
      if (!uid || session.ownerUid === uid) return false
    }

    if (state.onlyNodeAttached) {
      if (!session.pinnedNodeKey) return false
    }

    if (state.modes.size > 0) {
      // Sessions saved before `lastMode` existed have no mode field.
      // Treat them as not matching any specific mode filter — opening
      // them in a chat will populate `lastMode` on the next save.
      const m = session.lastMode
      if (!m || !state.modes.has(m)) return false
    }

    if (state.visibilities.size > 0) {
      if (!state.visibilities.has(session.visibility)) return false
    }

    const q = state.search.trim().toLowerCase()
    if (q.length > 0) {
      const title = (session.title ?? "").toLowerCase()
      const preview = (session.preview ?? "").toLowerCase()
      if (!title.includes(q) && !preview.includes(q)) return false
    }

    return true
  }

  /** Convenience: apply `matches` across an array. */
  const filter = (sessions: IBotSession[]): IBotSession[] =>
    sessions.filter(matches)

  const reset = () => {
    state.search = ""
    state.onlyShared = false
    state.onlyNodeAttached = false
    state.modes.clear()
    state.visibilities.clear()
  }

  const toggleMode = (mode: BotChatMode) => {
    if (state.modes.has(mode)) state.modes.delete(mode)
    else state.modes.add(mode)
  }

  const toggleVisibility = (visibility: IBotSessionVisibility) => {
    if (state.visibilities.has(visibility))
      state.visibilities.delete(visibility)
    else state.visibilities.add(visibility)
  }

  // Setters keep the mutation inside this closure so consumers (which
  // typically receive the composable's return as a prop) can update
  // state without tripping `vue/no-mutating-props` in their templates.
  const setSearch = (value: string) => {
    state.search = value
  }
  const setOnlyShared = (value: boolean) => {
    state.onlyShared = value
  }
  const setOnlyNodeAttached = (value: boolean) => {
    state.onlyNodeAttached = value
  }

  return {
    state,
    isActive,
    matches,
    filter,
    reset,
    toggleMode,
    toggleVisibility,
    setSearch,
    setOnlyShared,
    setOnlyNodeAttached,
  }
}

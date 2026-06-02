/**
 * useBotSessionFilter — reactive filter + search + view state for bot
 * chat lists. Used by the `/bot` page's history sidebar and the node
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
 * View options (don't hide rows, just reshape the list):
 *   - `groupBy`        none (single bucket) | date (today / yesterday /
 *                      previous 7 days / older) | visibility (private /
 *                      shared / public)
 *   - `sortBy`         recency (most recent activity, i.e. `updatedAt`
 *                      desc — the default) | created (`createdAt` desc)
 *                      | alphabetical (title A–Z)
 *
 * Match semantics are defensively pure: callers pass a session and the
 * current user uid; we return a boolean. This keeps the composable
 * usable from `computed()` blocks without coupling it to a particular
 * session list source.
 */
import type { BotChatMode } from "@/composables/useFunctions"
import { useAuthStore } from "@/stores/authStore"
import type { IBotSession, IBotSessionVisibility } from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed, reactive } from "vue"

export const BOT_SESSION_GROUP_BY_VALUES = [
  "none",
  "date",
  "visibility",
] as const
export type BotSessionGroupBy = (typeof BOT_SESSION_GROUP_BY_VALUES)[number]

export const BOT_SESSION_SORT_BY_VALUES = [
  "recency",
  "created",
  "alphabetical",
] as const
export type BotSessionSortBy = (typeof BOT_SESSION_SORT_BY_VALUES)[number]

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
  groupBy: BotSessionGroupBy
  sortBy: BotSessionSortBy
}

/**
 * A bucket of sessions emitted by `groupSessions`. The `key` is a
 * stable identifier the caller maps to a localized label — keeping
 * i18n out of this composable.
 *
 * Possible keys, by `state.groupBy`:
 *   - `none`        → "all"
 *   - `date`        → "today" | "yesterday" | "lastWeek" | "older"
 *   - `visibility`  → "private" | "shared" | "public"
 */
export interface BotSessionGroup {
  key: string
  items: IBotSession[]
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
  // Defaults mirror the historical behavior — date buckets sorted by
  // most-recent activity — so the upgrade is invisible to users who
  // never open the filter menu.
  groupBy: "date",
  sortBy: "recency",
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

  // Defensive: Firestore reads come back as `Timestamp` instances, but
  // typing is permissive (the schema marks both `createdAt`/`updatedAt`
  // as optional). Anything that isn't a Timestamp sorts as "epoch zero"
  // so it doesn't get hoisted to the top by accident.
  const tsMillis = (
    value: IBotSession["updatedAt"] | IBotSession["createdAt"]
  ): number => (value instanceof Timestamp ? value.toMillis() : 0)

  /**
   * Returns a fresh array — never mutate the caller's input, which is
   * usually a `computed` reading from a TanStack Query–backed reactive
   * collection.
   */
  const sortSessions = (sessions: IBotSession[]): IBotSession[] => {
    const arr = sessions.slice()
    if (state.sortBy === "recency") {
      arr.sort((a, b) => tsMillis(b.updatedAt) - tsMillis(a.updatedAt))
    } else if (state.sortBy === "created") {
      arr.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt))
    } else {
      // Alphabetical: `localeCompare` with case-insensitive sensitivity
      // so "apple" and "Apple" land together; untitled chats (empty
      // title) sink to the bottom so they don't crowd the top of the
      // alphabet.
      arr.sort((a, b) => {
        const ta = (a.title ?? "").trim()
        const tb = (b.title ?? "").trim()
        if (!ta && !tb) return 0
        if (!ta) return 1
        if (!tb) return -1
        return ta.localeCompare(tb, undefined, { sensitivity: "base" })
      })
    }
    return arr
  }

  const startOfToday = () => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  /**
   * Group + sort sessions into ordered buckets ready for rendering.
   * Sort runs first so within-bucket order is consistent with the
   * global `sortBy`. Empty buckets are dropped so the UI never renders
   * an empty `Collapsible`.
   */
  const groupSessions = (sessions: IBotSession[]): BotSessionGroup[] => {
    const sorted = sortSessions(sessions)
    if (sorted.length === 0) return []

    if (state.groupBy === "none") {
      return [{ key: "all", items: sorted }]
    }

    if (state.groupBy === "visibility") {
      const buckets: Record<IBotSessionVisibility, IBotSession[]> = {
        private: [],
        shared: [],
        public: [],
      }
      for (const s of sorted) buckets[s.visibility].push(s)
      const out: BotSessionGroup[] = []
      for (const key of BOT_CHAT_VISIBILITY_VALUES) {
        if (buckets[key].length > 0) out.push({ key, items: buckets[key] })
      }
      return out
    }

    // date — bucket against `updatedAt` regardless of the current
    // `sortBy`, so "Today / Yesterday / …" always reflect when a chat
    // was last touched. (Sorting by created+grouping by date would
    // otherwise put a recently-active old chat in "Older", which is
    // surprising.)
    const today: IBotSession[] = []
    const yesterday: IBotSession[] = []
    const lastWeek: IBotSession[] = []
    const older: IBotSession[] = []
    const todayStart = startOfToday()
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000
    for (const s of sorted) {
      const ts = tsMillis(s.updatedAt)
      if (ts >= todayStart) today.push(s)
      else if (ts >= yesterdayStart) yesterday.push(s)
      else if (ts >= weekStart) lastWeek.push(s)
      else older.push(s)
    }
    const out: BotSessionGroup[] = []
    if (today.length) out.push({ key: "today", items: today })
    if (yesterday.length) out.push({ key: "yesterday", items: yesterday })
    if (lastWeek.length) out.push({ key: "lastWeek", items: lastWeek })
    if (older.length) out.push({ key: "older", items: older })
    return out
  }

  const reset = () => {
    state.search = ""
    state.onlyShared = false
    state.onlyNodeAttached = false
    state.modes.clear()
    state.visibilities.clear()
    state.groupBy = "date"
    state.sortBy = "recency"
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
  const setGroupBy = (value: BotSessionGroupBy) => {
    state.groupBy = value
  }
  const setSortBy = (value: BotSessionSortBy) => {
    state.sortBy = value
  }

  return {
    state,
    isActive,
    matches,
    filter,
    sortSessions,
    groupSessions,
    reset,
    toggleMode,
    toggleVisibility,
    setSearch,
    setOnlyShared,
    setOnlyNodeAttached,
    setGroupBy,
    setSortBy,
  }
}

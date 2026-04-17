import { parseSafe } from "@/schemas/_utils"
import { watchDebounced } from "@vueuse/core"
import type { Ref, WatchSource } from "vue"
import type { ZodType } from "zod"

const CACHE_PREFIX = "lectornaut.cache."
/**
 * Default debounce for localStorage persist writes. 1000ms caused stale reads
 * on rapid team switches followed by tab refresh. 250ms keeps writes cheap
 * while ensuring the cache reflects recent state even if the tab is closed
 * mid-session. A `pagehide` flush handles the last-pending write regardless.
 */
const DEFAULT_PERSIST_DEBOUNCE_MS = 250
let unloadListenersAttached = false
const pendingFlushCallbacks = new Set<() => void>()

const ensureUnloadListener = () => {
  if (unloadListenersAttached) return
  if (typeof window === "undefined") return
  unloadListenersAttached = true
  const flushAll = () => {
    pendingFlushCallbacks.forEach((flush) => {
      try {
        flush()
      } catch {
        /* ignore */
      }
    })
  }
  window.addEventListener("pagehide", flushAll)
  window.addEventListener("beforeunload", flushAll)
}

interface UseLocalHydrationOptions<T> {
  /** Guard function; only hydrate if returns true (default: target is null). */
  shouldHydrate?: () => boolean
  /** Debounce for persist writes (default 250ms). */
  debounce?: number
  /**
   * Optional Zod schema that validates the cached entry on hydrate. Corrupt
   * or stale entries fail validation and the cache is discarded — preventing
   * a broken cached shape from poisoning the UI on cold start.
   *
   * For entries that contain Firestore `Timestamp` fields, pass the
   * `*HydrationSchema` variant from `src/schemas/domain.ts`, which transforms
   * JSON-serialized `{ seconds, nanoseconds }` shapes back into real
   * `Timestamp` instances.
   */
  schema?: ZodType<T>
  /** Override the default violation context (`hydration:<key>`). */
  context?: string
}

/**
 * Hydrate a ref from localStorage on startup, and persist changes back.
 * Provides instant cold-start data before VueFire/IndexedDB resolves.
 *
 * @param key - Cache key (appended to prefix)
 * @param target - Ref to hydrate into (typically an optimistic state ref)
 * @param source - Reactive source to persist from. Defaults to target ref.
 *                 If passing a getter that references a computed defined later
 *                 in the same scope, be aware of JavaScript's temporal dead zone.
 * @param options - See {@link UseLocalHydrationOptions}.
 */
export function useLocalHydration<T>(
  key: string,
  target: Ref<T | null>,
  source?: WatchSource<T | null>,
  options: UseLocalHydrationOptions<T> = {}
): void {
  const storageKey = CACHE_PREFIX + key
  const {
    shouldHydrate = () => !target.value,
    debounce = DEFAULT_PERSIST_DEBOUNCE_MS,
    schema,
    context,
  } = options

  // Hydrate: read from localStorage synchronously on setup
  if (shouldHydrate()) {
    try {
      const cached = localStorage.getItem(storageKey)
      if (cached) {
        const parsed = JSON.parse(cached) as unknown
        if (schema) {
          const validated = parseSafe(
            schema,
            parsed,
            context ?? `hydration:${key}`
          )
          if (validated !== null) {
            target.value = validated
          } else {
            // Validation failed — discard the corrupt/stale cache so the next
            // write starts fresh. The violation has already been logged via
            // the sink by parseSafe.
            localStorage.removeItem(storageKey)
          }
        } else {
          target.value = parsed as T
        }
      }
    } catch {
      // Corrupted cache — ignore silently and clear so a future write overwrites
      localStorage.removeItem(storageKey)
    }
  }

  // Persist: watch source (or target ref) and write back on changes (debounced).
  // When source is the target ref itself, there's no forward-reference risk.
  const watchSource = source ?? target

  // Track the latest observed value (undebounced) so the unload flush always
  // writes the most recent state, even if the debounced callback has not
  // fired yet. The debounced watcher drives the common-case write.
  let latestValue: T | null | undefined
  let latestIsDirty = false

  watch(
    watchSource,
    (value) => {
      latestValue = value
      latestIsDirty = true
    },
    { deep: true, immediate: false }
  )

  watchDebounced(
    watchSource,
    (value) => {
      try {
        if (value != null) {
          localStorage.setItem(storageKey, JSON.stringify(value))
        } else {
          localStorage.removeItem(storageKey)
        }
        latestIsDirty = false
      } catch {
        // localStorage full or unavailable — ignore
      }
    },
    { debounce, deep: true }
  )

  const flushToStorage = () => {
    if (!latestIsDirty) return
    latestIsDirty = false
    try {
      if (latestValue != null) {
        localStorage.setItem(storageKey, JSON.stringify(latestValue))
      } else {
        localStorage.removeItem(storageKey)
      }
    } catch {
      // localStorage full or unavailable — ignore
    }
  }

  // Register an unload flush so the last-pending write lands even if the
  // user closes or navigates the tab before the debounce fires.
  pendingFlushCallbacks.add(flushToStorage)
  ensureUnloadListener()
}

/**
 * Clear all hydration cache entries (e.g., on logout).
 */
export function clearHydrationCache(): void {
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(CACHE_PREFIX)) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key))
}

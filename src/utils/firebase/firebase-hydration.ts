import { parseSafe } from "@/schemas/_utils"
import { watchDebounced } from "@vueuse/core"
import type { Ref, WatchSource } from "vue"
import type { ZodType } from "zod"

const CACHE_PREFIX = "lectornaut.cache."

interface UseLocalHydrationOptions<T> {
  /** Guard function; only hydrate if returns true (default: target is null). */
  shouldHydrate?: () => boolean
  /** Debounce for persist writes (default 1000ms). */
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
    debounce = 1000,
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
  watchDebounced(
    watchSource,
    (value) => {
      try {
        if (value != null) {
          localStorage.setItem(storageKey, JSON.stringify(value))
        } else {
          localStorage.removeItem(storageKey)
        }
      } catch {
        // localStorage full or unavailable — ignore
      }
    },
    { debounce, deep: true }
  )
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

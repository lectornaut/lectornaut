import { checkUsernameAvailability } from "@/queries/username"
import {
  USERNAME_MIN_LENGTH,
  usernamesMatch,
  validateUsername,
} from "@/utils/firebase/firebase-username"

type UsernameCheckState =
  | "empty"
  | "unchanged"
  | "invalid"
  | "taken"
  | "available"

interface UsernameCheckResult {
  state: UsernameCheckState
  normalized: string | null
  error: string | null
}

interface UseUsernameAvailabilityOptions {
  getCurrentUsername: () => string
  takenMessage?: string
  debounceMs?: number
}

export const useUsernameAvailability = (
  options: UseUsernameAvailabilityOptions
) => {
  const isChecking = ref(false)
  const available = ref<boolean | null>(null)
  const error = ref<string | null>(null)
  let latestRequestId = 0

  const clearState = () => {
    available.value = null
    error.value = null
    isChecking.value = false
  }

  const invalidatePendingChecks = () => {
    latestRequestId += 1
    isChecking.value = false
  }

  const reset = () => {
    cancelDebouncedEvaluate()
    invalidatePendingChecks()
    clearState()
  }

  const evaluate = async (
    rawUsername: string
  ): Promise<UsernameCheckResult> => {
    const requestId = ++latestRequestId
    const usernameInput = rawUsername.trim()

    if (!usernameInput) {
      if (requestId === latestRequestId) {
        clearState()
      }
      return { state: "empty", normalized: null, error: null }
    }

    if (usernamesMatch(usernameInput, options.getCurrentUsername())) {
      if (requestId === latestRequestId) {
        clearState()
      }
      return { state: "unchanged", normalized: null, error: null }
    }

    const validation = validateUsername(usernameInput)
    if (!validation.valid || !validation.normalized) {
      if (requestId === latestRequestId) {
        available.value = false
        error.value = validation.error
        isChecking.value = false
      }
      return {
        state: "invalid",
        normalized: null,
        error: validation.error,
      }
    }

    if (requestId === latestRequestId) {
      available.value = null
      error.value = null
      isChecking.value = true
    }
    try {
      const isAvailable = await checkUsernameAvailability(validation.normalized)
      if (requestId !== latestRequestId) {
        return {
          state: isAvailable ? "available" : "taken",
          normalized: validation.normalized,
          error: isAvailable
            ? null
            : (options.takenMessage ?? "Username is already taken"),
        }
      }

      available.value = isAvailable

      if (!isAvailable) {
        const takenError = options.takenMessage ?? "Username is already taken"
        error.value = takenError
        return {
          state: "taken",
          normalized: validation.normalized,
          error: takenError,
        }
      }

      return {
        state: "available",
        normalized: validation.normalized,
        error: null,
      }
    } finally {
      if (requestId === latestRequestId) {
        isChecking.value = false
      }
    }
  }

  const debouncedEvaluate = useDebounceFn((rawUsername: string) => {
    void evaluate(rawUsername)
  }, options.debounceMs ?? 500)

  const cancelDebouncedEvaluate = () => {
    ;(
      debouncedEvaluate as typeof debouncedEvaluate & {
        cancel?: () => void
      }
    ).cancel?.()
  }

  const handleInput = (rawUsername: string) => {
    cancelDebouncedEvaluate()
    invalidatePendingChecks()
    if (!rawUsername.trim()) {
      clearState()
      return
    }

    debouncedEvaluate(rawUsername)
  }

  const hasMinimumLength = (rawUsername: string) =>
    rawUsername.trim().length >= USERNAME_MIN_LENGTH

  const isValidUsername = (rawUsername: string) => {
    const usernameInput = rawUsername.trim()
    if (!usernameInput) return false
    return validateUsername(usernameInput).valid
  }

  onUnmounted(() => {
    cancelDebouncedEvaluate()
    invalidatePendingChecks()
  })

  return {
    isChecking,
    available,
    error,
    reset,
    evaluate,
    handleInput,
    hasMinimumLength,
    isValidUsername,
  }
}

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

  const reset = () => {
    available.value = null
    error.value = null
  }

  const evaluate = async (
    rawUsername: string
  ): Promise<UsernameCheckResult> => {
    const usernameInput = rawUsername.trim()

    if (!usernameInput) {
      reset()
      return { state: "empty", normalized: null, error: null }
    }

    if (usernamesMatch(usernameInput, options.getCurrentUsername())) {
      reset()
      return { state: "unchanged", normalized: null, error: null }
    }

    const validation = validateUsername(usernameInput)
    if (!validation.valid || !validation.normalized) {
      available.value = false
      error.value = validation.error
      return {
        state: "invalid",
        normalized: null,
        error: validation.error,
      }
    }

    error.value = null
    isChecking.value = true
    try {
      const isAvailable = await checkUsernameAvailability(validation.normalized)
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
      isChecking.value = false
    }
  }

  const debouncedEvaluate = useDebounceFn((rawUsername: string) => {
    void evaluate(rawUsername)
  }, options.debounceMs ?? 500)

  const handleInput = (rawUsername: string) => {
    if (!rawUsername.trim()) {
      reset()
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

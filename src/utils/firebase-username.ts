/**
 * Username validation and normalization utilities
 * Implements best practices for username handling
 */

// Username constraints
export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 30

// Only allow alphanumeric, underscores, and hyphens
// Must start with a letter or number (not underscore or hyphen)
export const USERNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

// Reserved usernames that cannot be claimed
// Includes common routes, system terms, and potentially confusing names
export const RESERVED_USERNAMES = new Set([
  // App routes
  "home",
  "login",
  "logout",
  "signin",
  "signout",
  "signup",
  "register",
  "enter",
  "exit",
  "profile",
  "settings",
  "account",
  "dashboard",
  "admin",
  "administrator",
  "api",
  "app",
  "about",
  "help",
  "support",
  "contact",
  "pricing",
  "billing",
  "subscription",
  "subscriptions",
  "explore",
  "search",
  "discover",
  "browse",
  "feed",
  "notifications",
  "messages",
  "inbox",
  "chat",
  "teams",
  "team",
  "org",
  "organization",
  "organizations",
  "create",
  "new",
  "edit",
  "delete",
  "remove",
  "update",
  "manage",
  "agents",
  "agent",
  "runs",
  "run",
  "tasks",
  "task",
  "flows",
  "flow",
  "changelog",
  "blog",
  "docs",
  "documentation",
  "legal",
  "terms",
  "privacy",
  "security",
  "cookies",
  "welcome",
  "start",
  "write",
  "test",

  // System terms
  "system",
  "root",
  "null",
  "undefined",
  "anonymous",
  "guest",
  "user",
  "users",
  "member",
  "members",
  "moderator",
  "mod",
  "staff",
  "owner",
  "bot",
  "bots",
  "official",
  "verified",

  // Brand protection
  "lectornaut",
  "lector",
  "naut",

  // Common reserved
  "www",
  "mail",
  "email",
  "ftp",
  "ssl",
  "ssh",
  "cdn",
  "assets",
  "static",
  "public",
  "private",
  "internal",
  "external",
])

// Characters that look similar and could be used for impersonation
// Maps confusable characters to their canonical form
const CONFUSABLE_CHARS: Record<string, string> = {
  // Cyrillic lookalikes
  а: "a", // Cyrillic а
  е: "e", // Cyrillic е
  о: "o", // Cyrillic о
  р: "p", // Cyrillic р
  с: "c", // Cyrillic с
  х: "x", // Cyrillic х
  у: "y", // Cyrillic у
  // Greek lookalikes
  α: "a", // Greek alpha
  ε: "e", // Greek epsilon
  ο: "o", // Greek omicron
  // Common substitutions
  "0": "o",
  "1": "l",
  "!": "i",
  "@": "a",
  $: "s",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
}

export interface UsernameValidationResult {
  valid: boolean
  error: string | null
  normalized: string | null
}

/**
 * Normalizes a username for storage and comparison.
 * - Trims whitespace
 * - Converts to lowercase
 * - Removes leading @ symbol if present
 */
export const normalizeUsername = (username: string): string => {
  let normalized = username.trim().toLowerCase()

  // Remove leading @ if present (common when copying from profile links)
  if (normalized.startsWith("@")) {
    normalized = normalized.slice(1)
  }

  return normalized
}

/**
 * Creates a "skeleton" version of a username for similarity checking.
 * This helps detect usernames that look similar but use different characters.
 */
export const getSkeletonUsername = (username: string): string => {
  const normalized = normalizeUsername(username)
  let skeleton = ""

  for (const char of normalized) {
    skeleton += CONFUSABLE_CHARS[char] || char
  }

  // Remove repeated characters (e.g., "llll" -> "l")
  // and underscores/hyphens for comparison
  return skeleton.replace(/(.)\1+/g, "$1").replace(/[-_]/g, "")
}

/**
 * Validates a username according to best practices.
 * @param username The username to validate
 * @returns Validation result with error message if invalid
 */
export const validateUsername = (
  username: string
): UsernameValidationResult => {
  // Handle empty input
  if (!username) {
    return { valid: false, error: null, normalized: null }
  }

  const trimmed = username.trim()

  // Check for leading/trailing spaces (before trim)
  if (trimmed !== username) {
    return {
      valid: false,
      error: "Username cannot have leading or trailing spaces",
      normalized: null,
    }
  }

  // Check for spaces
  if (trimmed.includes(" ")) {
    return {
      valid: false,
      error: "Username cannot contain spaces",
      normalized: null,
    }
  }

  // Remove @ prefix for validation
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed

  // Check minimum length
  if (withoutAt.length < USERNAME_MIN_LENGTH) {
    return {
      valid: false,
      error: `Username must be at least ${USERNAME_MIN_LENGTH} characters`,
      normalized: null,
    }
  }

  // Check maximum length
  if (withoutAt.length > USERNAME_MAX_LENGTH) {
    return {
      valid: false,
      error: `Username must be at most ${USERNAME_MAX_LENGTH} characters`,
      normalized: null,
    }
  }

  // Check allowed characters and format
  if (!USERNAME_REGEX.test(withoutAt)) {
    // Provide specific error message
    if (/^[-_]/.test(withoutAt)) {
      return {
        valid: false,
        error: "Username must start with a letter or number",
        normalized: null,
      }
    }
    return {
      valid: false,
      error:
        "Username can only contain letters, numbers, underscores, and hyphens",
      normalized: null,
    }
  }

  // Check for consecutive special characters
  if (/[-_]{2,}/.test(withoutAt)) {
    return {
      valid: false,
      error: "Username cannot have consecutive underscores or hyphens",
      normalized: null,
    }
  }

  // Check if username ends with special character
  if (/[-_]$/.test(withoutAt)) {
    return {
      valid: false,
      error: "Username cannot end with an underscore or hyphen",
      normalized: null,
    }
  }

  const normalized = normalizeUsername(withoutAt)

  // Check reserved usernames
  if (RESERVED_USERNAMES.has(normalized)) {
    return {
      valid: false,
      error: "This username is reserved",
      normalized: null,
    }
  }

  // Check for non-ASCII characters (only allow printable ASCII)
  if (!/^[\x20-\x7E]*$/.test(withoutAt)) {
    return {
      valid: false,
      error: "Username can only contain standard ASCII characters",
      normalized: null,
    }
  }

  return { valid: true, error: null, normalized }
}

/**
 * Checks if two usernames are equivalent (case-insensitive).
 */
export const usernamesMatch = (
  username1: string | null | undefined,
  username2: string | null | undefined
): boolean => {
  if (!username1 || !username2) return false
  return normalizeUsername(username1) === normalizeUsername(username2)
}

/**
 * Formats a username for display (with @ prefix).
 */
export const formatUsernameForDisplay = (username: string): string => {
  const normalized = normalizeUsername(username)
  return normalized ? `@${normalized}` : ""
}

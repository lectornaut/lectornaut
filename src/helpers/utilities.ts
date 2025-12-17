import { v4 as uuidv4, v7 as uuidv7 } from "uuid"

/**
 * Generates a UUID v7 (time-ordered)
 * Best for: database IDs, document IDs, entity IDs
 * @returns A unique time-sortable string ID
 */
export const generateId = () => {
  return uuidv7()
}

/**
 * Generates a cryptographically secure random string using UUID v4
 * Best for: OAuth state/nonce, CSRF tokens, session tokens
 * @returns A random string (UUID v4 without hyphens)
 */
export const generateRandomString = () => {
  return uuidv4().replace(/-/g, "")
}

/**
 * Extracts initials from a name string
 * @param name - The full name
 * @returns The initials (e.g., "John Doe" -> "JD")
 */
export const getInitials = (name: string) => {
  if (!name) {
    return ""
  }
  return name
    .match(/(^\S\S?|\s\S)?/g)
    ?.map((v) => v.trim())
    .join("")
    .match(/(^\S|\S$)?/g)
    ?.join("")
    .toLocaleUpperCase()
}

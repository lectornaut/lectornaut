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
 * @returns A random UUID v4 string
 */
export const generateRandomString = () => {
  return uuidv4()
}

import { v7 as uuidv7 } from "uuid"

/**
 * Generates a UUID v7
 * @returns A unique string ID
 */
export const generateId = () => {
  return uuidv7()
}

/**
 * Extracts initials from a name string
 * @param name - The full name
 * @returns The initials (e.g., "John Doe" -> "JD")
 */
export const getInitials = (name: string) => {
  if (!name) {
    return "UNNAMED USER"
  }
  return name
    .match(/(^\S\S?|\s\S)?/g)
    ?.map((v) => v.trim())
    .join("")
    .match(/(^\S|\S$)?/g)
    ?.join("")
    .toLocaleUpperCase()
}

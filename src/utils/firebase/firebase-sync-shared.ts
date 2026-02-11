import type { SyncBaseVersion } from "@/types"

const toMillis = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    const millis = (value as { toMillis: () => number }).toMillis()
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

export const buildUpdatedAtBaseVersion = (
  updatedAt: unknown
): SyncBaseVersion | null => {
  const millis = toMillis(updatedAt)
  if (millis == null) return null
  return {
    field: "updatedAt",
    value: millis,
  }
}

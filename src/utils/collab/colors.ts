const palette = [
  "#f97316",
  "#ef4444",
  "#eab308",
  "#84cc16",
  "#14b8a6",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
]

export function colorFromUserId(userId: string): string {
  const fallbackColor = "#6366f1"

  if (!userId) {
    return palette[0] ?? fallbackColor
  }

  let hash = 0
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0
  }

  return palette[hash % palette.length] ?? fallbackColor
}

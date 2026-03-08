import type { ShallowRef } from "vue"

export const FILE_CAPTURE_WINDOW_LABEL = "file-capture"

export const normalizeDroppedPaths = (paths: string[]): string[] => {
  const seen = new Set<string>()
  const normalized: string[] = []

  paths.forEach((path) => {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) return

    seen.add(trimmed)
    normalized.push(trimmed)
  })

  return normalized
}

const getDroppedPathsSignature = (paths: string[]): string => paths.join("\n")

const droppedPathsState = shallowRef<string[]>([])
let lastPublishedSignature = ""
let lastPublishedAt = 0

export const lastDroppedPaths = readonly(droppedPathsState) as Readonly<
  ShallowRef<string[]>
>

export function publishDroppedPaths(paths: string[]): void {
  const normalized = normalizeDroppedPaths(paths)

  if (!normalized.length) {
    return
  }

  const signature = getDroppedPathsSignature(normalized)
  const publishedAt = Date.now()
  const isDuplicatePublication =
    signature === lastPublishedSignature && publishedAt - lastPublishedAt < 750

  if (isDuplicatePublication) {
    return
  }

  droppedPathsState.value = normalized
  lastPublishedSignature = signature
  lastPublishedAt = publishedAt
}

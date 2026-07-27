import mime from "mime"
import type { ShallowRef } from "vue"

export const FILE_CAPTURE_WINDOW_LABEL = "file"

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

export const mergeDroppedPaths = (
  currentPaths: string[],
  nextPaths: string[]
): string[] => normalizeDroppedPaths([...currentPaths, ...nextPaths])

export const removeDroppedPath = (
  currentPaths: string[],
  pathToRemove: string
): string[] => {
  const normalizedPathToRemove = pathToRemove.trim()

  return normalizeDroppedPaths(
    currentPaths.filter((path) => path !== normalizedPathToRemove)
  )
}

export const clearDroppedPaths = (): string[] => []

const getDroppedPathsSignature = (paths: string[]): string => paths.join("\n")

const droppedPathsState = shallowRef<string[]>([])
let lastPublishedSignature = ""
let lastPublishedAt = 0

export const lastDroppedPaths = readonly(droppedPathsState) as Readonly<
  ShallowRef<string[]>
>

export function publishDroppedPaths(paths: string[]): void {
  const normalized = normalizeDroppedPaths(paths)

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

export type FileCaptureFileKind =
  | "image"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "delimited"
  | "presentation"
  | "code"
  | "archive"
  | "audio"
  | "video"
  | "font"
  | "folder"
  | "unknown"

const fileKindExtensions: Record<FileCaptureFileKind, Set<string>> = {
  image: new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "ico",
    "tif",
    "tiff",
    "avif",
    "heic",
    "heif",
  ]),
  pdf: new Set(["pdf"]),
  document: new Set(["doc", "docx", "odt", "txt", "md", "markdown", "rtf"]),
  spreadsheet: new Set(["xls", "xlsx", "ods", "numbers"]),
  delimited: new Set(["csv", "tsv"]),
  presentation: new Set(["ppt", "pptx", "odp", "key"]),
  code: new Set([
    "js",
    "ts",
    "jsx",
    "tsx",
    "vue",
    "html",
    "css",
    "scss",
    "json",
    "yaml",
    "yml",
    "xml",
    "toml",
    "ini",
    "sh",
    "py",
    "rs",
    "go",
    "java",
    "kt",
    "swift",
    "php",
    "rb",
    "sql",
  ]),
  archive: new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz"]),
  audio: new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a"]),
  video: new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v"]),
  font: new Set(["ttf", "otf", "woff", "woff2"]),
  folder: new Set(),
  unknown: new Set(),
}

export const getFileNameFromPath = (path: string): string => {
  const segments = path.split(/[/\\]/)
  return segments.at(-1) || path
}

export const getFileExtensionFromPath = (path: string): string => {
  const fileName = getFileNameFromPath(path)
  const extension = fileName.split(".").at(-1)

  if (!extension || extension === fileName) {
    return ""
  }

  return extension.toLowerCase()
}

export const getFileKindFromPath = (path: string): FileCaptureFileKind => {
  const extension = getFileExtensionFromPath(path)

  if (!extension) {
    return "unknown"
  }

  for (const [kind, extensions] of Object.entries(fileKindExtensions)) {
    if (extensions.has(extension)) {
      return kind as FileCaptureFileKind
    }
  }

  return "unknown"
}

export const isImageFilePath = (path: string): boolean =>
  getFileKindFromPath(path) === "image"

const GENERIC_BINARY_MIME_TYPE = "application/octet-stream"

export const resolveMimeTypeFromFileName = (
  fileName: string
): string | null => {
  return mime.getType(fileName)
}

export const resolveMimeTypeForUpload = (input: {
  fileName: string
  mimeType?: string | null
}): string | null => {
  const normalizedMimeType = input.mimeType?.trim().toLowerCase() ?? ""
  const fallbackMimeType = normalizedMimeType || null

  if (normalizedMimeType && normalizedMimeType !== GENERIC_BINARY_MIME_TYPE) {
    return normalizedMimeType
  }

  return resolveMimeTypeFromFileName(input.fileName) ?? fallbackMimeType
}

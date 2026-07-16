import {
  IconFileCode,
  IconFileDelimited,
  IconFileDocument,
  IconFileExcel,
  IconFileImage,
  IconFilePdf,
  IconFilePowerPoint,
  IconFileQuestion,
  IconFileText,
  IconFileVideo,
  IconFileWord,
} from "@/data/icons"
import { type WorkspaceNodeScope } from "@/types/nodes"
import type { Component } from "vue"

// Size + blocked-type gates live in the shared domain contract — the
// server-side Drive import must apply the SAME limits (admin SDK bypasses
// storage.rules), so both TS sides read one source. storage.rules keeps a
// manual copy (rules can't import TS).
export {
  isBlockedAttachmentMimeType,
  NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES,
} from "@lectornaut/shared/domain"

export const NODE_ATTACHMENTS_STORAGE_ROOT = "attachments"

const INVALID_STORAGE_FILENAME_CHARS = /[\\/:*?"<>|]+/g

const isControlChar = (code: number) => code <= 0x1f || code === 0x7f

const stripControlChars = (value: string): string =>
  Array.from(value)
    .filter((ch) => !isControlChar(ch.charCodeAt(0)))
    .join("")

export interface WorkspaceNodeAttachmentPathParams {
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  nodeId: string
  attachmentId: string
}

export interface WorkspaceNodeAttachmentStoragePathParams extends WorkspaceNodeAttachmentPathParams {
  version: string
  fileName: string
}

export const normalizeAttachmentDisplayName = (value: string): string =>
  value.trim().replace(/\s+/g, " ")

export const sanitizeAttachmentFileName = (value: string): string => {
  const sanitized = stripControlChars(value.trim())
    .replace(INVALID_STORAGE_FILENAME_CHARS, "-")
    .replace(/\s+/g, " ")

  return sanitized || "file"
}

export const getWorkspaceNodeAttachmentsCollectionPath = (
  teamId: string,
  workspaceId: string,
  scope: WorkspaceNodeScope,
  nodeId: string
) => `teams/${teamId}/workspaces/${workspaceId}/${scope}/${nodeId}/attachments`

export const getWorkspaceNodeAttachmentStoragePrefix = ({
  teamId,
  workspaceId,
  scope,
  nodeId,
  attachmentId,
}: WorkspaceNodeAttachmentPathParams) =>
  `${NODE_ATTACHMENTS_STORAGE_ROOT}/teams/${teamId}/workspaces/${workspaceId}/${scope}/${nodeId}/${attachmentId}`

export const buildWorkspaceNodeAttachmentStoragePath = ({
  version,
  fileName,
  ...params
}: WorkspaceNodeAttachmentStoragePathParams) =>
  `${getWorkspaceNodeAttachmentStoragePrefix(params)}/${version}/${sanitizeAttachmentFileName(fileName)}`

// ─── Bot chat-session attachments ────────────────────────────────────────────
// Same storage root + sanitize/blocked-mime/size rules as node attachments,
// with `botSessions/{sessionId}` occupying the `{scope}/{nodeId}` slot.

export interface BotSessionAttachmentPathParams {
  teamId: string
  workspaceId: string
  sessionId: string
  attachmentId: string
}

export interface BotSessionAttachmentStoragePathParams extends BotSessionAttachmentPathParams {
  version: string
  fileName: string
}

export const getBotSessionAttachmentsCollectionPath = (
  teamId: string,
  workspaceId: string,
  sessionId: string
) =>
  `teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}/attachments`

export const getBotSessionAttachmentStoragePrefix = ({
  teamId,
  workspaceId,
  sessionId,
  attachmentId,
}: BotSessionAttachmentPathParams) =>
  `${NODE_ATTACHMENTS_STORAGE_ROOT}/teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}/${attachmentId}`

export const buildBotSessionAttachmentStoragePath = ({
  version,
  fileName,
  ...params
}: BotSessionAttachmentStoragePathParams) =>
  `${getBotSessionAttachmentStoragePrefix(params)}/${version}/${sanitizeAttachmentFileName(fileName)}`

// Shared file-type icon for attachment cards — SessionAttachments and
// NodeAttachments render the same mark for the same file.
export const resolveAttachmentIcon = (attachment: {
  mimeType?: string | null
  originalName?: string
}): Component => {
  const mimeType = attachment.mimeType?.toLowerCase() ?? ""
  const fileName = attachment.originalName?.toLowerCase() ?? ""

  if (mimeType.startsWith("image/")) return IconFileImage
  if (mimeType.startsWith("video/")) return IconFileVideo
  if (mimeType.includes("pdf") || fileName.endsWith(".pdf")) return IconFilePdf
  if (mimeType.includes("spreadsheet") || /\.(csv|tsv)$/i.test(fileName)) {
    return fileName.endsWith(".csv") || fileName.endsWith(".tsv")
      ? IconFileDelimited
      : IconFileExcel
  }
  if (mimeType.includes("presentation") || /\.(ppt|pptx)$/i.test(fileName)) {
    return IconFilePowerPoint
  }
  if (
    mimeType.includes("wordprocessingml") ||
    mimeType.includes("msword") ||
    /\.(doc|docx)$/i.test(fileName)
  ) {
    return IconFileWord
  }
  if (
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("xml") ||
    mimeType.includes("yaml") ||
    /\.(astro|cjs|css|go|html|java|js|json|jsx|md|mjs|py|rb|rs|sh|sql|svg|toml|ts|tsx|vue|xml|yaml|yml)$/i.test(
      fileName
    )
  ) {
    return IconFileCode
  }
  if (mimeType.startsWith("text/") || /\.(md|rtf|txt)$/i.test(fileName)) {
    return IconFileText
  }
  if (
    mimeType.includes("officedocument") ||
    mimeType.includes("opendocument")
  ) {
    return IconFileDocument
  }

  return IconFileQuestion
}

export const formatAttachmentSize = (
  size: number | null | undefined
): string => {
  if (
    !Number.isFinite(size) ||
    size === null ||
    size === undefined ||
    size < 0
  ) {
    return "—"
  }

  if (size < 1024) {
    return `${size} B`
  }

  const units = ["KB", "MB", "GB", "TB"]
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1)
  return `${rounded} ${units[unitIndex]}`
}

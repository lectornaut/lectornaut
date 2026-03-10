import { type WorkspaceNodeScope } from "@/types/nodes"

export const NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
export const NODE_ATTACHMENTS_STORAGE_ROOT = "attachments"

const INVALID_STORAGE_FILENAME_CHARS = /[\\/:*?"<>|]+/g
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g

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
  const sanitized = value
    .trim()
    .replace(CONTROL_CHARS, "")
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

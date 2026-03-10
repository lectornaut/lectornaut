import type { WorkspaceNodeScope } from "./types.js"

export const ATTACHMENT_NAME_MAX_LENGTH = 255
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

export const workspaceNodeAttachmentsCollectionPath = (
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

export const isWorkspaceNodeAttachmentStoragePath = (
  path: string,
  params: WorkspaceNodeAttachmentPathParams
) => path.startsWith(`${getWorkspaceNodeAttachmentStoragePrefix(params)}/`)

import type { WorkspaceNodeScope } from "./types.js"

export const ATTACHMENT_NAME_MAX_LENGTH = 255
export const NODE_ATTACHMENTS_STORAGE_ROOT = "attachments"

const INVALID_STORAGE_FILENAME_CHARS = /[\\/:*?"<>|]+/g
// Stripping control characters from filenames is the explicit intent
// here — they're a security risk in storage paths.
// eslint-disable-next-line no-control-regex
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

// ---------------------------------------------------------------------------
// Bot chat-session attachments
//
// Same storage root + sanitize/blocked-mime rules as node attachments, but
// `botSessions/{sessionId}` occupies the `{scope}/{nodeId}` slot of the
// layout. Keeping them under the same `attachments/` root means the existing
// node storage rule simply denies them (`isWorkspaceNodeScope("botSessions")`
// is false) and a dedicated session rule grants them.
// ---------------------------------------------------------------------------

export interface BotSessionAttachmentPathParams {
  teamId: string
  workspaceId: string
  sessionId: string
  attachmentId: string
}

export const botSessionAttachmentsCollectionPath = (
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

export const isBotSessionAttachmentStoragePath = (
  path: string,
  params: BotSessionAttachmentPathParams
) => path.startsWith(`${getBotSessionAttachmentStoragePrefix(params)}/`)

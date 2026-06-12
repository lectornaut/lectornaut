/**
 * Google Drive D3 — server-side Drive browsing + import-to-attachment
 * (docs/connections-google-drive-d3.prompt.md).
 *
 * The in-app picker replaces Google's Picker widget so OAuth tokens NEVER
 * reach the browser: both callables resolve the CALLER's own binding via
 * `resolveBindingAccessToken` (never a workflow `actsAsUid` — these are
 * interactive verbs), and the import moves bytes Google→Functions→Storage
 * entirely server-side.
 *
 * Imports land in the SAME pipeline as direct uploads: canonical storage
 * path, `materializeSessionAttachments` metadata doc, and — because the
 * admin SDK bypasses storage.rules — the same 25MB + blocked-mime gates,
 * applied here (`nodeAttachments.ts` server mirrors). Deliberately NO audit
 * event: direct uploads don't log either (chat attachments are ephemeral).
 */

import { getStorage } from "firebase-admin/storage"
import { HttpsError } from "firebase-functions/v2/https"
import { z } from "zod"
import {
  assertBotSessionAttachmentWritable,
  buildContext,
  createNodeAttachmentDoc,
} from "./audit.js"
import { authorize, requireAuthorized } from "./authorize.js"
import { getMembershipRole } from "./bot.js"
import { materializeSessionAttachments } from "./botMedia.js"
import { resolveBindingAccessToken } from "./connections.js"
import { defineCallable } from "./defineCallable.js"
import { NODE_SCOPES } from "./domain.js"
import {
  buildDriveListQuery,
  clampDriveSearchInput,
  compactDriveFiles,
  DRIVE_FILE_FIELDS,
  DRIVE_MAX_RESULTS_CAP,
  driveImportFileName,
  extractDriveFileId,
  planDriveImport,
  type CompactDriveFile,
} from "./driveCore.js"
import { db } from "./firebase.js"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  getBotSessionAttachmentStoragePrefix,
  getWorkspaceNodeAttachmentStoragePrefix,
  isBlockedAttachmentMimeType,
  NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  normalizeAttachmentDisplayName,
  sanitizeAttachmentFileName,
} from "./nodeAttachments.js"
import { Capabilities } from "./types.js"

const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files"

/**
 * Map a binding failure onto a client-facing error. Unlike the chat tools
 * (whose copy steers the MODEL), these messages surface in toasts.
 */
function throwBindingError(
  reason: "not_connected" | "needs_reauth" | "config" | "transient" | "disabled"
): never {
  switch (reason) {
    case "not_connected":
      throw new HttpsError(
        "failed-precondition",
        "Connect your Google Drive account under Settings → Connections first."
      )
    case "needs_reauth":
      throw new HttpsError(
        "failed-precondition",
        "Your Google Drive connection needs re-authorization — reconnect it " +
          "under Settings → Connections."
      )
    case "disabled":
      throw new HttpsError(
        "failed-precondition",
        "Google Drive is disabled for this team. An owner or admin must " +
          "re-enable it under Settings → Connections."
      )
    case "config":
      throw new HttpsError(
        "failed-precondition",
        "Google Drive is unavailable: the server's Google OAuth client " +
          "isn't configured."
      )
    case "transient":
      throw new HttpsError(
        "unavailable",
        "Couldn't reach Google Drive just now. Try again shortly."
      )
  }
}

function throwDriveApiError(status: number): never {
  if (status === 401 || status === 403) {
    throw new HttpsError(
      "permission-denied",
      "Google Drive rejected the connection's authorization — try " +
        "reconnecting it under Settings → Connections."
    )
  }
  throw new HttpsError(
    "unavailable",
    `Google Drive returned an error (HTTP ${status}). Try again shortly.`
  )
}

async function fetchDriveJson(
  accessToken: string,
  url: URL
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    }
  } catch {
    throw new HttpsError(
      "unavailable",
      "Couldn't reach Google Drive just now. Try again shortly."
    )
  }
}

// ─── listDriveFiles — the picker's browse/search backend ────────────────────

const listDriveFilesInput = z.object({
  teamId: z.string().min(1),
  query: z.string().max(500).optional(),
  mimeClass: z.string().max(50).optional(),
  folderId: z.string().max(2048).optional(),
  /** Opaque Drive cursor from a previous page's `nextPageToken`. */
  pageToken: z.string().min(1).max(2048).optional(),
})

export const listDriveFiles = defineCallable({
  name: "listDriveFiles",
  auth: "verified",
  appCheck: true,
  input: listDriveFilesInput,
  handler: async ({ auth, input }) => {
    const { teamId } = input
    // Member gate — browsing is always the caller's OWN Drive.
    await getMembershipRole(teamId, auth.uid)

    const token = await resolveBindingAccessToken(
      teamId,
      "google-drive",
      auth.uid
    )
    if (!token.ok) throwBindingError(token.reason)

    const params = clampDriveSearchInput(input)
    const { q, orderBy } = buildDriveListQuery(params)
    const url = new URL(DRIVE_FILES_ENDPOINT)
    url.searchParams.set("q", q)
    url.searchParams.set("pageSize", String(DRIVE_MAX_RESULTS_CAP))
    url.searchParams.set("fields", `nextPageToken,files(${DRIVE_FILE_FIELDS})`)
    url.searchParams.set("corpora", "allDrives")
    url.searchParams.set("includeItemsFromAllDrives", "true")
    url.searchParams.set("supportsAllDrives", "true")
    if (orderBy) url.searchParams.set("orderBy", orderBy)
    if (input.pageToken) url.searchParams.set("pageToken", input.pageToken)

    const { status, body } = await fetchDriveJson(token.accessToken, url)
    if (status < 200 || status >= 300) throwDriveApiError(status)

    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {}
    return {
      files: compactDriveFiles(record.files, DRIVE_MAX_RESULTS_CAP),
      nextPageToken:
        typeof record.nextPageToken === "string" && record.nextPageToken
          ? record.nextPageToken
          : null,
    }
  },
})

// ─── importDriveSessionAttachment — fetch bytes, store, create the doc ──────

const importDriveAttachmentInput = z.object({
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  /** Drive file id or URL, as returned by listDriveFiles. */
  fileId: z.string().min(1).max(2048),
})

/** One shortcut hop: fetch metadata, resolve to the target's compact row. */
async function fetchCompactDriveFile(
  accessToken: string,
  fileId: string
): Promise<CompactDriveFile> {
  const metaUrl = (id: string) => {
    const url = new URL(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(id)}`)
    url.searchParams.set("fields", DRIVE_FILE_FIELDS)
    url.searchParams.set("supportsAllDrives", "true")
    return url
  }
  const { status, body } = await fetchDriveJson(accessToken, metaUrl(fileId))
  if (status === 404) {
    throw new HttpsError("not-found", "That file wasn't found in your Drive.")
  }
  if (status < 200 || status >= 300) throwDriveApiError(status)
  let file = compactDriveFiles([body], 1)[0] ?? null
  if (!file) {
    throw new HttpsError(
      "unavailable",
      "Google Drive returned an unreadable file record."
    )
  }
  if (file.id !== fileId) {
    const hop = await fetchDriveJson(accessToken, metaUrl(file.id))
    if (hop.status >= 200 && hop.status < 300) {
      file = compactDriveFiles([hop.body], 1)[0] ?? file
    }
  }
  return file
}

/**
 * Everything between "I have a token + file id" and "I have storable bytes":
 * metadata fetch (with shortcut hop), import planning, the 25MB/blocked-mime
 * gates, and the content download. Shared by the session- and node-attachment
 * import callables — the two differ only in their authorization gates and
 * where the attachment lands.
 */
interface DriveImportPayload {
  bytes: Buffer
  contentType: string
  /** Sanitized storage file name (export extension applied). */
  fileName: string
  /** Drive-side display name, pre-sanitization. */
  displayName: string
}

async function fetchDriveImportPayload(
  accessToken: string,
  fileId: string
): Promise<DriveImportPayload> {
  const file = await fetchCompactDriveFile(accessToken, fileId)
  const plan = planDriveImport(file.mimeType)
  if (plan.kind === "skip") {
    throw new HttpsError("failed-precondition", plan.reason)
  }
  // Pre-checks where metadata allows: media size is known up front, and a
  // blocked source type can't become acceptable by downloading it.
  if (
    plan.kind === "media" &&
    file.size !== null &&
    file.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES
  ) {
    throw new HttpsError(
      "failed-precondition",
      "That file is too large to import (max 25 MB)."
    )
  }
  const contentType = plan.kind === "export" ? plan.exportMime : file.mimeType
  if (isBlockedAttachmentMimeType(contentType)) {
    throw new HttpsError(
      "failed-precondition",
      "That file type can't be attached."
    )
  }

  const contentUrl = new URL(
    plan.kind === "export"
      ? `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(file.id)}/export`
      : `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(file.id)}`
  )
  if (plan.kind === "export") {
    contentUrl.searchParams.set("mimeType", plan.exportMime)
  } else {
    contentUrl.searchParams.set("alt", "media")
    contentUrl.searchParams.set("supportsAllDrives", "true")
  }
  let bytes: Buffer
  try {
    const response = await fetch(contentUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (response.status < 200 || response.status >= 300) {
      throwDriveApiError(response.status)
    }
    bytes = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError(
      "unavailable",
      "Couldn't download the file from Google Drive. Try again shortly."
    )
  }
  // Post-fetch size check covers exports (no size known up front) and
  // size-less media rows.
  if (bytes.byteLength > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
    throw new HttpsError(
      "failed-precondition",
      "That file is too large to import (max 25 MB)."
    )
  }

  const fileName = sanitizeAttachmentFileName(
    plan.kind === "export"
      ? driveImportFileName(file.name, plan.extension)
      : file.name
  )
  return { bytes, contentType, fileName, displayName: file.name }
}

export const importDriveSessionAttachment = defineCallable({
  name: "importDriveSessionAttachment",
  auth: "verified",
  appCheck: true,
  input: importDriveAttachmentInput,
  handler: async ({ auth, input }) => {
    const { teamId, workspaceId, sessionId } = input
    const fileId = extractDriveFileId(input.fileId)
    if (!fileId) {
      throw new HttpsError(
        "invalid-argument",
        "fileId must be a Drive file id or URL."
      )
    }

    // Same two-layer gate as `createBotSessionAttachment`: the team-level
    // content capability plus the session's own access model.
    const role =
      requireAuthorized(
        await authorize(auth.uid, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage chat attachments."
      ).teamRole ?? undefined
    const sessionSnap = await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/botSessions/${sessionId}`)
      .get()
    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "Chat session not found.")
    }
    assertBotSessionAttachmentWritable(sessionSnap.data() ?? {}, auth.uid, role)

    const token = await resolveBindingAccessToken(
      teamId,
      "google-drive",
      auth.uid
    )
    if (!token.ok) throwBindingError(token.reason)

    const { bytes, contentType, fileName, displayName } =
      await fetchDriveImportPayload(token.accessToken, fileId)
    const attachmentId = db.collection("_ids").doc().id
    // `/1/` is the version segment — imports are always a fresh attachment,
    // so they start at version 1 like client uploads do.
    const storagePath = `${getBotSessionAttachmentStoragePrefix({
      teamId,
      workspaceId,
      sessionId,
      attachmentId,
    })}/1/${fileName}`

    const storageFile = getStorage().bucket().file(storagePath)
    await storageFile.save(bytes, {
      contentType,
      resumable: false,
    })
    try {
      await materializeSessionAttachments({
        teamId,
        workspaceId,
        sessionId,
        actorId: auth.uid,
        pendingAttachments: [
          {
            attachmentId,
            storagePath,
            displayName,
            originalName: fileName,
          },
        ],
      })
    } catch (error) {
      // Don't leak the orphaned blob if the metadata doc failed to commit.
      await storageFile.delete({ ignoreNotFound: true }).catch(() => undefined)
      throw error
    }

    return {
      attachmentId,
      displayName,
      mimeType: contentType,
      size: bytes.byteLength,
    }
  },
})

// ─── importDriveNodeAttachment — same import, landing on a workspace node ────

const importDriveNodeAttachmentInput = z.object({
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  scope: z.enum(NODE_SCOPES),
  nodeId: z.string().min(1),
  /** Drive file id or URL, as returned by listDriveFiles. */
  fileId: z.string().min(1).max(2048),
})

export const importDriveNodeAttachment = defineCallable({
  name: "importDriveNodeAttachment",
  auth: "verified",
  appCheck: true,
  input: importDriveNodeAttachmentInput,
  handler: async ({ auth, input, request }) => {
    const { teamId, workspaceId, scope, nodeId } = input
    const fileId = extractDriveFileId(input.fileId)
    if (!fileId) {
      throw new HttpsError(
        "invalid-argument",
        "fileId must be a Drive file id or URL."
      )
    }

    // Same gate as `createWorkspaceNodeAttachment` (direct uploads).
    const role =
      requireAuthorized(
        await authorize(auth.uid, Capabilities.MANAGE_WORKSPACE_CONTENT, {
          teamId,
          workspaceId,
        }),
        "You do not have permission to manage workspace attachments."
      ).teamRole ?? undefined

    // Fail fast before paying the Drive round-trips; the doc-create
    // transaction inside `createNodeAttachmentDoc` re-validates both
    // authoritatively.
    const nodeSnap = await db
      .doc(`teams/${teamId}/workspaces/${workspaceId}/${scope}/${nodeId}`)
      .get()
    if (!nodeSnap.exists) {
      throw new HttpsError("not-found", "Node not found.")
    }
    if (nodeSnap.data()?.isArchived) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot add attachments to an archived node."
      )
    }

    const token = await resolveBindingAccessToken(
      teamId,
      "google-drive",
      auth.uid
    )
    if (!token.ok) throwBindingError(token.reason)

    const { bytes, contentType, fileName, displayName } =
      await fetchDriveImportPayload(token.accessToken, fileId)
    const attachmentId = db.collection("_ids").doc().id
    // `/1/` is the version segment — imports are always a fresh attachment,
    // so they start at version 1 like client uploads do.
    const storagePath = `${getWorkspaceNodeAttachmentStoragePrefix({
      teamId,
      workspaceId,
      scope,
      nodeId,
      attachmentId,
    })}/1/${fileName}`

    const storageFile = getStorage().bucket().file(storagePath)
    await storageFile.save(bytes, {
      contentType,
      resumable: false,
    })
    try {
      // Same normalize-or-fallback recipe as `materializeSessionAttachments`
      // — the Drive name is server-fetched but still external input.
      const docDisplayName =
        (
          normalizeAttachmentDisplayName(displayName) ||
          normalizeAttachmentDisplayName(fileName) ||
          "File"
        ).slice(0, ATTACHMENT_NAME_MAX_LENGTH) || "File"
      await createNodeAttachmentDoc({
        teamId,
        workspaceId,
        scope,
        nodeId,
        attachmentId,
        displayName: docDisplayName,
        originalName: fileName,
        storagePath,
        mimeType: contentType,
        size: bytes.byteLength,
        actorId: auth.uid,
        actorEmail: auth.token.email ?? undefined,
        role,
        context: buildContext(request),
      })
    } catch (error) {
      // Don't leak the orphaned blob if the metadata doc failed to commit.
      await storageFile.delete({ ignoreNotFound: true }).catch(() => undefined)
      throw error
    }

    return {
      attachmentId,
      displayName,
      mimeType: contentType,
      size: bytes.byteLength,
    }
  },
})

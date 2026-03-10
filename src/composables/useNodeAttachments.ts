import {
  createWorkspaceNodeAttachment as createWorkspaceNodeAttachmentCallable,
  deleteWorkspaceNodeAttachment as deleteWorkspaceNodeAttachmentCallable,
  updateWorkspaceNodeAttachment as updateWorkspaceNodeAttachmentCallable,
} from "@/composables/useFunctions"
import { generateId } from "@/helpers/utilities"
import { resolveMimeTypeForUpload } from "@/modules/fileCapture"
import { firestore } from "@/modules/firebase"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  type WorkspaceNodeScope,
} from "@/types/nodes"
import {
  deleteStorageFile,
  getStorageFileRef,
} from "@/utils/firebase/firebase-helpers"
import {
  buildWorkspaceNodeAttachmentStoragePath,
  getWorkspaceNodeAttachmentsCollectionPath,
  NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  normalizeAttachmentDisplayName,
  sanitizeAttachmentFileName,
} from "@/utils/firebase/firebase-node-attachments"
import { doc, getDoc } from "firebase/firestore"
import { uploadBytes } from "firebase/storage"

export interface AttachmentMutationContext {
  teamId: string
  workspaceId: string
  nodeId: string
  scope: WorkspaceNodeScope
}

export const createWorkspaceNodeAttachment =
  createWorkspaceNodeAttachmentCallable
export const updateWorkspaceNodeAttachment =
  updateWorkspaceNodeAttachmentCallable
export const deleteWorkspaceNodeAttachment =
  deleteWorkspaceNodeAttachmentCallable

const getAttachmentDocRef = (
  context: AttachmentMutationContext,
  attachmentId: string
) =>
  doc(
    firestore,
    getWorkspaceNodeAttachmentsCollectionPath(
      context.teamId,
      context.workspaceId,
      context.scope,
      context.nodeId
    ),
    attachmentId
  )

export const validateAttachmentDisplayName = (value: string) => {
  const normalized = normalizeAttachmentDisplayName(value)
  if (!normalized.length) {
    throw new Error("File name is required.")
  }
  if (normalized.length > ATTACHMENT_NAME_MAX_LENGTH) {
    throw new Error(
      `File name must be ${ATTACHMENT_NAME_MAX_LENGTH} characters or fewer.`
    )
  }
  return normalized
}

export const uploadNodeAttachmentBlob = async (
  file: File,
  attachmentId: string,
  context: AttachmentMutationContext
): Promise<string> => {
  const contentType = resolveMimeTypeForUpload({
    fileName: file.name,
    mimeType: file.type,
  })
  const version = generateId()
  const storagePath = buildWorkspaceNodeAttachmentStoragePath({
    teamId: context.teamId,
    workspaceId: context.workspaceId,
    scope: context.scope,
    nodeId: context.nodeId,
    attachmentId,
    version,
    fileName: sanitizeAttachmentFileName(file.name),
  })

  await uploadBytes(
    getStorageFileRef(storagePath),
    file,
    contentType ? { contentType } : undefined
  )
  return storagePath
}

export const resolveWorkspaceNodeAttachmentCommitState = async (
  context: AttachmentMutationContext,
  attachmentId: string,
  expectedStoragePath: string
): Promise<boolean | null> => {
  try {
    const attachmentSnap = await getDoc(
      getAttachmentDocRef(context, attachmentId)
    )

    if (!attachmentSnap.exists()) {
      return false
    }

    return attachmentSnap.data()?.storagePath === expectedStoragePath
  } catch (error) {
    console.warn(
      "[useNodeAttachments] Failed to verify attachment state after mutation error:",
      error
    )
    return null
  }
}

export const resolveWorkspaceNodeAttachmentDeletionState = async (
  context: AttachmentMutationContext,
  attachmentId: string
): Promise<boolean | null> => {
  try {
    const attachmentSnap = await getDoc(
      getAttachmentDocRef(context, attachmentId)
    )

    return !attachmentSnap.exists()
  } catch (error) {
    console.warn(
      "[useNodeAttachments] Failed to verify attachment deletion after mutation error:",
      error
    )
    return null
  }
}

export const createWorkspaceNodeAttachmentFromFile = async (
  file: File,
  context: AttachmentMutationContext
) => {
  if (file.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
    throw new Error("Each attachment must be 25 MB or smaller.")
  }

  const attachmentId = generateId()
  const displayName = validateAttachmentDisplayName(file.name)
  const storagePath = await uploadNodeAttachmentBlob(
    file,
    attachmentId,
    context
  )

  try {
    await createWorkspaceNodeAttachment({
      scope: context.scope,
      teamId: context.teamId,
      workspaceId: context.workspaceId,
      nodeId: context.nodeId,
      attachmentId,
      displayName,
      originalName: file.name,
      storagePath,
    })
  } catch (uploadError) {
    const committed = await resolveWorkspaceNodeAttachmentCommitState(
      context,
      attachmentId,
      storagePath
    )

    if (committed === true) {
      return
    }

    if (committed === false) {
      await deleteStorageFile(storagePath)
    }

    throw uploadError
  }
}

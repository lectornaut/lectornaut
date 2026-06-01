import {
  createWorkspaceNodeAttachment as createWorkspaceNodeAttachmentCallable,
  deleteWorkspaceNodeAttachment as deleteWorkspaceNodeAttachmentCallable,
  updateWorkspaceNodeAttachment as updateWorkspaceNodeAttachmentCallable,
} from "@/composables/useFunctions"
import {
  buildWorkspaceNodeAttachmentStoragePath,
  getWorkspaceNodeAttachmentsCollectionPath,
  isBlockedAttachmentMimeType,
  NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  normalizeAttachmentDisplayName,
  sanitizeAttachmentFileName,
} from "@/helpers/node-attachments"
import { generateId } from "@/helpers/utilities"
import { resolveMimeTypeForUpload } from "@/modules/fileCapture"
import { firestore } from "@/modules/firebase"
import { queryClient } from "@/modules/queryClient"
import { zodConverter } from "@/schemas/_utils"
import { workspaceNodeAttachmentSchema } from "@/schemas/nodes"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  type WorkspaceNodeAttachment,
  type WorkspaceNodeScope,
} from "@/types/nodes"
import { getDocCached } from "@/utils/firebase/firebase-cache"
import {
  deleteStorageFile,
  getStorageFileRef,
} from "@/utils/firebase/firebase-helpers"
import {
  addPending,
  createPendingSet,
  removePending,
  withCloudSyncOperation,
} from "@/utils/firebase/firebase-optimistic"
import {
  holdOptimistic,
  useCollectionQuery,
} from "@/utils/firebase/firebase-query"
import {
  queryKeys,
  type FirestoreQueryKey,
} from "@/utils/firebase/firebase-query-keys"
import { collection, doc, orderBy, query, Timestamp } from "firebase/firestore"
import { uploadBytes } from "firebase/storage"
import {
  computed,
  onUnmounted,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
} from "vue"

// Read-side converter so `useCollectionQuery` parses/validates attachment docs
// (the collection has no ref-level converter; reads used `toAttachment` before).
const attachmentConverter = zodConverter<WorkspaceNodeAttachment>(
  workspaceNodeAttachmentSchema,
  "attachment"
)

export interface AttachmentMutationContext {
  teamId: string
  workspaceId: string
  nodeId: string
  scope: WorkspaceNodeScope
}

export interface CreateWorkspaceNodeAttachmentOptions {
  attachmentId?: string
}

export interface CreatedWorkspaceNodeAttachmentResult {
  attachmentId: string
  displayName: string
  originalName: string
  storagePath: string
}

export interface UpdateWorkspaceNodeAttachmentInput {
  context: AttachmentMutationContext
  attachment: WorkspaceNodeAttachment
  displayName: string
  replacementFile?: File | null
}

export interface UpdatedWorkspaceNodeAttachmentResult {
  displayName: string
  originalName: string
  storagePath: string
  mimeType: string | null
  size: number | null
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

const toTimestampMs = (
  value:
    | {
        toDate?: () => Date
      }
    | null
    | undefined
) => value?.toDate?.().getTime() ?? 0

const sortAttachments = (attachments: WorkspaceNodeAttachment[]) =>
  [...attachments].sort(
    (left, right) =>
      toTimestampMs(right.updatedAt ?? right.createdAt) -
      toTimestampMs(left.updatedAt ?? left.createdAt)
  )

const createOptimisticAttachment = (
  file: File,
  attachmentId: string,
  context: AttachmentMutationContext
): WorkspaceNodeAttachment => {
  const now = Timestamp.now()

  return {
    id: attachmentId,
    workspaceId: context.workspaceId,
    nodeId: context.nodeId,
    scope: context.scope,
    displayName: validateAttachmentDisplayName(file.name),
    originalName: file.name,
    storagePath: "",
    mimeType: resolveMimeTypeForUpload({
      fileName: file.name,
      mimeType: file.type,
    }),
    size: file.size,
    createdAt: now,
    createdBy: "local",
    updatedAt: now,
    updatedBy: "local",
  }
}

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
  if (isBlockedAttachmentMimeType(contentType)) {
    throw new Error(
      `${file.name} can't be uploaded. SVG, HTML, and other executable file types are blocked for security.`
    )
  }
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
    const attachmentSnap = await getDocCached(
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
    const attachmentSnap = await getDocCached(
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
  context: AttachmentMutationContext,
  options: CreateWorkspaceNodeAttachmentOptions = {}
): Promise<CreatedWorkspaceNodeAttachmentResult> => {
  if (file.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
    throw new Error("Each attachment must be 25 MB or smaller.")
  }

  const attachmentId = options.attachmentId ?? generateId()
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

    if (committed !== true) {
      if (committed === false) {
        await deleteStorageFile(storagePath)
      }
      throw uploadError
    }
  }

  return {
    attachmentId,
    displayName,
    originalName: file.name,
    storagePath,
  }
}

export const updateWorkspaceNodeAttachmentEntry = async ({
  context,
  attachment,
  displayName,
  replacementFile,
}: UpdateWorkspaceNodeAttachmentInput): Promise<UpdatedWorkspaceNodeAttachmentResult> => {
  const normalizedDisplayName = validateAttachmentDisplayName(displayName)
  const nextFile = replacementFile ?? null

  if (nextFile && nextFile.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
    throw new Error("Replacement files must be 25 MB or smaller.")
  }

  let nextStoragePath: string | null = null

  if (nextFile) {
    nextStoragePath = await uploadNodeAttachmentBlob(
      nextFile,
      attachment.id,
      context
    )
  }

  try {
    await updateWorkspaceNodeAttachment({
      scope: context.scope,
      teamId: context.teamId,
      workspaceId: context.workspaceId,
      nodeId: context.nodeId,
      attachmentId: attachment.id,
      displayName: normalizedDisplayName,
      ...(nextStoragePath && nextFile
        ? {
            storagePath: nextStoragePath,
            originalName: nextFile.name,
          }
        : {}),
    })
  } catch (updateError) {
    if (!nextStoragePath) {
      throw updateError
    }

    const committed = await resolveWorkspaceNodeAttachmentCommitState(
      context,
      attachment.id,
      nextStoragePath
    )

    if (committed === true) {
      return {
        displayName: normalizedDisplayName,
        originalName: nextFile?.name ?? attachment.originalName,
        storagePath: nextStoragePath,
        mimeType:
          resolveMimeTypeForUpload({
            fileName: nextFile?.name ?? attachment.originalName,
            mimeType: nextFile?.type,
          }) ?? null,
        size: nextFile?.size ?? attachment.size ?? null,
      }
    }

    if (committed === false) {
      await deleteStorageFile(nextStoragePath)
      throw updateError
    }

    throw new Error(
      "Attachment update status is unclear. Refresh before retrying to avoid a duplicate upload.",
      { cause: updateError }
    )
  }

  return {
    displayName: normalizedDisplayName,
    originalName: nextFile?.name ?? attachment.originalName,
    storagePath: nextStoragePath ?? attachment.storagePath,
    mimeType:
      resolveMimeTypeForUpload({
        fileName: nextFile?.name ?? attachment.originalName,
        mimeType: nextFile?.type ?? attachment.mimeType ?? undefined,
      }) ?? null,
    size: nextFile?.size ?? attachment.size ?? null,
  }
}

export const deleteWorkspaceNodeAttachmentEntry = async (
  context: AttachmentMutationContext,
  attachmentId: string
): Promise<void> => {
  try {
    await deleteWorkspaceNodeAttachment({
      scope: context.scope,
      teamId: context.teamId,
      workspaceId: context.workspaceId,
      nodeId: context.nodeId,
      attachmentId,
    })
  } catch (deleteError) {
    const committed = await resolveWorkspaceNodeAttachmentDeletionState(
      context,
      attachmentId
    )

    if (committed === true) {
      return
    }

    throw deleteError
  }
}

export function useNodeAttachmentsState(
  context: MaybeRefOrGetter<AttachmentMutationContext | null>
) {
  const pendingAttachmentIds = shallowRef(createPendingSet())

  const attachmentsCacheKey = (
    ctx: AttachmentMutationContext
  ): FirestoreQueryKey =>
    queryKeys.list(
      getWorkspaceNodeAttachmentsCollectionPath(
        ctx.teamId,
        ctx.workspaceId,
        ctx.scope,
        ctx.nodeId
      )
    )

  // Realtime attachment list (TanStack Query + onSnapshot), parsed via the Zod
  // converter. Optimistic writes apply directly into this cache entry and hold
  // it until the server-applied snapshot reconciles.
  const attachmentsQuery = useCollectionQuery<WorkspaceNodeAttachment>(() => {
    const ctx = toValue(context)
    if (!ctx?.teamId || !ctx.workspaceId || !ctx.nodeId || !ctx.scope) {
      return null
    }
    const path = getWorkspaceNodeAttachmentsCollectionPath(
      ctx.teamId,
      ctx.workspaceId,
      ctx.scope,
      ctx.nodeId
    )
    return {
      query: query(
        collection(firestore, path).withConverter(attachmentConverter),
        orderBy("updatedAt", "desc")
      ),
      path,
    }
  })

  const attachments = computed(() => attachmentsQuery.data.value ?? [])
  const loading = computed(() => attachmentsQuery.isLoading.value)
  const error = computed(() =>
    attachmentsQuery.error.value ? "Failed to load attachments." : null
  )

  const getRequiredContext = (): AttachmentMutationContext => {
    const resolved = toValue(context)
    if (!resolved) {
      throw new Error("Select a node before editing attachments.")
    }
    return resolved
  }

  const refresh = () => {
    const ctx = toValue(context)
    if (ctx?.teamId && ctx.workspaceId && ctx.nodeId && ctx.scope) {
      void queryClient.invalidateQueries({ queryKey: attachmentsCacheKey(ctx) })
    }
  }

  const isAttachmentPending = (attachmentId: string) =>
    pendingAttachmentIds.value.has(attachmentId)

  // Apply an optimistic transform to the attachments cache, hold the key, run
  // the Cloud Function, and roll the cache back on failure. Returns the CF
  // result so callers keep their previous return value.
  const runAttachmentWrite = async <T>(
    ctx: AttachmentMutationContext,
    attachmentIds: string[],
    applyOptimistic: (
      current: WorkspaceNodeAttachment[]
    ) => WorkspaceNodeAttachment[],
    run: () => Promise<T>,
    source: string
  ): Promise<T> => {
    const key = attachmentsCacheKey(ctx)
    const previous = queryClient.getQueryData<WorkspaceNodeAttachment[]>(key)
    const release = holdOptimistic(key)
    attachmentIds.forEach((id) => addPending(pendingAttachmentIds, id))
    queryClient.setQueryData<WorkspaceNodeAttachment[]>(
      key,
      sortAttachments(
        applyOptimistic(
          queryClient.getQueryData<WorkspaceNodeAttachment[]>(key) ?? []
        )
      )
    )
    try {
      return await withCloudSyncOperation(run, { source })
    } catch (writeError) {
      queryClient.setQueryData(key, previous)
      throw writeError
    } finally {
      setTimeout(() => {
        release()
        attachmentIds.forEach((id) => removePending(pendingAttachmentIds, id))
      }, 120)
    }
  }

  onUnmounted(() => {
    pendingAttachmentIds.value = createPendingSet()
  })

  const createAttachmentFromFile = async (file: File) => {
    const attachmentContext = getRequiredContext()
    const attachmentId = generateId()
    const optimisticAttachment = createOptimisticAttachment(
      file,
      attachmentId,
      attachmentContext
    )
    const key = attachmentsCacheKey(attachmentContext)

    await runAttachmentWrite(
      attachmentContext,
      [attachmentId],
      (current) => [...current, optimisticAttachment],
      async () => {
        const created = await createWorkspaceNodeAttachmentFromFile(
          file,
          attachmentContext,
          { attachmentId }
        )
        // Patch the optimistic row with the server-resolved fields.
        queryClient.setQueryData<WorkspaceNodeAttachment[]>(
          key,
          (queryClient.getQueryData<WorkspaceNodeAttachment[]>(key) ?? []).map(
            (attachment) =>
              attachment.id === created.attachmentId
                ? {
                    ...attachment,
                    displayName: created.displayName,
                    originalName: created.originalName,
                    storagePath: created.storagePath,
                  }
                : attachment
          )
        )
        return created
      },
      "attachments.create"
    )
  }

  const updateAttachment = async (input: {
    attachment: WorkspaceNodeAttachment
    displayName: string
    replacementFile?: File | null
  }) => {
    const attachmentContext = getRequiredContext()
    const currentAttachment =
      attachments.value.find(
        (attachment) => attachment.id === input.attachment.id
      ) ?? input.attachment
    const nextDisplayName = validateAttachmentDisplayName(input.displayName)
    const nextFile = input.replacementFile ?? null
    const now = Timestamp.now()
    const key = attachmentsCacheKey(attachmentContext)

    await runAttachmentWrite(
      attachmentContext,
      [currentAttachment.id],
      (current) =>
        current.map((attachment) =>
          attachment.id === currentAttachment.id
            ? {
                ...attachment,
                displayName: nextDisplayName,
                originalName: nextFile?.name ?? attachment.originalName,
                mimeType: nextFile
                  ? (resolveMimeTypeForUpload({
                      fileName: nextFile.name,
                      mimeType: nextFile.type,
                    }) ?? null)
                  : (attachment.mimeType ?? null),
                size: nextFile?.size ?? attachment.size ?? null,
                updatedAt: now,
                updatedBy: "local",
              }
            : attachment
        ),
      async () => {
        const updated = await updateWorkspaceNodeAttachmentEntry({
          context: attachmentContext,
          attachment: currentAttachment,
          displayName: nextDisplayName,
          replacementFile: nextFile,
        })
        queryClient.setQueryData<WorkspaceNodeAttachment[]>(
          key,
          (queryClient.getQueryData<WorkspaceNodeAttachment[]>(key) ?? []).map(
            (attachment) =>
              attachment.id === currentAttachment.id
                ? {
                    ...attachment,
                    displayName: updated.displayName,
                    originalName: updated.originalName,
                    storagePath: updated.storagePath,
                    mimeType: updated.mimeType,
                    size: updated.size,
                    updatedAt: now,
                    updatedBy: "local",
                  }
                : attachment
          )
        )
        return updated
      },
      "attachments.update"
    )
  }

  const deleteAttachment = async (attachment: WorkspaceNodeAttachment) => {
    const attachmentContext = getRequiredContext()

    await runAttachmentWrite(
      attachmentContext,
      [attachment.id],
      (current) => current.filter((entry) => entry.id !== attachment.id),
      async () => {
        await deleteWorkspaceNodeAttachmentEntry(
          attachmentContext,
          attachment.id
        )
      },
      "attachments.delete"
    )
  }

  return {
    attachments,
    loading,
    error,
    pendingAttachmentIds,
    refresh,
    isAttachmentPending,
    createAttachmentFromFile,
    updateAttachment,
    deleteAttachment,
  }
}

import {
  createWorkspaceNodeAttachment as createWorkspaceNodeAttachmentCallable,
  deleteWorkspaceNodeAttachment as deleteWorkspaceNodeAttachmentCallable,
  updateWorkspaceNodeAttachment as updateWorkspaceNodeAttachmentCallable,
} from "@/composables/useFunctions"
import {
  buildWorkspaceNodeAttachmentStoragePath,
  getWorkspaceNodeAttachmentsCollectionPath,
  NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  normalizeAttachmentDisplayName,
  sanitizeAttachmentFileName,
} from "@/helpers/node-attachments"
import { generateId } from "@/helpers/utilities"
import { resolveMimeTypeForUpload } from "@/modules/fileCapture"
import { firestore } from "@/modules/firebase"
import { parseSafe } from "@/schemas/_utils"
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
  cloneState,
  createPendingSet,
  mergeOptimisticCollection,
  withOptimisticBatchUpdate,
} from "@/utils/firebase/firebase-optimistic"
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { uploadBytes } from "firebase/storage"
import {
  computed,
  onUnmounted,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue"

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

/**
 * Parse a Firestore snapshot into a `WorkspaceNodeAttachment`. Returns
 * `null` when validation fails — one corrupt attachment should never
 * collapse the whole attachment list. Callers filter nulls via `isAttachment`.
 *
 * Attachment paths are constructed dynamically via the collab helpers and
 * don't flow through a `firebase-helpers.ts` ref getter, so no converter
 * is attached at the ref level — validation happens here instead.
 */
const toAttachment = (
  docSnap: QueryDocumentSnapshot<DocumentData>
): WorkspaceNodeAttachment | null =>
  parseSafe(
    workspaceNodeAttachmentSchema,
    { id: docSnap.id, ...docSnap.data() },
    `attachment:${docSnap.ref.path}`
  )

const isAttachment = (
  attachment: WorkspaceNodeAttachment | null
): attachment is WorkspaceNodeAttachment => attachment !== null

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
  const firestoreAttachments = ref<WorkspaceNodeAttachment[]>([])
  const optimisticAttachments = ref<WorkspaceNodeAttachment[]>([])
  const pendingAttachmentIds = shallowRef(createPendingSet())
  const loading = ref(false)
  const error = ref<string | null>(null)
  const reloadToken = ref(0)

  const attachments = computed(() =>
    mergeOptimisticCollection(
      firestoreAttachments.value,
      optimisticAttachments.value,
      pendingAttachmentIds.value,
      {
        sort: (left, right) =>
          toTimestampMs(right.updatedAt ?? right.createdAt) -
          toTimestampMs(left.updatedAt ?? left.createdAt),
      }
    )
  )

  const setOptimisticAttachments = (next: WorkspaceNodeAttachment[]) => {
    optimisticAttachments.value = sortAttachments(next)
  }

  const getRequiredContext = (): AttachmentMutationContext => {
    const resolved = toValue(context)
    if (!resolved) {
      throw new Error("Select a node before editing attachments.")
    }
    return resolved
  }

  const refresh = () => {
    reloadToken.value += 1
  }

  const isAttachmentPending = (attachmentId: string) =>
    pendingAttachmentIds.value.has(attachmentId)

  watch(
    [
      () => toValue(context)?.teamId ?? null,
      () => toValue(context)?.workspaceId ?? null,
      () => toValue(context)?.nodeId ?? null,
      () => toValue(context)?.scope ?? null,
      reloadToken,
    ],
    ([teamId, workspaceId, nodeId, scope], _oldValue, onCleanup) => {
      firestoreAttachments.value = []
      optimisticAttachments.value = []
      pendingAttachmentIds.value = createPendingSet()
      error.value = null

      if (!teamId || !workspaceId || !nodeId || !scope) {
        loading.value = false
        return
      }

      loading.value = true

      const unsubscribe = onSnapshot(
        query(
          collection(
            firestore,
            getWorkspaceNodeAttachmentsCollectionPath(
              teamId,
              workspaceId,
              scope,
              nodeId
            )
          ),
          orderBy("updatedAt", "desc")
        ),
        (snapshot) => {
          firestoreAttachments.value = snapshot.docs
            .map(toAttachment)
            .filter(isAttachment)
          error.value = null
          loading.value = false
        },
        (snapshotError) => {
          console.error(
            "[useNodeAttachments] Failed to subscribe:",
            snapshotError
          )
          firestoreAttachments.value = []
          error.value = "Failed to load attachments."
          loading.value = false
        }
      )

      onCleanup(() => {
        unsubscribe()
      })
    },
    { immediate: true }
  )

  watch(firestoreAttachments, (data) => {
    if (pendingAttachmentIds.value.size === 0) {
      optimisticAttachments.value = cloneState(data)
    }
  })

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
    const previousOptimistic = cloneState(optimisticAttachments.value)

    await withOptimisticBatchUpdate(
      pendingAttachmentIds,
      [attachmentId],
      () => {
        setOptimisticAttachments([
          ...cloneState(attachments.value),
          optimisticAttachment,
        ])
        error.value = null
      },
      () => {
        optimisticAttachments.value = previousOptimistic
      },
      async () => {
        const created = await createWorkspaceNodeAttachmentFromFile(
          file,
          attachmentContext,
          {
            attachmentId,
          }
        )

        setOptimisticAttachments(
          cloneState(attachments.value).map((attachment) =>
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
      {
        source: "attachments.create",
      }
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
    const previousOptimistic = cloneState(optimisticAttachments.value)
    const now = Timestamp.now()

    await withOptimisticBatchUpdate(
      pendingAttachmentIds,
      [currentAttachment.id],
      () => {
        setOptimisticAttachments(
          cloneState(attachments.value).map((attachment) =>
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
          )
        )
      },
      () => {
        optimisticAttachments.value = previousOptimistic
      },
      async () => {
        const updated = await updateWorkspaceNodeAttachmentEntry({
          context: attachmentContext,
          attachment: currentAttachment,
          displayName: nextDisplayName,
          replacementFile: nextFile,
        })

        setOptimisticAttachments(
          cloneState(attachments.value).map((attachment) =>
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
      {
        source: "attachments.update",
      }
    )
  }

  const deleteAttachment = async (attachment: WorkspaceNodeAttachment) => {
    const attachmentContext = getRequiredContext()
    const previousOptimistic = cloneState(optimisticAttachments.value)
    const previousFirestore = cloneState(firestoreAttachments.value)

    await withOptimisticBatchUpdate(
      pendingAttachmentIds,
      [attachment.id],
      () => {
        firestoreAttachments.value = firestoreAttachments.value.filter(
          (current) => current.id !== attachment.id
        )
        setOptimisticAttachments(
          cloneState(attachments.value).filter(
            (current) => current.id !== attachment.id
          )
        )
      },
      () => {
        optimisticAttachments.value = previousOptimistic
        firestoreAttachments.value = previousFirestore
      },
      async () => {
        await deleteWorkspaceNodeAttachmentEntry(
          attachmentContext,
          attachment.id
        )
      },
      {
        source: "attachments.delete",
      }
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

/**
 * useSessionAttachmentsState — CRUD + live list for bot chat-session
 * attachments. Mirrors `useNodeAttachmentsState` but scoped to a chat session
 * (`sessionId`) instead of a workspace node. The live list comes from a
 * TanStack `useCollectionQuery` (onSnapshot); rename + delete patch that cache
 * optimistically (hold-the-key + rollback, exactly like the node-attachment
 * sibling) so the change shows instantly. CREATE stays deliberately
 * component-driven: `SessionAttachments.vue` surfaces the in-flight upload via
 * its own `uploadStates` list (with inline per-file error rows), so there's no
 * second optimistic row to add here.
 *
 * Bytes upload client→Storage directly (`uploadBytes`); the metadata doc is
 * written by a Cloud Function (`createBotSessionAttachment`) which re-reads the
 * object's authoritative content-type + size. On a failed commit the orphaned
 * blob is best-effort deleted so storage doesn't leak.
 */

import {
  createBotSessionAttachment,
  deleteBotSessionAttachment,
  updateBotSessionAttachment,
} from "@/composables/useFunctions"
import {
  buildBotSessionAttachmentStoragePath,
  getBotSessionAttachmentsCollectionPath,
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
import { botSessionAttachmentSchema } from "@/schemas/nodes"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  type IBotSessionAttachment,
} from "@/types/nodes"
import {
  deleteStorageFile,
  getStorageFileRef,
} from "@/utils/firebase/firebase-helpers"
import {
  holdOptimistic,
  useCollectionQuery,
} from "@/utils/firebase/firebase-query"
import { queryKeys } from "@/utils/firebase/firebase-query-keys"
import { collection, orderBy, query, Timestamp } from "firebase/firestore"
import { uploadBytes } from "firebase/storage"
import { computed, toValue, type MaybeRefOrGetter } from "vue"

export interface BotSessionAttachmentContext {
  teamId: string
  workspaceId: string
  sessionId: string
}

const converter = zodConverter<IBotSessionAttachment>(
  botSessionAttachmentSchema,
  "botSessionAttachment"
)

export const validateAttachmentDisplayName = (value: string): string => {
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

const uploadBlob = async (
  file: File,
  attachmentId: string,
  ctx: BotSessionAttachmentContext
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
  const storagePath = buildBotSessionAttachmentStoragePath({
    teamId: ctx.teamId,
    workspaceId: ctx.workspaceId,
    sessionId: ctx.sessionId,
    attachmentId,
    version: generateId(),
    fileName: sanitizeAttachmentFileName(file.name),
  })
  await uploadBytes(
    getStorageFileRef(storagePath),
    file,
    contentType ? { contentType } : undefined
  )
  return storagePath
}

export function useSessionAttachmentsState(
  context: MaybeRefOrGetter<BotSessionAttachmentContext | null>
) {
  const attachmentsQuery = useCollectionQuery<IBotSessionAttachment>(() => {
    const ctx = toValue(context)
    if (!ctx?.teamId || !ctx.workspaceId || !ctx.sessionId) {
      return null
    }
    const path = getBotSessionAttachmentsCollectionPath(
      ctx.teamId,
      ctx.workspaceId,
      ctx.sessionId
    )
    return {
      query: query(
        collection(firestore, path).withConverter(converter),
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

  const getRequiredContext = (): BotSessionAttachmentContext => {
    const ctx = toValue(context)
    if (!ctx) {
      throw new Error("Send a message to start this chat before uploading.")
    }
    return ctx
  }

  const refresh = () => {
    const ctx = toValue(context)
    if (ctx?.teamId && ctx.workspaceId && ctx.sessionId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list(
          getBotSessionAttachmentsCollectionPath(
            ctx.teamId,
            ctx.workspaceId,
            ctx.sessionId
          )
        ),
      })
    }
  }

  /**
   * Apply an optimistic transform to the attachments cache, hold the key so the
   * live `onSnapshot` can't momentarily revert it before the server write
   * propagates, run the Cloud Function, then roll the cache back on failure.
   * Mirrors `useNodeAttachments`' `runAttachmentWrite`, leaner: in-flight
   * uploads are surfaced by the component's own `uploadStates`, so there's no
   * pending-id tracking here.
   */
  const runAttachmentWrite = async <T>(
    ctx: BotSessionAttachmentContext,
    applyOptimistic: (
      current: IBotSessionAttachment[]
    ) => IBotSessionAttachment[],
    run: () => Promise<T>
  ): Promise<T> => {
    const key = queryKeys.list(
      getBotSessionAttachmentsCollectionPath(
        ctx.teamId,
        ctx.workspaceId,
        ctx.sessionId
      )
    )
    const previous = queryClient.getQueryData<IBotSessionAttachment[]>(key)
    const release = holdOptimistic(key)
    queryClient.setQueryData<IBotSessionAttachment[]>(
      key,
      applyOptimistic(previous ?? [])
    )
    try {
      return await run()
    } catch (writeError) {
      queryClient.setQueryData(key, previous)
      throw writeError
    } finally {
      setTimeout(() => release(), 120)
    }
  }

  /** Upload + commit one file. Returns the new attachment id (for auto-select). */
  const createAttachmentFromFile = async (file: File): Promise<string> => {
    const ctx = getRequiredContext()
    if (file.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
      throw new Error("Each attachment must be 25 MB or smaller.")
    }
    const attachmentId = generateId()
    const displayName = validateAttachmentDisplayName(file.name)
    const storagePath = await uploadBlob(file, attachmentId, ctx)
    try {
      await createBotSessionAttachment({
        teamId: ctx.teamId,
        workspaceId: ctx.workspaceId,
        sessionId: ctx.sessionId,
        attachmentId,
        displayName,
        originalName: file.name,
        storagePath,
      })
    } catch (commitError) {
      // The metadata doc didn't commit — drop the orphaned blob (best-effort).
      await deleteStorageFile(storagePath)
      throw commitError
    }
    return attachmentId
  }

  const updateAttachment = async (input: {
    attachment: IBotSessionAttachment
    displayName: string
    replacementFile?: File | null
  }): Promise<void> => {
    const ctx = getRequiredContext()
    const displayName = validateAttachmentDisplayName(input.displayName)
    const replacement = input.replacementFile ?? null
    if (replacement && replacement.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
      throw new Error("Replacement files must be 25 MB or smaller.")
    }

    let storagePath: string | undefined
    let originalName: string | undefined
    if (replacement) {
      storagePath = await uploadBlob(replacement, input.attachment.id, ctx)
      originalName = replacement.name
    }

    const now = Timestamp.now()
    const nextMimeType = replacement
      ? (resolveMimeTypeForUpload({
          fileName: replacement.name,
          mimeType: replacement.type,
        }) ?? null)
      : undefined

    try {
      await runAttachmentWrite(
        ctx,
        (current) =>
          current
            .map((entry) =>
              entry.id === input.attachment.id
                ? {
                    ...entry,
                    displayName,
                    ...(replacement
                      ? {
                          originalName: originalName ?? entry.originalName,
                          storagePath: storagePath ?? entry.storagePath,
                          mimeType: nextMimeType ?? entry.mimeType,
                          size: replacement.size,
                        }
                      : {}),
                    updatedAt: now,
                    updatedBy: "local",
                  }
                : entry
            )
            // `updatedAt` bumped → mirror the query's `orderBy("updatedAt",
            // "desc")` so the row settles in place instead of jumping when the
            // server snapshot lands.
            .sort((a, b) => b.updatedAt.toMillis() - a.updatedAt.toMillis()),
        () =>
          updateBotSessionAttachment({
            teamId: ctx.teamId,
            workspaceId: ctx.workspaceId,
            sessionId: ctx.sessionId,
            attachmentId: input.attachment.id,
            displayName,
            ...(storagePath ? { storagePath, originalName } : {}),
          })
      )
    } catch (commitError) {
      if (storagePath) await deleteStorageFile(storagePath)
      throw commitError
    }
  }

  const deleteAttachment = async (
    attachment: IBotSessionAttachment
  ): Promise<void> => {
    const ctx = getRequiredContext()
    // Optimistically drop the row (the helper holds the cache key so the live
    // `onSnapshot` can't momentarily re-add it before the server delete
    // propagates, and rolls back if the callable rejects).
    await runAttachmentWrite(
      ctx,
      (current) => current.filter((entry) => entry.id !== attachment.id),
      () =>
        deleteBotSessionAttachment({
          teamId: ctx.teamId,
          workspaceId: ctx.workspaceId,
          sessionId: ctx.sessionId,
          attachmentId: attachment.id,
        })
    )
  }

  return {
    attachments,
    loading,
    error,
    refresh,
    createAttachmentFromFile,
    updateAttachment,
    deleteAttachment,
  }
}

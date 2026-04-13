<script lang="ts" setup>
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import {
  useNodeAttachmentsState,
  validateAttachmentDisplayName,
  type AttachmentMutationContext,
} from "@/composables/useNodeAttachments"
import { isTauri } from "@/composables/usePlatform"
import {
  IconAlertTriangle,
  IconArrowDownToLine,
  IconCircleAlert,
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
  IconPencil,
  IconRefreshCcw,
  IconTrash2,
  IconUpload,
  IconX,
} from "@/data/icons"
import {
  formatAttachmentSize,
  normalizeAttachmentDisplayName,
  sanitizeAttachmentFileName,
} from "@/helpers/node-attachments"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { generateId } from "@/helpers/utilities"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  type WorkspaceNode,
  type WorkspaceNodeAttachment,
  type WorkspaceNodeScope,
} from "@/types/nodes"
import { can, Capabilities } from "@/types/permissions"
import { getStorageFileRef } from "@/utils/firebase/firebase-helpers"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { getDownloadURL } from "firebase/storage"
import { storeToRefs } from "pinia"
import type { Component } from "vue"
import { toRefs } from "vue"

interface UploadState {
  id: string
  name: string
  status: "uploading" | "error"
  error?: string
}

const props = defineProps<{
  teamId: string | null
  workspaceId: string | null
  scope: WorkspaceNodeScope
  node: WorkspaceNode | null
}>()

const { teamId, workspaceId, node } = toRefs(props)
const nodeId = computed(() => node.value?.id ?? null)

const authStore = useAuthStore()
const membershipStore = useMembershipStore()

const { currentUser } = storeToRefs(authStore)
const { memberships } = storeToRefs(membershipStore)

const attachmentContext = computed<AttachmentMutationContext | null>(() => {
  if (!teamId.value || !workspaceId.value || !node.value) {
    return null
  }

  return {
    teamId: teamId.value,
    workspaceId: workspaceId.value,
    nodeId: node.value.id,
    scope: props.scope,
  }
})
const {
  attachments,
  loading,
  error,
  refresh: refreshAttachments,
  isAttachmentPending,
  createAttachmentFromFile,
  updateAttachment,
  deleteAttachment,
} = useNodeAttachmentsState(attachmentContext)
const uploadStates = ref<UploadState[]>([])
const editDialogOpen = ref(false)
const editingAttachment = ref<WorkspaceNodeAttachment | null>(null)
const editDisplayName = ref("")
const replacementFile = ref<File | null>(null)
const replacementInputKey = ref(0)
const isSavingEdit = ref(false)
const downloadingIds = ref<string[]>([])
const deletingId = ref<string | null>(null)
const {
  files: selectedCreateFiles,
  open: openCreateFileDialog,
  reset: resetCreateFileDialog,
} = useFileDialog({
  multiple: true,
})
const {
  isOpen: isDeleteDialogOpen,
  item: attachmentToDelete,
  open: openDeleteDialog,
  close: closeDeleteDialog,
  confirm: confirmDelete,
} = useConfirmationDialog<WorkspaceNodeAttachment>()

const currentRole = computed(() => {
  if (!teamId.value || !currentUser.value) return null

  return (
    memberships.value.find(
      (membership) =>
        membership.teamId === teamId.value &&
        membership.userId === currentUser.value?.uid
    )?.role ?? null
  )
})

const canManageAttachments = computed(() =>
  can(currentUser.value, Capabilities.MANAGE_WORKSPACE_CONTENT, {
    scope: "workspace",
    teamRole: currentRole.value,
  })
)

const isReadOnly = computed(
  () => !node.value || node.value.isArchived || !canManageAttachments.value
)

const readOnlyMessage = computed(() => {
  if (!node.value) return null
  if (node.value.isArchived) {
    return "Archived nodes are read-only. You can still open existing attachments."
  }
  if (!canManageAttachments.value) {
    return "You can view and download attachments, but only members, admins, and owners can edit them."
  }
  return null
})

const uploadInProgress = computed(() =>
  uploadStates.value.some((item) => item.status === "uploading")
)

const hasEditChanges = computed(() => {
  if (!editingAttachment.value) return false
  const normalizedName = normalizeAttachmentDisplayName(editDisplayName.value)
  return (
    Boolean(replacementFile.value) ||
    normalizedName !== editingAttachment.value.displayName
  )
})

const formatTimestamp = (
  value:
    | {
        toDate?: () => Date
      }
    | null
    | undefined
) => {
  const timestamp = value?.toDate?.()
  return timestamp
    ? useDateFormat(timestamp, "MMM D, YYYY · h:mm A").value
    : "—"
}

const formatMimeType = (value: string | null | undefined) => {
  if (!value) return "Unknown type"
  return value
}

const triggerAttachmentDownload = (url: string, fileName: string) => {
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.rel = "noopener noreferrer"
  anchor.target = "_blank"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

const hasFileExtension = (value: string) => /\.[^./\\]+$/.test(value)

const getAttachmentDownloadName = (attachment: WorkspaceNodeAttachment) => {
  const displayName =
    sanitizeAttachmentFileName(
      normalizeAttachmentDisplayName(attachment.displayName)
    ) || "file"
  const extensionMatch = /\.[^./\\]+$/.exec(attachment.originalName)

  if (!extensionMatch || hasFileExtension(displayName)) {
    return displayName
  }

  return sanitizeAttachmentFileName(`${displayName}${extensionMatch[0]}`)
}

const getAttachmentDownloadUrl = async (storagePath: string) => {
  return getDownloadURL(getStorageFileRef(storagePath))
}

const resolveAttachmentIcon = (
  attachment: WorkspaceNodeAttachment
): Component => {
  const mimeType = attachment.mimeType?.toLowerCase() ?? ""
  const fileName = attachment.originalName.toLowerCase()

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

const dismissUploadState = (id: string) => {
  uploadStates.value = uploadStates.value.filter((item) => item.id !== id)
}

const upsertUploadState = (next: UploadState) => {
  const index = uploadStates.value.findIndex((item) => item.id === next.id)
  if (index >= 0) {
    uploadStates.value = uploadStates.value.map((item) =>
      item.id === next.id ? next : item
    )
    return
  }

  uploadStates.value = [...uploadStates.value, next]
}

const getMutableContext = (): AttachmentMutationContext => {
  if (!teamId.value || !workspaceId.value || !node.value) {
    throw new Error("Select a node before editing attachments.")
  }
  if (node.value.isArchived) {
    throw new Error("Archived nodes are read-only.")
  }
  if (!canManageAttachments.value) {
    throw new Error("You do not have permission to edit attachments.")
  }

  return {
    teamId: teamId.value,
    workspaceId: workspaceId.value,
    nodeId: node.value.id,
    scope: props.scope,
  }
}

const triggerFilePicker = () => {
  if (isReadOnly.value) return
  openCreateFileDialog()
}

const processSelectedFiles = async (files: File[]) => {
  if (!files.length) return

  let successCount = 0
  let failureCount = 0

  try {
    getMutableContext()
  } catch (contextError) {
    showErrorToast(
      "Failed to upload attachment",
      (contextError as Error).message
    )
    return
  }

  for (const file of files) {
    const uploadId = generateId()
    upsertUploadState({
      id: uploadId,
      name: file.name,
      status: "uploading",
    })

    try {
      await createAttachmentFromFile(file)
      dismissUploadState(uploadId)
      successCount += 1
    } catch (uploadError) {
      failureCount += 1
      upsertUploadState({
        id: uploadId,
        name: file.name,
        status: "error",
        error: (uploadError as Error).message,
      })
    }
  }

  if (successCount > 0) {
    showSuccessToast(
      successCount === 1
        ? "Attachment uploaded"
        : `${successCount} attachments uploaded`
    )
  }

  if (failureCount > 0) {
    showErrorToast(
      failureCount === 1 ? "Attachment upload failed" : "Some uploads failed",
      failureCount === 1
        ? "Check the failed upload below and try again."
        : `${failureCount} files could not be uploaded.`
    )
  }
}

const downloadAttachmentInBrowser = async (
  attachment: WorkspaceNodeAttachment
) => {
  const fileName = getAttachmentDownloadName(attachment)
  const downloadUrl = await getAttachmentDownloadUrl(attachment.storagePath)
  triggerAttachmentDownload(downloadUrl, fileName)
}

const downloadAttachmentInTauri = async (
  attachment: WorkspaceNodeAttachment
) => {
  const fileName = getAttachmentDownloadName(attachment)
  const targetPath = await save({
    defaultPath: fileName,
  })

  if (!targetPath) return

  const downloadUrl = await getAttachmentDownloadUrl(attachment.storagePath)

  await invoke("download_url_to_path", {
    url: downloadUrl,
    targetPath,
  })
  await revealItemInDir(targetPath)
  showSuccessToast("Attachment downloaded")
}

const downloadAttachment = async (attachment: WorkspaceNodeAttachment) => {
  if (
    downloadingIds.value.includes(attachment.id) ||
    isAttachmentPending(attachment.id) ||
    !attachment.storagePath
  ) {
    return
  }

  downloadingIds.value = [...downloadingIds.value, attachment.id]

  try {
    if (isTauri.value) {
      await downloadAttachmentInTauri(attachment)
    } else {
      await downloadAttachmentInBrowser(attachment)
    }
  } catch (downloadError) {
    showErrorToast(
      "Failed to download attachment",
      (downloadError as Error).message
    )
  } finally {
    downloadingIds.value = downloadingIds.value.filter(
      (id) => id !== attachment.id
    )
  }
}

const closeEditDialog = () => {
  editDialogOpen.value = false
  editingAttachment.value = null
  editDisplayName.value = ""
  replacementFile.value = null
  replacementInputKey.value += 1
}

const openEditDialog = (attachment: WorkspaceNodeAttachment) => {
  if (isReadOnly.value || isAttachmentPending(attachment.id)) return

  editingAttachment.value = attachment
  editDisplayName.value = attachment.displayName
  replacementFile.value = null
  replacementInputKey.value += 1
  editDialogOpen.value = true
}

const handleReplacementSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  replacementFile.value = input.files?.[0] ?? null
}

const clearReplacementFile = () => {
  replacementFile.value = null
  replacementInputKey.value += 1
}

const handleEditSubmit = async () => {
  if (!editingAttachment.value) return

  try {
    getMutableContext()
    const displayName = validateAttachmentDisplayName(editDisplayName.value)

    if (!hasEditChanges.value) {
      closeEditDialog()
      return
    }

    isSavingEdit.value = true
    await updateAttachment({
      attachment: editingAttachment.value,
      displayName,
      replacementFile: replacementFile.value,
    })

    showSuccessToast(
      replacementFile.value ? "Attachment updated" : "Attachment renamed"
    )
    closeEditDialog()
  } catch (saveError) {
    showErrorToast("Failed to update attachment", (saveError as Error).message)
  } finally {
    isSavingEdit.value = false
  }
}

const handleDeleteConfirm = async (attachment: WorkspaceNodeAttachment) => {
  try {
    getMutableContext()
    deletingId.value = attachment.id
    await deleteAttachment(attachment)
    showSuccessToast("Attachment deleted")
  } catch (deleteError) {
    showErrorToast(
      "Failed to delete attachment",
      (deleteError as Error).message
    )
  } finally {
    deletingId.value = null
  }
}

watch([teamId, workspaceId, nodeId, () => props.scope], () => {
  uploadStates.value = []
  downloadingIds.value = []
  deletingId.value = null
  resetCreateFileDialog()
  closeEditDialog()
  closeDeleteDialog()
})

watch(selectedCreateFiles, async (files) => {
  if (!files || files.length === 0) return

  try {
    await processSelectedFiles(Array.from(files))
  } finally {
    resetCreateFileDialog()
  }
})
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <SidebarContent>
      <OverlayScrollbarsWrapper>
        <SidebarGroup>
          <SidebarGroupContent>
            <div v-if="!node" class="text-muted-foreground p-2 text-xs">
              Select a file or folder to manage attachments.
            </div>

            <div v-else class="space-y-3 p-2">
              <div class="flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <p class="text-sm font-medium">Attachments</p>
                  <p>
                    {{ attachments.length }}
                    {{
                      attachments.length === 1 ? "attachment" : "attachments"
                    }}
                  </p>
                </div>

                <Button
                  :disabled="isReadOnly"
                  class="shrink-0"
                  @click="triggerFilePicker"
                >
                  <IconUpload />
                  Upload
                </Button>
              </div>

              <div v-if="readOnlyMessage">
                {{ readOnlyMessage }}
              </div>

              <div v-if="uploadStates.length" class="space-y-2 border p-2">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs font-medium">Uploads</p>
                  <Button
                    v-if="!uploadInProgress"
                    type="button"
                    variant="ghost"
                    @click="uploadStates = []"
                  >
                    Clear
                  </Button>
                </div>

                <div
                  v-for="item in uploadStates"
                  :key="item.id"
                  class="flex items-start gap-2 border p-2"
                >
                  <Spinner
                    v-if="item.status === 'uploading'"
                    class="mt-0.5 size-3.5 shrink-0"
                  />
                  <IconCircleAlert
                    v-else
                    class="text-destructive mt-0.5 size-3.5 shrink-0"
                  />

                  <div class="min-w-0 grow">
                    <p class="truncate text-xs font-medium">{{ item.name }}</p>
                    <p>
                      {{
                        item.status === "uploading"
                          ? "Uploading..."
                          : item.error
                      }}
                    </p>
                  </div>

                  <Button
                    v-if="item.status === 'error'"
                    type="button"
                    variant="ghost"
                    size="icon"
                    @click="dismissUploadState(item.id)"
                  >
                    <IconX />
                  </Button>
                </div>
              </div>

              <div
                v-if="loading && attachments.length === 0"
                class="text-muted-foreground flex items-center gap-2 text-xs"
              >
                <Spinner />
                Loading attachments...
              </div>

              <div v-else-if="error" class="space-y-2 border p-3">
                <div class="text-destructive flex items-start gap-2 text-xs">
                  <IconAlertTriangle class="mt-0.5 size-3.5 shrink-0" />
                  <span>{{ error }}</span>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  class="w-full"
                  @click="refreshAttachments"
                >
                  <IconRefreshCcw />
                  Retry
                </Button>
              </div>

              <div
                v-else-if="attachments.length === 0"
                class="text-muted-foreground border border-dashed p-4 text-xs"
              >
                {{
                  isReadOnly
                    ? "No attachments are available for this node."
                    : "No attachments yet. Upload files to keep node-specific assets here."
                }}
              </div>

              <div v-else class="space-y-2">
                <article
                  v-for="attachment in attachments"
                  :key="attachment.id"
                  class="border p-3"
                >
                  <div class="flex items-start gap-3">
                    <div
                      class="bg-muted flex size-9 shrink-0 items-center justify-center border"
                    >
                      <Component
                        :is="resolveAttachmentIcon(attachment)"
                        class="text-muted-foreground size-4"
                      />
                    </div>

                    <div class="min-w-0 grow space-y-3">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="truncate text-sm font-medium">
                            {{ attachment.displayName }}
                          </p>
                          <p class="text-muted-foreground truncate text-xs">
                            {{ attachment.originalName }}
                          </p>
                        </div>

                        <div class="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            :disabled="
                              downloadingIds.includes(attachment.id) ||
                              isAttachmentPending(attachment.id) ||
                              !attachment.storagePath
                            "
                            @click="downloadAttachment(attachment)"
                          >
                            <Spinner
                              v-if="downloadingIds.includes(attachment.id)"
                            />
                            <IconArrowDownToLine v-else />
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            :disabled="
                              isReadOnly || isAttachmentPending(attachment.id)
                            "
                            @click="openEditDialog(attachment)"
                          >
                            <IconPencil />
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            :disabled="
                              isReadOnly ||
                              deletingId === attachment.id ||
                              isAttachmentPending(attachment.id)
                            "
                            @click="openDeleteDialog(attachment)"
                          >
                            <Spinner v-if="deletingId === attachment.id" />
                            <IconTrash2 v-else />
                          </Button>
                        </div>
                      </div>

                      <div class="flex flex-wrap gap-1.5">
                        <Badge
                          v-if="isAttachmentPending(attachment.id)"
                          variant="secondary"
                        >
                          <Spinner />
                          Syncing
                        </Badge>
                        <Badge variant="outline">
                          <IconArrowDownToLine />
                          {{ formatAttachmentSize(attachment.size) }}
                        </Badge>
                        <Badge variant="outline">
                          {{ formatMimeType(attachment.mimeType) }}
                        </Badge>
                      </div>

                      <dl
                        class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs"
                      >
                        <dt class="text-muted-foreground">Created</dt>
                        <dd>{{ formatTimestamp(attachment.createdAt) }}</dd>

                        <dt class="text-muted-foreground">Updated</dt>
                        <dd>{{ formatTimestamp(attachment.updatedAt) }}</dd>
                      </dl>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </OverlayScrollbarsWrapper>
    </SidebarContent>
  </Sidebar>

  <Dialog
    :open="editDialogOpen"
    @update:open="($event) => !$event && closeEditDialog()"
  >
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Edit attachment</DialogTitle>
        <DialogDescription>
          Rename the attachment or replace the stored file while keeping it
          linked to the same node.
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-4" @submit.prevent="handleEditSubmit">
        <div class="space-y-2">
          <Label for="attachment-display-name">File name</Label>
          <Input
            id="attachment-display-name"
            v-model="editDisplayName"
            :maxlength="ATTACHMENT_NAME_MAX_LENGTH"
            placeholder="Enter a display name"
          />
        </div>

        <div class="space-y-2">
          <Label :for="`attachment-replace-${replacementInputKey}`">
            Replace file
          </Label>
          <input
            :id="`attachment-replace-${replacementInputKey}`"
            :key="replacementInputKey"
            type="file"
            class="file:text-foreground border-input h-9 w-full min-w-0 border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium"
            @change="handleReplacementSelected"
          />

          <div
            v-if="replacementFile"
            class="flex items-center justify-between gap-2 border p-2 text-xs"
          >
            <div class="min-w-0">
              <p class="truncate font-medium">{{ replacementFile.name }}</p>
              <p class="text-muted-foreground">
                {{ formatAttachmentSize(replacementFile.size) }}
              </p>
            </div>

            <Button type="button" variant="ghost" @click="clearReplacementFile">
              Clear
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" @click="closeEditDialog">
            Cancel
          </Button>
          <Button type="submit" :disabled="!hasEditChanges || isSavingEdit">
            <Spinner v-if="isSavingEdit" />
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <AlertDialog
    :open="isDeleteDialogOpen"
    @update:open="(value) => !value && closeDeleteDialog()"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete attachment</AlertDialogTitle>
        <AlertDialogDescription>
          Remove
          <span class="font-medium">
            {{ attachmentToDelete?.displayName }}
          </span>
          from this node. The stored file will be deleted as well.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter>
        <AlertDialogCancel @click="closeDeleteDialog()">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction as-child>
          <Button
            variant="destructive"
            class="text-current"
            :disabled="
              deletingId === attachmentToDelete?.id ||
              (attachmentToDelete
                ? isAttachmentPending(attachmentToDelete.id)
                : false)
            "
            @click="
              confirmDelete(async (attachment) => {
                await handleDeleteConfirm(attachment)
              })
            "
          >
            <Spinner v-if="deletingId === attachmentToDelete?.id" />
            Delete
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

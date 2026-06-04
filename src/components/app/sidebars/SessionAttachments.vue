<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import {
  useSessionAttachmentsState,
  type BotSessionAttachmentContext,
} from "@/composables/useSessionAttachments"
import {
  IconAlertTriangle,
  IconArrowDownToLine,
  IconCheck,
  IconCircleAlert,
  IconFileImage,
  IconFilePdf,
  IconFileText,
  IconPencil,
  IconRefreshCcw,
  IconTrash2,
  IconUpload,
  IconX,
} from "@/data/icons"
import { formatAttachmentSize } from "@/helpers/node-attachments"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useAuthStore } from "@/stores/authStore"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  type IBotSessionAttachment,
} from "@/types/nodes"
import { getStorageFileRef } from "@/utils/firebase/firebase-helpers"
import { getDownloadURL } from "firebase/storage"
import { storeToRefs } from "pinia"
import type { Component } from "vue"
import { computed, inject, ref, watch } from "vue"

interface UploadState {
  id: string
  name: string
  status: "uploading" | "error"
  error?: string
}

const botChat = inject(BotChatContextKey)
const { currentTeamId, currentWorkspaceId } = storeToRefs(useAuthStore())

const sessionId = computed(() => botChat?.sessionId.value ?? null)
const canEdit = computed(
  () =>
    !!sessionId.value &&
    (botChat?.canEditActive.value ?? false) &&
    !(botChat?.isActiveArchived.value ?? false)
)

const selectedIds = computed(() => botChat?.selectedAttachmentIds.value ?? [])
const isSelected = (id: string) => selectedIds.value.includes(id)
const toggleSelected = (id: string) => botChat?.toggleAttachmentSelection(id)

// Null until a session exists (a brand-new chat has no id until the first
// message is sent), which disables the composable's queries + mutations.
const attachmentContext = computed<BotSessionAttachmentContext | null>(() => {
  if (!currentTeamId.value || !currentWorkspaceId.value || !sessionId.value) {
    return null
  }
  return {
    teamId: currentTeamId.value,
    workspaceId: currentWorkspaceId.value,
    sessionId: sessionId.value,
  }
})

const {
  attachments,
  loading,
  error,
  refresh,
  createAttachmentFromFile,
  updateAttachment,
  deleteAttachment,
} = useSessionAttachmentsState(attachmentContext)

const uploadStates = ref<UploadState[]>([])
const uploadInProgress = computed(() =>
  uploadStates.value.some((item) => item.status === "uploading")
)
const downloadingIds = ref<string[]>([])
const deletingId = ref<string | null>(null)

const { files: selectedFiles, open: openFileDialog } = useFileDialog({
  multiple: true,
})

const editDialogOpen = ref(false)
const editingAttachment = ref<IBotSessionAttachment | null>(null)
const editName = ref("")
const isSavingEdit = ref(false)

// Plain refs (not `useConfirmationDialog`): the AlertDialog's auto-close
// fires `@update:open(false)` on the same click as the confirm, and the
// composable nulls its `item` on close — racing the confirm handler and
// making Delete a silent no-op. `pendingDelete` is cleared only by us, after
// the handler has captured it, so the close can't pull it out from under us.
const deleteDialogOpen = ref(false)
const pendingDelete = ref<IBotSessionAttachment | null>(null)

const openDeleteDialog = (attachment: IBotSessionAttachment) => {
  if (!canEdit.value) return
  pendingDelete.value = attachment
  deleteDialogOpen.value = true
}

const onConfirmDelete = async () => {
  // Capture synchronously up front so it survives the dialog auto-close.
  const attachment = pendingDelete.value
  deleteDialogOpen.value = false
  if (!attachment) return
  await handleDelete(attachment)
  pendingDelete.value = null
}

const resolveIcon = (attachment: IBotSessionAttachment): Component => {
  const mime = attachment.mimeType?.toLowerCase() ?? ""
  if (mime.startsWith("image/")) return IconFileImage
  if (mime.includes("pdf")) return IconFilePdf
  return IconFileText
}

const dismissUploadState = (id: string) => {
  uploadStates.value = uploadStates.value.filter((item) => item.id !== id)
}

const triggerUpload = () => {
  if (!canEdit.value) return
  openFileDialog()
}

const processFiles = async (files: File[]) => {
  if (!files.length || !canEdit.value) return
  let success = 0
  let failure = 0
  for (const file of files) {
    const uploadId = `${file.name}-${file.size}-${file.lastModified}`
    uploadStates.value = [
      ...uploadStates.value.filter((item) => item.id !== uploadId),
      { id: uploadId, name: file.name, status: "uploading" },
    ]
    try {
      // Auto-include freshly uploaded files in the next send (the user can
      // un-check them via the toggle below).
      const attachmentId = await createAttachmentFromFile(file)
      if (!isSelected(attachmentId)) toggleSelected(attachmentId)
      dismissUploadState(uploadId)
      success += 1
    } catch (uploadError) {
      failure += 1
      uploadStates.value = uploadStates.value.map((item) =>
        item.id === uploadId
          ? { ...item, status: "error", error: (uploadError as Error).message }
          : item
      )
    }
  }
  if (success > 0) {
    showSuccessToast(
      success === 1 ? "File uploaded." : `${success} files uploaded.`
    )
  }
  if (failure > 0) {
    showErrorToast(
      failure === 1 ? "Upload failed" : "Some uploads failed",
      failure === 1
        ? "The file couldn't be uploaded — see the list above for details."
        : `${failure} files couldn't be uploaded — see the list above for details.`
    )
  }
}

watch(selectedFiles, async (files) => {
  if (!files || files.length === 0) return
  await processFiles(Array.from(files))
})

const downloadAttachment = async (attachment: IBotSessionAttachment) => {
  if (downloadingIds.value.includes(attachment.id) || !attachment.storagePath) {
    return
  }
  downloadingIds.value = [...downloadingIds.value, attachment.id]
  try {
    const url = await getDownloadURL(getStorageFileRef(attachment.storagePath))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = attachment.originalName || attachment.displayName
    anchor.rel = "noopener noreferrer"
    anchor.target = "_blank"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } catch (downloadError) {
    showErrorToast("Download failed", (downloadError as Error).message)
  } finally {
    downloadingIds.value = downloadingIds.value.filter(
      (id) => id !== attachment.id
    )
  }
}

const openEditDialog = (attachment: IBotSessionAttachment) => {
  if (!canEdit.value) return
  editingAttachment.value = attachment
  editName.value = attachment.displayName
  editDialogOpen.value = true
}

const closeEditDialog = () => {
  editDialogOpen.value = false
  editingAttachment.value = null
  editName.value = ""
}

const handleEditSubmit = async () => {
  if (!editingAttachment.value) return
  isSavingEdit.value = true
  try {
    await updateAttachment({
      attachment: editingAttachment.value,
      displayName: editName.value,
    })
    showSuccessToast("Renamed.")
    closeEditDialog()
  } catch (saveError) {
    showErrorToast("Rename failed", (saveError as Error).message)
  } finally {
    isSavingEdit.value = false
  }
}

const handleDelete = async (attachment: IBotSessionAttachment) => {
  deletingId.value = attachment.id
  try {
    if (isSelected(attachment.id)) toggleSelected(attachment.id)
    await deleteAttachment(attachment)
    showSuccessToast("Deleted.")
  } catch (deleteError) {
    showErrorToast("Delete failed", (deleteError as Error).message)
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="flex size-full min-h-0 grow flex-col">
    <ButtonGroup class="w-full px-2 pb-2">
      <Button
        variant="outline"
        size="sm"
        class="grow justify-start"
        :disabled="!canEdit || uploadInProgress"
        @click="triggerUpload"
      >
        <IconUpload />
        <span>Upload files</span>
      </Button>
    </ButtonGroup>

    <OverlayScrollbarsWrapper>
      <div class="space-y-2 p-2">
        <!-- No session yet -->
        <Empty v-if="!sessionId" class="rounded-xl border border-dashed p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconUpload />
            </EmptyMedia>
            <EmptyTitle>No chat yet</EmptyTitle>
            <EmptyDescription>
              Send a message to start this chat, then upload files to share with
              the assistant.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

        <template v-else>
          <!-- In-flight uploads -->
          <div
            v-if="uploadStates.length"
            class="space-y-2 rounded-xl border p-2"
          >
            <div
              v-for="item in uploadStates"
              :key="item.id"
              class="flex items-start gap-2 rounded-xl border p-2"
            >
              <Spinner v-if="item.status === 'uploading'" />
              <IconCircleAlert v-else class="text-destructive shrink-0" />
              <div class="min-w-0 grow">
                <p class="truncate text-xs font-medium">{{ item.name }}</p>
                <p class="text-muted-foreground text-xs">
                  {{ item.status === "uploading" ? "Uploading…" : item.error }}
                </p>
              </div>
              <Button
                v-if="item.status === 'error'"
                variant="ghost"
                size="icon-sm"
                @click="dismissUploadState(item.id)"
              >
                <IconX />
              </Button>
            </div>
          </div>

          <Empty v-if="loading && attachments.length === 0" class="p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Spinner /></EmptyMedia>
              <EmptyTitle>Loading attachments…</EmptyTitle>
            </EmptyHeader>
          </Empty>

          <div v-else-if="error" class="space-y-2 rounded-xl border p-2">
            <div class="text-destructive flex items-start gap-2 text-xs">
              <IconAlertTriangle />
              <span>{{ error }}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              class="w-full"
              @click="refresh"
            >
              <IconRefreshCcw />
              Retry
            </Button>
          </div>

          <Empty
            v-else-if="attachments.length === 0"
            class="rounded-xl border border-dashed p-6"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon"><IconUpload /></EmptyMedia>
              <EmptyTitle>No attachments</EmptyTitle>
              <EmptyDescription>
                Upload images or PDFs to include them with your messages.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>

          <article
            v-for="attachment in attachments"
            v-else
            :key="attachment.id"
            class="rounded-xl border p-2"
            :class="isSelected(attachment.id) ? 'border-primary' : ''"
          >
            <div class="flex items-start gap-2">
              <div
                class="bg-muted flex size-9 shrink-0 items-center justify-center rounded border"
              >
                <Component
                  :is="resolveIcon(attachment)"
                  class="text-muted-foreground"
                />
              </div>
              <div class="min-w-0 grow space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {{ attachment.displayName }}
                    </p>
                    <p class="text-muted-foreground truncate text-xs">
                      {{ formatAttachmentSize(attachment.size) }} ·
                      {{ attachment.mimeType ?? "unknown type" }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :disabled="downloadingIds.includes(attachment.id)"
                      @click="downloadAttachment(attachment)"
                    >
                      <Spinner v-if="downloadingIds.includes(attachment.id)" />
                      <IconArrowDownToLine v-else />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :disabled="!canEdit"
                      @click="openEditDialog(attachment)"
                    >
                      <IconPencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :disabled="!canEdit || deletingId === attachment.id"
                      @click="openDeleteDialog(attachment)"
                    >
                      <Spinner v-if="deletingId === attachment.id" />
                      <IconTrash2 v-else />
                    </Button>
                  </div>
                </div>
                <Button
                  :variant="isSelected(attachment.id) ? 'default' : 'outline'"
                  size="sm"
                  class="w-full justify-start"
                  :disabled="!canEdit"
                  @click="toggleSelected(attachment.id)"
                >
                  <IconCheck v-if="isSelected(attachment.id)" />
                  {{
                    isSelected(attachment.id)
                      ? "Included in next message"
                      : "Include in next message"
                  }}
                </Button>
              </div>
            </div>
          </article>
        </template>
      </div>
    </OverlayScrollbarsWrapper>

    <Dialog
      :open="editDialogOpen"
      @update:open="($event) => !$event && closeEditDialog()"
    >
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rename attachment</DialogTitle>
          <DialogDescription>
            Update the display name for this file.
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="handleEditSubmit">
          <div class="space-y-2">
            <Label for="session-attachment-name">File name</Label>
            <Input
              id="session-attachment-name"
              v-model="editName"
              :maxlength="ATTACHMENT_NAME_MAX_LENGTH"
            />
          </div>
          <DialogFooter>
            <DialogClose as-child>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" :disabled="isSavingEdit">
              <Spinner v-if="isSavingEdit" />
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog
      :open="deleteDialogOpen"
      @update:open="(value) => (deleteDialogOpen = value)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete attachment</AlertDialogTitle>
          <AlertDialogDescription>
            Delete
            <span class="font-medium">{{ pendingDelete?.displayName }}</span>
            ? This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            :disabled="deletingId === pendingDelete?.id"
            @click="onConfirmDelete"
          >
            <Spinner v-if="deletingId === pendingDelete?.id" />
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script lang="ts" setup>
import DriveFilePicker from "@/components/app/sidebars/DriveFilePicker.vue"
import { BotChatContextKey } from "@/composables/useBotChat"
import { useMyConnectionFeature } from "@/composables/useConnections"
import { importDriveSessionAttachment } from "@/composables/useFunctions"
import {
  useSessionAttachmentsState,
  type BotSessionAttachmentContext,
} from "@/composables/useSessionAttachments"
import {
  IconAlertTriangle,
  IconArrowDownToLine,
  IconCheck,
  IconCircleAlert,
  IconLogosGoogleDrive,
  IconPencil,
  IconRefreshCcw,
  IconTrash2,
  IconUpload,
  IconX,
} from "@/data/icons"
import {
  formatAttachmentSize,
  NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  resolveAttachmentIcon,
} from "@/helpers/node-attachments"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useAuthStore } from "@/stores/authStore"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  type IBotSessionAttachment,
} from "@/types/nodes"
import { getStorageFileRef } from "@/utils/firebase/firebase-helpers"
import { getDownloadURL } from "firebase/storage"
import { storeToRefs } from "pinia"
import { computed, inject, ref, watch } from "vue"

interface UploadState {
  id: string
  name: string
  status: "uploading" | "error"
  error?: string
}

const { t } = useI18n()

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

// Brand-new chat (no session id yet): files are buffered on the shared
// BotChatContext and staged + sent by the composer's `handleSend` with the
// first message — so uploads work before a session exists, mirroring the
// composer's own "Upload files" action.
const pendingUploadFiles = computed(
  () => botChat?.pendingUploadFiles.value ?? []
)
const canBufferPending = computed(
  () => !sessionId.value && !!currentTeamId.value && !!currentWorkspaceId.value
)
const removePendingUpload = (index: number) => {
  botChat?.pendingUploadFiles.value.splice(index, 1)
}
const pendingDriveImports = computed(
  () => botChat?.pendingDriveImports.value ?? []
)
const removePendingDriveImport = (index: number) => {
  botChat?.pendingDriveImports.value.splice(index, 1)
}

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

// "Add from Drive" — the in-app picker (docs/connections-google-drive-d3
// .prompt.md). Offered only while the Drive feature is actually usable:
// app installed + admin kill switch off + the member's own account linked
// (Settings → Connections is the discovery surface for the rest).
const { available: driveAvailable } = useMyConnectionFeature("google-drive")
const drivePickerOpen = ref(false)
const importDriveFile = async (fileId: string, displayName: string) => {
  // Brand-new chat: buffer the pick instead of importing. The first send
  // forwards the id as `pendingDriveImports` and the server fetches the bytes
  // (Drive bytes can't be staged client-side), so the file rides the first
  // message. Return a synthetic ref so the picker can close + emit.
  if (canBufferPending.value && botChat) {
    if (!botChat.pendingDriveImports.value.some((d) => d.fileId === fileId)) {
      botChat.pendingDriveImports.value.push({ fileId, displayName })
    }
    return { attachmentId: fileId, displayName }
  }
  const context = attachmentContext.value
  // Unreachable in practice — the button is disabled without a session.
  if (!context) throw new Error("Send a message to start this chat first.")
  const { data } = await importDriveSessionAttachment({ ...context, fileId })
  return data
}
const onDriveImported = (attachmentId: string, displayName: string) => {
  // Buffered for the first message — no live attachment to select yet.
  if (!sessionId.value) {
    showSuccessToast(`"${displayName}" will be sent with your first message.`)
    return
  }
  // Auto-include in the next send, mirroring fresh uploads.
  if (!isSelected(attachmentId)) toggleSelected(attachmentId)
  showSuccessToast(`Imported "${displayName}" from Google Drive.`)
}
// Close the picker on session switch — the import callable reads
// `attachmentContext` reactively, so a pick made after a switch would land
// the file in the NEW chat.
watch(sessionId, () => {
  drivePickerOpen.value = false
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

const dismissUploadState = (id: string) => {
  uploadStates.value = uploadStates.value.filter((item) => item.id !== id)
}

const triggerUpload = () => {
  if (!canEdit.value && !canBufferPending.value) return
  openFileDialog()
}

const processFiles = async (files: File[]) => {
  if (!files.length) return
  // No session yet: buffer for the first message instead of uploading. Size
  // is checked up front (the stage step + server re-check it too).
  if (canBufferPending.value && botChat) {
    for (const file of files) {
      if (file.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
        showErrorToast("File too large", `${file.name} is larger than 25 MB.`)
        continue
      }
      botChat.pendingUploadFiles.value.push(file)
    }
    return
  }
  if (!canEdit.value) return
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
  <div class="flex size-full min-h-0 grow flex-col gap-2">
    <ButtonGroup>
      <Button
        variant="outline"
        size="sm"
        class="grow justify-start"
        :disabled="(!canEdit && !canBufferPending) || uploadInProgress"
        @click="triggerUpload"
      >
        <IconUpload />
        <span>Upload files</span>
      </Button>
      <Button
        v-if="driveAvailable"
        variant="outline"
        size="sm"
        :disabled="(!canEdit && !canBufferPending) || uploadInProgress"
        @click="drivePickerOpen = true"
      >
        <IconLogosGoogleDrive />
        <span class="sr-only">Add from Google Drive</span>
      </Button>
    </ButtonGroup>
    <DriveFilePicker
      v-if="driveAvailable"
      v-model:open="drivePickerOpen"
      :team-id="currentTeamId ?? null"
      :import-file="importDriveFile"
      @imported="onDriveImported"
    />
    <OverlayScrollbarsWrapper>
      <div class="flex flex-col gap-2">
        <!-- No session yet: buffered uploads ride along with the first message -->
        <template v-if="!sessionId">
          <Attachment
            v-for="(file, index) in pendingUploadFiles"
            :key="`pending:${index}:${file.name}`"
            state="idle"
            class="w-full"
          >
            <AttachmentMedia>
              <IconUpload />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{{ file.name }}</AttachmentTitle>
              <AttachmentDescription>
                {{ formatAttachmentSize(file.size) }} · Sent with first message
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                :aria-label="
                  t('ai.detachAttachment', { name: file.name }, file.name)
                "
                @click="removePendingUpload(index)"
              >
                <IconX />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>

          <Attachment
            v-for="(file, index) in pendingDriveImports"
            :key="`drive:${index}:${file.fileId}`"
            state="idle"
            class="w-full"
          >
            <AttachmentMedia>
              <IconLogosGoogleDrive />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{{ file.displayName }}</AttachmentTitle>
              <AttachmentDescription>
                Google Drive · Sent with first message
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                :aria-label="
                  t(
                    'ai.detachAttachment',
                    { name: file.displayName },
                    file.displayName
                  )
                "
                @click="removePendingDriveImport(index)"
              >
                <IconX />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>

          <Empty
            v-if="
              pendingUploadFiles.length === 0 &&
              pendingDriveImports.length === 0
            "
            class="rounded-xl border border-dashed p-6"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconUpload />
              </EmptyMedia>
              <EmptyTitle>No attachments</EmptyTitle>
              <EmptyDescription>
                Upload files to send with your first message.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </template>

        <template v-else>
          <!-- In-flight uploads — `state="uploading"` shimmers the title
               automatically while the upload is in flight -->
          <div v-if="uploadStates.length" class="flex flex-col gap-2">
            <Attachment
              v-for="item in uploadStates"
              :key="item.id"
              :state="item.status === 'uploading' ? 'uploading' : 'error'"
              class="w-full"
            >
              <AttachmentMedia>
                <Spinner v-if="item.status === 'uploading'" />
                <IconCircleAlert v-else />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{{ item.name }}</AttachmentTitle>
                <AttachmentDescription>
                  {{ item.status === "uploading" ? "Uploading…" : item.error }}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions v-if="item.status === 'error'">
                <AttachmentAction
                  :aria-label="
                    t('ai.detachAttachment', { name: item.name }, item.name)
                  "
                  @click="dismissUploadState(item.id)"
                >
                  <IconX />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          </div>

          <LoadingState
            v-if="loading && attachments.length === 0"
            label="Loading attachments…"
          />

          <div v-else-if="error" class="space-y-2 rounded-md border p-2">
            <div class="text-destructive flex items-start gap-2 text-xs">
              <IconAlertTriangle />
              <span>{{ error }}</span>
            </div>
            <Button variant="secondary" size="sm" @click="refresh">
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

          <Attachment
            v-for="attachment in attachments"
            v-else
            :key="attachment.id"
            :class="['w-full', isSelected(attachment.id) && 'border-primary']"
          >
            <AttachmentMedia>
              <IconCheck v-if="isSelected(attachment.id)" />
              <Component :is="resolveAttachmentIcon(attachment)" v-else />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{{ attachment.displayName }}</AttachmentTitle>
              <AttachmentDescription>
                {{ formatAttachmentSize(attachment.size) }} ·
                {{
                  isSelected(attachment.id)
                    ? "Included in next message"
                    : (attachment.mimeType ?? "unknown type")
                }}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                :aria-label="t('actions.download')"
                :disabled="downloadingIds.includes(attachment.id)"
                @click="downloadAttachment(attachment)"
              >
                <Spinner v-if="downloadingIds.includes(attachment.id)" />
                <IconArrowDownToLine v-else />
              </AttachmentAction>
              <AttachmentAction
                :aria-label="t('actions.rename')"
                :disabled="!canEdit"
                @click="openEditDialog(attachment)"
              >
                <IconPencil />
              </AttachmentAction>
              <AttachmentAction
                :aria-label="t('actions.delete')"
                :disabled="!canEdit || deletingId === attachment.id"
                @click="openDeleteDialog(attachment)"
              >
                <Spinner v-if="deletingId === attachment.id" />
                <IconTrash2 v-else />
              </AttachmentAction>
            </AttachmentActions>
            <!-- Whole-card toggle. The trigger fills the card behind the
                 actions (z-10 vs z-20), so download/rename/delete stay
                 independently clickable — and the card's has-[>button]
                 hover tint now reads as intended because the card IS
                 clickable. Selection stays conveyed beyond color: check
                 icon in the media, state text in the description, and
                 aria-pressed on the trigger. -->
            <AttachmentTrigger
              :aria-label="
                isSelected(attachment.id)
                  ? `Remove ${attachment.displayName} from next message`
                  : `Include ${attachment.displayName} in next message`
              "
              :aria-pressed="isSelected(attachment.id)"
              :disabled="!canEdit"
              @click="toggleSelected(attachment.id)"
            />
          </Attachment>
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
              <Button variant="outline">
                Cancel
                <Kbd>Esc</Kbd>
              </Button>
            </DialogClose>
            <Button type="submit" data-dialog-action :disabled="isSavingEdit">
              <Spinner v-if="isSavingEdit" />
              Save
              <Kbd>↩</Kbd>
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
          <AlertDialogCancel>Cancel<Kbd>Esc</Kbd> </AlertDialogCancel>
          <AlertDialogAction
            :disabled="deletingId === pendingDelete?.id"
            @click="onConfirmDelete"
          >
            <Spinner v-if="deletingId === pendingDelete?.id" />
            Delete
            <Kbd>↩</Kbd>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

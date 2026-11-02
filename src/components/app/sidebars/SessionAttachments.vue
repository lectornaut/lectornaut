<script lang="ts" setup>
import DriveFilePicker from "@/components/app/sidebars/DriveFilePicker.vue"
import { BotChatContextKey } from "@/composables/useBotChat"
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
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
// .prompt.md). Availability lives inside the picker: an unconnected member
// gets its in-sheet connect-Drive steer instead of a hidden button.
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
  if (!context) {
    throw new Error(t("components.sessionAttachments.errors.noSession"))
  }
  const { data } = await importDriveSessionAttachment({ ...context, fileId })
  return data
}
const onDriveImported = (attachmentId: string, displayName: string) => {
  // Buffered for the first message — no live attachment to select yet.
  if (!sessionId.value) {
    showSuccessToast(
      t("components.sessionAttachments.toasts.driveBuffered", {
        name: displayName,
      })
    )
    return
  }
  // Auto-include in the next send, mirroring fresh uploads.
  if (!isSelected(attachmentId)) toggleSelected(attachmentId)
  showSuccessToast(
    t("components.sessionAttachments.toasts.driveImported", {
      name: displayName,
    })
  )
}
const editDialogOpen = ref(false)
const editingAttachment = ref<IBotSessionAttachment | null>(null)
const editName = ref("")
const isSavingEdit = ref(false)

const deleteDialog = useConfirmationDialog<IBotSessionAttachment>()

const openDeleteDialog = (attachment: IBotSessionAttachment) => {
  if (!canEdit.value) return
  deleteDialog.open(attachment)
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
        showErrorToast(
          t("components.sessionAttachments.toasts.fileTooLargeTitle"),
          t("components.sessionAttachments.toasts.fileTooLargeDescription", {
            name: file.name,
            limit: formatAttachmentSize(NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES),
          })
        )
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
      t("components.sessionAttachments.toasts.uploaded", success)
    )
  }
  if (failure > 0) {
    showErrorToast(
      t("components.sessionAttachments.toasts.uploadFailedTitle", failure),
      t("components.sessionAttachments.toasts.uploadFailedDescription", failure)
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
    showErrorToast(
      t("components.sessionAttachments.toasts.downloadFailedTitle"),
      (downloadError as Error).message
    )
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

// Save is meaningless with an empty or unchanged name.
const canSaveEdit = computed(() => {
  const name = editName.value.trim()
  return (
    !!editingAttachment.value &&
    name.length > 0 &&
    name !== editingAttachment.value.displayName
  )
})

const handleEditSubmit = async () => {
  if (!editingAttachment.value || !canSaveEdit.value) return
  isSavingEdit.value = true
  try {
    await updateAttachment({
      attachment: editingAttachment.value,
      displayName: editName.value,
    })
    showSuccessToast(t("components.sessionAttachments.toasts.renamed"))
    closeEditDialog()
  } catch (saveError) {
    showErrorToast(
      t("components.sessionAttachments.toasts.renameFailedTitle"),
      (saveError as Error).message
    )
  } finally {
    isSavingEdit.value = false
  }
}

const handleDelete = async (attachment: IBotSessionAttachment) => {
  deletingId.value = attachment.id
  try {
    if (isSelected(attachment.id)) toggleSelected(attachment.id)
    await deleteAttachment(attachment)
    showSuccessToast(t("components.sessionAttachments.toasts.deleted"))
  } catch (deleteError) {
    showErrorToast(
      t("components.sessionAttachments.toasts.deleteFailedTitle"),
      (deleteError as Error).message
    )
    // Rethrow so the confirm dialog stays open with the attachment intact.
    throw deleteError
  } finally {
    deletingId.value = null
  }
}

// Close the picker and both dialogs on session switch: the import callable
// reads `attachmentContext` reactively (a pick made after a switch would land
// the file in the NEW chat), and the rename/delete dialogs would otherwise
// keep acting on the previous chat's attachment.
watch(sessionId, () => {
  drivePickerOpen.value = false
  closeEditDialog()
  deleteDialog.close()
})
</script>

<template>
  <div class="flex size-full min-h-0 grow flex-col gap-2">
    <ButtonGroup class="mx-2 w-auto">
      <Button
        variant="outline"
        class="grow justify-start"
        :disabled="(!canEdit && !canBufferPending) || uploadInProgress"
        @click="triggerUpload"
      >
        <IconUpload />
        <span>{{ t("components.sessionAttachments.uploadFiles") }}</span>
      </Button>
      <!-- Sheet root + trigger render no wrapper DOM, so the Button stays a
           direct child of ButtonGroup for its joined-corner selectors. -->
      <DriveFilePicker
        v-model:open="drivePickerOpen"
        :team-id="currentTeamId ?? null"
        :import-file="importDriveFile"
        :trigger-label="t('components.sessionAttachments.addFromDrive')"
        @imported="onDriveImported"
      />
    </ButtonGroup>
    <ScrollContainer>
      <div class="flex flex-col gap-2 px-2 pb-2">
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
                {{
                  t("components.sessionAttachments.pendingUploadMeta", {
                    size: formatAttachmentSize(file.size),
                  })
                }}
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
                {{ t("components.sessionAttachments.pendingDriveMeta") }}
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
            class="rounded-surface border border-dashed p-6"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconUpload />
              </EmptyMedia>
              <EmptyTitle>{{
                t("components.sessionAttachments.emptyTitle")
              }}</EmptyTitle>
              <EmptyDescription>
                {{ t("components.sessionAttachments.emptyPending") }}
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
                  {{
                    item.status === "uploading"
                      ? t("components.sessionAttachments.uploading")
                      : item.error
                  }}
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
            :label="t('components.sessionAttachments.loading')"
          />

          <div v-else-if="error" class="rounded-surface space-y-2 border p-2">
            <div class="text-destructive flex items-start gap-2 text-xs">
              <IconAlertTriangle />
              <span>{{ error }}</span>
            </div>
            <Button variant="secondary" @click="refresh">
              <IconRefreshCcw />
              {{ t("actions.retry") }}
            </Button>
          </div>

          <Empty
            v-else-if="attachments.length === 0"
            class="rounded-surface border border-dashed p-6"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon"><IconUpload /></EmptyMedia>
              <EmptyTitle>{{
                t("components.sessionAttachments.emptyTitle")
              }}</EmptyTitle>
              <EmptyDescription>
                {{ t("components.sessionAttachments.emptyDescription") }}
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
                    ? t("components.sessionAttachments.includedInNextMessage")
                    : (attachment.mimeType ??
                      t("components.sessionAttachments.unknownType"))
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
                  ? t('components.sessionAttachments.excludeFromNextMessage', {
                      name: attachment.displayName,
                    })
                  : t('components.sessionAttachments.includeInNextMessage', {
                      name: attachment.displayName,
                    })
              "
              :aria-pressed="isSelected(attachment.id)"
              :disabled="!canEdit"
              @click="toggleSelected(attachment.id)"
            />
          </Attachment>
        </template>
      </div>
    </ScrollContainer>
    <Dialog
      :open="editDialogOpen"
      @update:open="($event) => !$event && closeEditDialog()"
    >
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{
            t("components.sessionAttachments.renameTitle")
          }}</DialogTitle>
          <DialogDescription>
            {{ t("components.sessionAttachments.renameDescription") }}
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="handleEditSubmit">
          <div class="space-y-2">
            <Label for="session-attachment-name">{{
              t("components.sessionAttachments.fileNameLabel")
            }}</Label>
            <Input
              id="session-attachment-name"
              v-model="editName"
              :maxlength="ATTACHMENT_NAME_MAX_LENGTH"
            />
          </div>
          <DialogFooter>
            <DialogClose as-child>
              <Button variant="outline">
                {{ t("actions.cancel") }}
                <Kbd>Esc</Kbd>
              </Button>
            </DialogClose>
            <Button
              type="submit"
              data-dialog-action
              :disabled="isSavingEdit || !canSaveEdit"
            >
              <Spinner v-if="isSavingEdit" />
              {{ t("actions.save") }}
              <Kbd>↩</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <ConfirmAction
      v-model:open="deleteDialog.isOpen.value"
      :title="t('components.sessionAttachments.deleteTitle')"
      :action-label="t('actions.delete')"
      destructive
      :on-confirm="() => deleteDialog.confirm(handleDelete)"
    >
      <template #description>
        <i18n-t
          keypath="components.sessionAttachments.deleteDescription"
          tag="span"
        >
          <template #name>
            <span class="text-foreground font-medium">{{
              deleteDialog.item.value?.displayName
            }}</span>
          </template>
        </i18n-t>
      </template>
    </ConfirmAction>
  </div>
</template>

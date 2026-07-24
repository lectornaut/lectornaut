<script lang="ts" setup>
import DriveFilePicker from "@/components/app/sidebars/DriveFilePicker.vue"
import { useConfirmationDialog } from "@/composables/useConfirmationDialog"
import { importDriveNodeAttachment } from "@/composables/useFunctions"
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
  IconPencil,
  IconRefreshCcw,
  IconTrash2,
  IconUpload,
  IconX,
} from "@/data/icons"
import {
  formatAttachmentSize,
  normalizeAttachmentDisplayName,
  resolveAttachmentIcon,
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
import { toRefs } from "vue"

const { t } = useI18n()

interface UploadState {
  id: string
  name: string
  status: "uploading" | "error"
  error?: string
}

const props = defineProps<{
  teamId: string
  workspaceId: string
  scope: WorkspaceNodeScope
  node: WorkspaceNode
}>()

const { teamId, workspaceId, node } = toRefs(props)
const nodeId = computed(() => node.value.id)

const authStore = useAuthStore()
const membershipStore = useMembershipStore()

const { currentUser } = storeToRefs(authStore)
const { memberships } = storeToRefs(membershipStore)

// Declared as nullable union to satisfy `useNodeAttachmentsState`'s
// `MaybeRefOrGetter<AttachmentMutationContext | null>` contract (other
// callers may pass null). Within this component the inspector's v-if
// guarantees non-null, so we always return a populated context.
const attachmentContext = computed<AttachmentMutationContext | null>(() => ({
  teamId: teamId.value,
  workspaceId: workspaceId.value,
  nodeId: node.value.id,
  scope: props.scope,
}))
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
  () => node.value.isArchived || !canManageAttachments.value
)

const readOnlyMessage = computed(() => {
  if (node.value.isArchived) {
    return t("components.nodeAttachments.readOnlyArchived")
  }
  if (!canManageAttachments.value) {
    return t("components.nodeAttachments.readOnlyPermission")
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

const formatMimeType = (value: string | null | undefined) => {
  if (!value) return t("components.nodeAttachments.unknownType")
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
  if (node.value.isArchived) {
    throw new Error(t("components.nodeAttachments.toasts.archived"))
  }
  if (!canManageAttachments.value) {
    throw new Error(t("components.nodeAttachments.toasts.noPermission"))
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

// "Add from Drive" — same in-app picker as SessionAttachments, landing the
// file as a node attachment via `importDriveNodeAttachment` (bytes move
// entirely server-side). Availability lives inside the picker: an
// unconnected member gets its in-sheet connect-Drive steer instead of a
// hidden button.
const drivePickerOpen = ref(false)

const importDriveFile = async (fileId: string) => {
  const context = getMutableContext()
  const { data } = await importDriveNodeAttachment({ ...context, fileId })
  return data
}

const onDriveImported = (_attachmentId: string, displayName: string) => {
  // The live attachments query picks up the new doc; just confirm.
  showSuccessToast(
    t("components.nodeAttachments.toasts.driveImported", { name: displayName })
  )
}

const processSelectedFiles = async (files: File[]) => {
  if (!files.length) return

  let successCount = 0
  let failureCount = 0

  try {
    getMutableContext()
  } catch (contextError) {
    showErrorToast(
      t("components.nodeAttachments.toasts.uploadFailedTitle"),
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
        ? t("components.nodeAttachments.toasts.uploadedSingle")
        : t("components.nodeAttachments.toasts.uploadedMultiple", {
            count: successCount,
          })
    )
  }

  if (failureCount > 0) {
    showErrorToast(
      failureCount === 1
        ? t("components.nodeAttachments.toasts.uploadFailedSingle")
        : t("components.nodeAttachments.toasts.uploadFailedMultiple"),
      failureCount === 1
        ? t("components.nodeAttachments.toasts.uploadFailedSingleDescription")
        : t(
            "components.nodeAttachments.toasts.uploadFailedMultipleDescription",
            {
              count: failureCount,
            }
          )
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
  showSuccessToast(t("components.nodeAttachments.toasts.downloaded"))
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
      t("components.nodeAttachments.toasts.downloadFailedTitle"),
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
      replacementFile.value
        ? t("components.nodeAttachments.toasts.updated")
        : t("components.nodeAttachments.toasts.renamed")
    )
    closeEditDialog()
  } catch (saveError) {
    showErrorToast(
      t("components.nodeAttachments.toasts.updateFailedTitle"),
      (saveError as Error).message
    )
  } finally {
    isSavingEdit.value = false
  }
}

const handleDeleteConfirm = async (attachment: WorkspaceNodeAttachment) => {
  try {
    getMutableContext()
    deletingId.value = attachment.id
    await deleteAttachment(attachment)
    showSuccessToast(t("components.nodeAttachments.toasts.deleted"))
  } catch (deleteError) {
    showErrorToast(
      t("components.nodeAttachments.toasts.deleteFailedTitle"),
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
  // Close the Drive picker too — its import callable reads the node context
  // reactively, so a pick made after a node switch would land the file on
  // the NEW node.
  drivePickerOpen.value = false
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
  <div class="flex size-full min-h-0 grow flex-col gap-2">
    <ButtonGroup class="mx-2 w-auto">
      <Button
        variant="outline"
        size="sm"
        class="grow justify-start"
        :disabled="isReadOnly || uploadInProgress"
        @click="triggerFilePicker"
      >
        <IconUpload />
        <span>{{ t("components.nodeAttachments.upload") }}</span>
      </Button>
      <!-- Sheet root + trigger render no wrapper DOM, so the Button stays a
           direct child of ButtonGroup for its joined-corner selectors. -->
      <DriveFilePicker
        v-model:open="drivePickerOpen"
        :team-id="teamId"
        :import-file="importDriveFile"
        :trigger-label="t('components.nodeAttachments.addFromDrive')"
        @imported="onDriveImported"
      />
    </ButtonGroup>
    <ScrollContainer>
      <div class="flex flex-col gap-2 px-2 pb-2">
        <div v-if="readOnlyMessage" class="text-muted-foreground text-xs">
          {{ readOnlyMessage }}
        </div>

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
                    ? t("components.nodeAttachments.uploading")
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
          :label="t('components.nodeAttachments.loadingAttachments')"
        />

        <div v-else-if="error" class="space-y-2 rounded border p-2">
          <div class="text-destructive flex items-start gap-2 text-xs">
            <IconAlertTriangle />
            <span>{{ error }}</span>
          </div>

          <Button variant="secondary" size="sm" @click="refreshAttachments">
            <IconRefreshCcw />
            {{ t("components.nodeAttachments.retry") }}
          </Button>
        </div>

        <Empty
          v-else-if="attachments.length === 0"
          class="rounded-xl border border-dashed p-6"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconUpload />
            </EmptyMedia>
            <EmptyTitle>
              {{ t("components.nodeAttachments.emptyTitle") }}
            </EmptyTitle>
            <EmptyDescription>
              {{
                isReadOnly
                  ? t("components.nodeAttachments.emptyReadOnly")
                  : t("components.nodeAttachments.emptyWritable")
              }}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

        <Attachment
          v-for="attachment in attachments"
          v-else
          :key="attachment.id"
          class="w-full"
        >
          <AttachmentMedia>
            <Component :is="resolveAttachmentIcon(attachment)" />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{{ attachment.displayName }}</AttachmentTitle>
            <AttachmentDescription>
              {{ formatAttachmentSize(attachment.size) }} ·
              {{
                isAttachmentPending(attachment.id)
                  ? t("components.nodeAttachments.syncing")
                  : formatMimeType(attachment.mimeType)
              }}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              :aria-label="t('actions.download')"
              :disabled="
                downloadingIds.includes(attachment.id) ||
                isAttachmentPending(attachment.id) ||
                !attachment.storagePath
              "
              @click="downloadAttachment(attachment)"
            >
              <Spinner v-if="downloadingIds.includes(attachment.id)" />
              <IconArrowDownToLine v-else />
            </AttachmentAction>
            <AttachmentAction
              :aria-label="t('actions.rename')"
              :disabled="isReadOnly || isAttachmentPending(attachment.id)"
              @click="openEditDialog(attachment)"
            >
              <IconPencil />
            </AttachmentAction>
            <AttachmentAction
              :aria-label="t('actions.delete')"
              :disabled="
                isReadOnly ||
                deletingId === attachment.id ||
                isAttachmentPending(attachment.id)
              "
              @click="openDeleteDialog(attachment)"
            >
              <Spinner v-if="deletingId === attachment.id" />
              <IconTrash2 v-else />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      </div>
    </ScrollContainer>
  </div>

  <Dialog
    :open="editDialogOpen"
    @update:open="($event) => !$event && closeEditDialog()"
  >
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{
          t("components.nodeAttachments.editTitle")
        }}</DialogTitle>
        <DialogDescription>
          {{ t("components.nodeAttachments.editDescription") }}
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-4" @submit.prevent="handleEditSubmit">
        <div class="space-y-2">
          <Label for="attachment-display-name">{{
            t("components.nodeAttachments.fileNameLabel")
          }}</Label>
          <Input
            id="attachment-display-name"
            v-model="editDisplayName"
            :maxlength="ATTACHMENT_NAME_MAX_LENGTH"
            :placeholder="t('components.nodeAttachments.fileNamePlaceholder')"
          />
        </div>

        <div class="space-y-2">
          <Label :for="`attachment-replace-${replacementInputKey}`">
            {{ t("components.nodeAttachments.replaceFileLabel") }}
          </Label>
          <Input
            :id="`attachment-replace-${replacementInputKey}`"
            :key="replacementInputKey"
            type="file"
            @change="handleReplacementSelected"
          />

          <Attachment
            v-if="replacementFile"
            state="idle"
            size="sm"
            class="w-full"
          >
            <AttachmentContent>
              <AttachmentTitle>{{ replacementFile.name }}</AttachmentTitle>
              <AttachmentDescription>
                {{ formatAttachmentSize(replacementFile.size) }}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <Button variant="ghost" @click="clearReplacementFile">
                {{ t("components.nodeAttachments.clear") }}
              </Button>
            </AttachmentActions>
          </Attachment>
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
            :disabled="!hasEditChanges || isSavingEdit"
          >
            <Spinner v-if="isSavingEdit" />
            {{ t("actions.save") }}
            <Kbd>↩</Kbd>
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
        <AlertDialogTitle>{{
          t("components.nodeAttachments.deleteTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("components.nodeAttachments.deleteDescriptionPrefix") }}
          <span class="font-medium">
            {{ attachmentToDelete?.displayName }}
          </span>
          {{ t("components.nodeAttachments.deleteDescriptionSuffix") }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter>
        <AlertDialogCancel>
          {{ t("actions.cancel") }}
          <Kbd>Esc</Kbd>
        </AlertDialogCancel>
        <AlertDialogAction
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
          {{ t("actions.delete") }}
          <Kbd>↩</Kbd>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

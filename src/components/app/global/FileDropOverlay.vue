<script lang="ts" setup>
import {
  provideSidebarContext,
  useSidebar,
} from "@/components/ui/sidebar/utils"
import {
  createWorkspaceNodeAttachmentFromFile,
  type AttachmentMutationContext,
} from "@/composables/useNodeAttachments"
import {
  getCurrentTauriWindow,
  isTauri,
  platform,
  useIsFullscreen,
} from "@/composables/usePlatform"
import { useTeamActions } from "@/composables/useTeamActions"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconArchive,
  IconEye,
  IconFileCode,
  IconFileDelimited,
  IconFileDocument,
  IconFileExcel,
  IconFileImage,
  IconFileMusic,
  IconFilePdf,
  IconFilePowerPoint,
  IconFileQuestion,
  IconFileVideo,
  IconFolder,
  IconFormatFont,
  IconGrid2X2,
  IconList,
  IconMoreHorizontal,
  IconSettings,
  IconSquareArrowOutUpRight,
  IconTrash,
  IconUpload,
} from "@/data/icons"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import {
  FILE_CAPTURE_WINDOW_LABEL,
  getFileExtensionFromPath,
  getFileKindFromPath,
  getFileNameFromPath,
  normalizeDroppedPaths,
  publishDroppedPaths,
  resolveMimeTypeForUpload,
  type FileCaptureFileKind,
} from "@/modules/fileCapture"
import { useAuthStore } from "@/stores/authStore"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { type WorkspaceNodeScope } from "@/types/nodes"
import { can, Capabilities } from "@/types/permissions"
import { NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES } from "@/utils/firebase/firebase-node-attachments"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"
import { readFile, stat } from "@tauri-apps/plugin-fs"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { useMediaQuery } from "@vueuse/core"
import { storeToRefs } from "pinia"
import type { Component } from "vue"

const { t } = useI18n()
const { currentTeam } = useTeamActions()
const { currentWorkspace } = useWorkspaceActions()
const authStore = useAuthStore()
const membershipStore = useMembershipStore()
const fileTreeStore = useFileTreeStore()
const { currentUser } = storeToRefs(authStore)
const { memberships } = storeToRefs(membershipStore)
const currentWindow = getCurrentTauriWindow()
const isCaptureWindow = currentWindow?.label === FILE_CAPTURE_WINDOW_LABEL
const overlaySidebarOpen = ref(true)
const overlaySidebarOpenMobile = ref(false)
const overlaySidebarIsMobile = useMediaQuery("(max-width: 768px)")
const existingSidebarContext = useSidebar(null)

// FileDropOverlay can render outside the app shell, so it needs its own
// sidebar context for the file tree sheet in layoutless windows.
if (!existingSidebarContext) {
  provideSidebarContext({
    state: computed(() =>
      overlaySidebarOpen.value ? "expanded" : "collapsed"
    ),
    open: overlaySidebarOpen,
    setOpen: (value: boolean) => {
      overlaySidebarOpen.value = value
    },
    isMobile: overlaySidebarIsMobile,
    openMobile: overlaySidebarOpenMobile,
    setOpenMobile: (value: boolean) => {
      overlaySidebarOpenMobile.value = value
    },
    toggleSidebar: () => {
      overlaySidebarOpen.value = !overlaySidebarOpen.value
    },
  })
}

const isVisible = ref(false)
const hasActiveFileDrag = ref(false)
const queuedFiles = ref<QueuedFile[]>([])
const imagePreviewFailures = ref<Record<string, boolean>>({})
const saveSheetOpen = ref(false)
const activeSaveScope = ref<WorkspaceNodeScope>("code")
const saveSheetTargetIds = reactive<Record<WorkspaceNodeScope, string | null>>({
  code: null,
  write: null,
})
const isMoving = ref(false)
const hasQueuedFiles = computed(() => queuedFiles.value.length > 0)
const shouldRender = computed(
  () =>
    isCaptureWindow ||
    isVisible.value ||
    hasActiveFileDrag.value ||
    hasQueuedFiles.value
)

type FileListLayout = "list" | "grid"
type QueuedFileSource = "tauri" | "browser"
type QueuedFile = {
  id: string
  source: QueuedFileSource
  path: string | null
  file: File | null
  objectUrl: string | null
  isDirectory: boolean
}
type DroppedFileItem = {
  id: string
  path: string | null
  name: string
  description: string
  extension: string
  kind: FileCaptureFileKind
  isImage: boolean
  previewSrc: string | null
  openTarget: string | null
  source: QueuedFileSource
  icon: Component
}

const fileKindIcons: Record<FileCaptureFileKind, Component> = {
  image: IconFileImage,
  pdf: IconFilePdf,
  document: IconFileDocument,
  spreadsheet: IconFileExcel,
  delimited: IconFileDelimited,
  presentation: IconFilePowerPoint,
  code: IconFileCode,
  archive: IconArchive,
  audio: IconFileMusic,
  video: IconFileVideo,
  font: IconFormatFont,
  folder: IconFolder,
  unknown: IconFileQuestion,
}

const fileListLayout = ref<FileListLayout>("list")
const isGridLayout = computed(() => fileListLayout.value === "grid")
const revealFileLocationLabel = computed(() =>
  t(
    platform.value === "macos"
      ? "components.fileDropOverlay.locations.finder"
      : "components.fileDropOverlay.locations.explorer"
  )
)
const revealFileTooltip = computed(() =>
  t("components.fileDropOverlay.tooltips.revealFile", {
    location: revealFileLocationLabel.value,
  })
)
const currentTeamId = computed(() => currentTeam.value?.id ?? null)
const currentWorkspaceId = computed(() => currentWorkspace.value?.id ?? null)
const currentRole = computed(() => {
  if (!currentTeamId.value || !currentUser.value) return null

  return (
    memberships.value.find(
      (membership) =>
        membership.teamId === currentTeamId.value &&
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
const activeSaveTargetNodeId = computed(
  () => saveSheetTargetIds[activeSaveScope.value]
)
const activeSaveTargetNode = computed(() => {
  if (
    !currentTeamId.value ||
    !currentWorkspaceId.value ||
    !activeSaveTargetNodeId.value
  ) {
    return null
  }

  return fileTreeStore.getNode(
    activeSaveScope.value,
    currentTeamId.value,
    currentWorkspaceId.value,
    activeSaveTargetNodeId.value
  )
})
const activeSaveTargetPath = computed(() => {
  if (
    !currentTeamId.value ||
    !currentWorkspaceId.value ||
    !activeSaveTargetNode.value
  ) {
    return ""
  }

  return fileTreeStore.getFolderPath(
    activeSaveScope.value,
    currentTeamId.value,
    currentWorkspaceId.value,
    activeSaveTargetNode.value.id
  )
})
const saveSheetStatusMessage = computed(() => {
  if (!currentTeam.value) {
    return t("components.fileDropOverlay.saveSheet.noTeam")
  }
  if (!currentWorkspace.value) {
    return t("components.fileDropOverlay.saveSheet.noWorkspace")
  }
  if (!canManageAttachments.value) {
    return t("components.fileDropOverlay.saveSheet.readOnly")
  }
  if (activeSaveTargetNode.value?.isArchived) {
    return t("components.fileDropOverlay.saveSheet.archivedTarget")
  }
  if (activeSaveTargetPath.value) {
    return t("components.fileDropOverlay.saveSheet.selectedTarget", {
      path: activeSaveTargetPath.value,
    })
  }
  return t("components.fileDropOverlay.saveSheet.noSelection")
})
const canMoveQueuedFiles = computed(
  () =>
    hasQueuedFiles.value &&
    Boolean(currentTeamId.value) &&
    Boolean(currentWorkspaceId.value) &&
    Boolean(activeSaveTargetNode.value) &&
    !activeSaveTargetNode.value?.isArchived &&
    canManageAttachments.value &&
    !isMoving.value
)

const formatFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`

  const units = ["KB", "MB", "GB", "TB"]
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

const getBrowserFileId = (file: File): string =>
  [file.name, file.size, file.lastModified].join(":")

const getBrowserFilePath = (file: File): string | null => {
  const path = (file as File & { path?: unknown }).path
  return typeof path === "string" && path.trim() ? path.trim() : null
}

const getQueuedFileName = (queuedFile: QueuedFile): string =>
  queuedFile.source === "tauri" && queuedFile.path
    ? getFileNameFromPath(queuedFile.path)
    : queuedFile.file?.name || queuedFile.path || queuedFile.id

const getQueuedFileDescription = (queuedFile: QueuedFile): string => {
  if (queuedFile.source === "tauri" && queuedFile.path) {
    return queuedFile.path
  }

  if (!queuedFile.file) {
    return queuedFile.id
  }

  const segments = [formatFileSize(queuedFile.file.size), queuedFile.file.type]
    .map((segment) => segment?.trim())
    .filter(Boolean)

  return segments.join(" - ") || queuedFile.file.name
}

const revokeQueuedFileObjectUrl = (queuedFile: QueuedFile) => {
  if (queuedFile.source !== "browser" || !queuedFile.objectUrl) return

  URL.revokeObjectURL(queuedFile.objectUrl)
}

const createQueuedPathFiles = (paths: string[]): QueuedFile[] =>
  normalizeDroppedPaths(paths).map((path) => ({
    id: path,
    source: "tauri",
    path,
    file: null,
    objectUrl: null,
    isDirectory: false,
  }))

const createQueuedBrowserFiles = (files: File[]): QueuedFile[] =>
  files.map((file) => {
    const path = getBrowserFilePath(file)

    if (path) {
      return {
        id: path,
        source: "tauri",
        path,
        file: null,
        objectUrl: null,
        isDirectory: false,
      }
    }

    return {
      id: getBrowserFileId(file),
      source: "browser",
      path: null,
      file,
      objectUrl: URL.createObjectURL(file),
      isDirectory: false,
    }
  })

const resolveDirectoryFlags = async (files: QueuedFile[]): Promise<void> => {
  if (!isTauri.value) return

  await Promise.all(
    files.map(async (queuedFile) => {
      if (queuedFile.source !== "tauri" || !queuedFile.path) return

      try {
        const fileInfo = await stat(queuedFile.path)
        queuedFile.isDirectory = fileInfo.isDirectory
      } catch {
        // Leave as false if stat fails
      }
    })
  )
}

const mergeQueuedFiles = (
  currentFiles: QueuedFile[],
  nextFiles: QueuedFile[]
): QueuedFile[] => {
  const mergedFiles = [...currentFiles]
  const existingIds = new Set(currentFiles.map(({ id }) => id))

  nextFiles.forEach((queuedFile) => {
    if (existingIds.has(queuedFile.id)) {
      revokeQueuedFileObjectUrl(queuedFile)
      return
    }

    existingIds.add(queuedFile.id)
    mergedFiles.push(queuedFile)
  })

  return mergedFiles
}

const droppedFileItems = computed<DroppedFileItem[]>(() =>
  queuedFiles.value.map((queuedFile) => {
    const name = getQueuedFileName(queuedFile)
    const path = queuedFile.path
    const kind = queuedFile.isDirectory
      ? "folder"
      : getFileKindFromPath(path || name)
    const isImage = kind === "image"

    return {
      id: queuedFile.id,
      path,
      name,
      description: getQueuedFileDescription(queuedFile),
      extension: getFileExtensionFromPath(path || name),
      kind,
      isImage,
      previewSrc:
        queuedFile.source === "tauri" && path && isTauri.value && isImage
          ? convertFileSrc(path)
          : isImage
            ? queuedFile.objectUrl
            : null,
      openTarget: queuedFile.source === "browser" ? queuedFile.objectUrl : null,
      source: queuedFile.source,
      icon: fileKindIcons[kind],
    }
  })
)

let unlistenDragDrop: UnlistenFn | null = null
let unlistenCloseRequested: UnlistenFn | null = null
const {
  files: selectedBrowserFiles,
  open: openBrowserFileDialog,
  reset: resetBrowserFileDialog,
} = useFileDialog({
  multiple: true,
})
const hasDraggedFiles = (
  dataTransfer: DataTransfer | null | undefined
): boolean => {
  if (!dataTransfer) return false

  if (dataTransfer.files.length > 0) {
    return true
  }

  if (
    Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file")
  ) {
    return true
  }

  const dragTypes = new Set(
    Array.from(dataTransfer.types ?? [], (type) => type.toLowerCase())
  )

  return (
    dragTypes.has("files") ||
    dragTypes.has("public.file-url") ||
    dragTypes.has("application/x-moz-file") ||
    dragTypes.has("text/uri-list")
  )
}
const browserDragTargets = new Set<EventTarget>()
const browserDragDocumentTarget = computed<Document | null>(() =>
  isCaptureWindow || typeof document === "undefined" ? null : document
)
const browserDragWindowTarget = computed<Window | null>(() =>
  isCaptureWindow || typeof window === "undefined" ? null : window
)

const clearBrowserDragState = () => {
  browserDragTargets.clear()
  hasActiveFileDrag.value = false
}

const shouldHandleBrowserFileDragEvent = (event: DragEvent) =>
  hasActiveFileDrag.value || hasDraggedFiles(event.dataTransfer)

const stopHandledBrowserFileDragEvent = (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

const handleBrowserDragEnter = (event: DragEvent) => {
  if (!shouldHandleBrowserFileDragEvent(event)) return

  stopHandledBrowserFileDragEvent(event)

  if (event.target) {
    browserDragTargets.add(event.target)
  }

  hasActiveFileDrag.value = true
}

const handleBrowserDragOver = (event: DragEvent) => {
  if (!shouldHandleBrowserFileDragEvent(event)) return

  stopHandledBrowserFileDragEvent(event)

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy"
  }

  if (event.target) {
    browserDragTargets.add(event.target)
  }

  hasActiveFileDrag.value = true
}

const handleBrowserDragLeave = (event: DragEvent) => {
  if (!shouldHandleBrowserFileDragEvent(event)) return

  event.stopPropagation()

  if (event.target) {
    browserDragTargets.delete(event.target)
  }

  if (browserDragTargets.size === 0) {
    hasActiveFileDrag.value = false
  }
}

const handleBrowserDrop = (event: DragEvent) => {
  if (!shouldHandleBrowserFileDragEvent(event)) return

  stopHandledBrowserFileDragEvent(event)
  clearBrowserDragState()

  const files = Array.from(event.dataTransfer?.files ?? [])
  if (!files.length) return

  void addDroppedBrowserFiles(files)
}

const handleBrowserDragEnd = () => {
  clearBrowserDragState()
}

useEventListener(
  browserDragDocumentTarget,
  "dragenter",
  handleBrowserDragEnter,
  {
    capture: true,
  }
)
useEventListener(browserDragDocumentTarget, "dragover", handleBrowserDragOver, {
  capture: true,
})
useEventListener(
  browserDragDocumentTarget,
  "dragleave",
  handleBrowserDragLeave,
  {
    capture: true,
  }
)
useEventListener(browserDragDocumentTarget, "drop", handleBrowserDrop, {
  capture: true,
})
useEventListener(browserDragDocumentTarget, "dragend", handleBrowserDragEnd, {
  capture: true,
})
useEventListener(browserDragWindowTarget, "blur", handleBrowserDragEnd)

const updateFileListLayout = (value: unknown) => {
  if (value === "list" || value === "grid") {
    fileListLayout.value = value
  }
}

const applyQueuedFiles = (
  files: QueuedFile[],
  options: { keepOverlayOpen?: boolean } = {}
): QueuedFile[] => {
  queuedFiles.value = files

  if (files.length > 0 || options.keepOverlayOpen) {
    isVisible.value = true
  }

  return files
}

const syncImagePreviewFailures = (files: QueuedFile[]) => {
  const queuedFileIds = new Set(files.map(({ id }) => id))

  imagePreviewFailures.value = Object.fromEntries(
    Object.entries(imagePreviewFailures.value).filter(([id]) =>
      queuedFileIds.has(id)
    )
  )
}

const resetOverlay = () => {
  hasActiveFileDrag.value = false
  isVisible.value = false
  imagePreviewFailures.value = {}
}

const keepCaptureWindowOpen = async () => {
  await invoke("keep_file_capture_window_open")
}

const dismissCaptureWindow = async () => {
  await invoke("dismiss_file_capture_window")
}

const syncQueuedFiles = async (
  files: QueuedFile[],
  options: {
    keepCaptureWindowOpen?: boolean
    keepOverlayOpen?: boolean
  } = {}
): Promise<QueuedFile[]> => {
  const currentFiles = queuedFiles.value
  const updatedFiles = applyQueuedFiles(files, {
    keepOverlayOpen: options.keepOverlayOpen,
  })
  const updatedIds = new Set(updatedFiles.map(({ id }) => id))

  currentFiles.forEach((queuedFile) => {
    if (!updatedIds.has(queuedFile.id)) {
      revokeQueuedFileObjectUrl(queuedFile)
    }
  })

  syncImagePreviewFailures(updatedFiles)

  if (isCaptureWindow) {
    if (options.keepCaptureWindowOpen && updatedFiles.length) {
      await keepCaptureWindowOpen()
    }
    return updatedFiles
  }

  if (isTauri.value) {
    publishDroppedPaths(
      updatedFiles.flatMap(({ path }) => (path ? [path] : []))
    )
  }

  return updatedFiles
}

const resetSaveSheetState = () => {
  saveSheetTargetIds.code = null
  saveSheetTargetIds.write = null
}

const seedSaveSheetTargets = () => {
  if (!currentTeamId.value || !currentWorkspaceId.value) {
    resetSaveSheetState()
    return
  }

  ;(["code", "write"] as const).forEach((scope) => {
    const selectedNodeId = fileTreeStore.getSelectedNodeId(
      scope,
      currentTeamId.value!,
      currentWorkspaceId.value!
    )

    saveSheetTargetIds[scope] = selectedNodeId

    if (selectedNodeId) {
      void fileTreeStore.ensureNodeLoaded(
        scope,
        currentTeamId.value!,
        currentWorkspaceId.value!,
        selectedNodeId
      )
    }
  })
}

const handleSaveSheetOpenChange = (open: boolean) => {
  if (!open) {
    if (isMoving.value) return
    saveSheetOpen.value = false
    resetSaveSheetState()
    return
  }

  seedSaveSheetTargets()
  saveSheetOpen.value = true
}

const openSaveSheet = () => {
  if (!hasQueuedFiles.value || isMoving.value) return
  handleSaveSheetOpenChange(true)
}

const handleSaveTargetSelect = (
  scope: WorkspaceNodeScope,
  node: { id: string }
) => {
  saveSheetTargetIds[scope] = node.id
}

const updateActiveSaveScope = (value: string | number) => {
  if (value === "code" || value === "write") {
    activeSaveScope.value = value
  }
}

const createSaveContext = (): AttachmentMutationContext => {
  if (!currentTeamId.value) {
    throw new Error(t("components.fileDropOverlay.saveSheet.noTeam"))
  }
  if (!currentWorkspaceId.value) {
    throw new Error(t("components.fileDropOverlay.saveSheet.noWorkspace"))
  }
  if (!activeSaveTargetNode.value) {
    throw new Error(t("components.fileDropOverlay.saveSheet.noSelection"))
  }
  if (activeSaveTargetNode.value.isArchived) {
    throw new Error(t("components.fileDropOverlay.saveSheet.archivedTarget"))
  }
  if (!canManageAttachments.value) {
    throw new Error(t("components.fileDropOverlay.saveSheet.readOnly"))
  }

  return {
    teamId: currentTeamId.value,
    workspaceId: currentWorkspaceId.value,
    scope: activeSaveScope.value,
    nodeId: activeSaveTargetNode.value.id,
  }
}

const materializeQueuedFileForUpload = async (
  queuedFile: QueuedFile
): Promise<File> => {
  if (queuedFile.file) {
    return queuedFile.file
  }

  if (!queuedFile.path) {
    throw new Error(
      t("components.fileDropOverlay.saveSheet.unavailableFile", {
        name: getQueuedFileName(queuedFile),
      })
    )
  }

  if (!isTauri.value) {
    throw new Error(
      t("components.fileDropOverlay.saveSheet.desktopOnly", {
        name: getQueuedFileName(queuedFile),
      })
    )
  }

  const fileInfo = await stat(queuedFile.path)

  if (!fileInfo.isFile) {
    throw new Error(
      t("components.fileDropOverlay.saveSheet.folderNotSupported", {
        name: getQueuedFileName(queuedFile),
      })
    )
  }

  if (fileInfo.size > NODE_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
    throw new Error("Each attachment must be 25 MB or smaller.")
  }

  const bytes = await readFile(queuedFile.path)
  const mimeType =
    resolveMimeTypeForUpload({
      fileName: getFileNameFromPath(queuedFile.path),
    }) ?? "application/octet-stream"

  return new File([bytes], getFileNameFromPath(queuedFile.path), {
    lastModified: fileInfo.mtime?.getTime() ?? Date.now(),
    type: mimeType,
  })
}

const moveQueuedFilesToSelectedNode = async () => {
  if (!canMoveQueuedFiles.value || isMoving.value) return

  const filesToProcess = [...queuedFiles.value]
  let context: AttachmentMutationContext

  try {
    context = createSaveContext()
  } catch (error) {
    showErrorToast(
      t("components.fileDropOverlay.saveSheet.moveFailed"),
      (error as Error).message
    )
    return
  }

  isMoving.value = true

  let successCount = 0
  let failureCount = 0
  let firstFailureMessage: string | null = null
  const failedFiles: QueuedFile[] = []

  try {
    for (const queuedFile of filesToProcess) {
      try {
        const uploadFile = await materializeQueuedFileForUpload(queuedFile)
        await createWorkspaceNodeAttachmentFromFile(uploadFile, context)
        successCount += 1
      } catch (error) {
        failureCount += 1
        failedFiles.push(queuedFile)
        firstFailureMessage ??= (error as Error).message
      }
    }

    await syncQueuedFiles(failedFiles, {
      keepCaptureWindowOpen: isCaptureWindow,
      keepOverlayOpen: true,
    })

    if (successCount > 0) {
      showSuccessToast(
        successCount === 1
          ? t("components.fileDropOverlay.saveSheet.success.single")
          : t("components.fileDropOverlay.saveSheet.success.multiple", {
              count: successCount,
            })
      )
    }

    if (failureCount > 0) {
      showErrorToast(
        failureCount === 1
          ? t("components.fileDropOverlay.saveSheet.partialFailure.single")
          : t("components.fileDropOverlay.saveSheet.partialFailure.multiple", {
              count: failureCount,
            }),
        firstFailureMessage || undefined
      )
      return
    }

    saveSheetOpen.value = false
    resetSaveSheetState()
  } finally {
    isMoving.value = false
  }
}

const addDroppedPaths = async (
  paths: string[],
  options: {
    keepCaptureWindowOpen?: boolean
    keepOverlayOpen?: boolean
  } = {}
) => {
  if (isMoving.value) return queuedFiles.value

  const newFiles = createQueuedPathFiles(paths)
  await resolveDirectoryFlags(newFiles)

  return syncQueuedFiles(mergeQueuedFiles(queuedFiles.value, newFiles), options)
}

const addDroppedBrowserFiles = async (
  files: File[],
  options: { keepOverlayOpen?: boolean } = {}
) => {
  if (isMoving.value) return queuedFiles.value

  const newFiles = createQueuedBrowserFiles(files)
  await resolveDirectoryFlags(newFiles)

  return syncQueuedFiles(mergeQueuedFiles(queuedFiles.value, newFiles), options)
}

const removeQueuedFile = async (id: string) => {
  if (isMoving.value) return queuedFiles.value

  return syncQueuedFiles(
    queuedFiles.value.filter((queuedFile) => queuedFile.id !== id),
    {
      keepOverlayOpen: true,
    }
  )
}

const clearQueuedFiles = async () => {
  if (isMoving.value) return queuedFiles.value

  return syncQueuedFiles([], {
    keepOverlayOpen: true,
  })
}

const handleImagePreviewError = (id: string) => {
  if (imagePreviewFailures.value[id]) return

  imagePreviewFailures.value = {
    ...imagePreviewFailures.value,
    [id]: true,
  }
}

const selectFiles = async () => {
  if (isMoving.value) return

  if (!isTauri.value) {
    openBrowserFileDialog()
    return
  }

  const selection = await open({
    multiple: true,
  })

  if (!selection) return

  const selectedPaths = Array.isArray(selection) ? selection : [selection]

  await addDroppedPaths(selectedPaths, {
    keepCaptureWindowOpen: isCaptureWindow,
  })
}

const previewFile = async (file: DroppedFileItem) => {
  if (file.source === "browser") {
    if (!file.openTarget || typeof window === "undefined") return

    window.open(file.openTarget, "_blank", "noopener,noreferrer")
    return
  }

  if (!isTauri.value || !file.path) return

  try {
    await invoke("preview_file_path", { path: file.path })
  } catch (error) {
    showErrorToast(
      t("components.fileDropOverlay.errors.previewFile"),
      (error as Error).message
    )
  }
}

const revealFile = async (file: DroppedFileItem) => {
  if (!isTauri.value || file.source !== "tauri" || !file.path) return

  try {
    await revealItemInDir(file.path)
  } catch (error) {
    showErrorToast(
      t("components.fileDropOverlay.errors.revealFile", {
        location: revealFileLocationLabel.value,
      }),
      (error as Error).message
    )
  }
}

const closeOverlayOrWindow = async () => {
  if (isMoving.value) return

  await clearQueuedFiles()
  resetOverlay()

  if (isCaptureWindow) {
    await dismissCaptureWindow()
  }
}

watch(selectedBrowserFiles, async (files) => {
  const nextFiles = Array.from(files ?? [])

  if (!nextFiles.length) return

  await addDroppedBrowserFiles(nextFiles)
  resetBrowserFileDialog()
})

watch([currentTeamId, currentWorkspaceId], () => {
  if (!saveSheetOpen.value) return
  seedSaveSheetTargets()
})

onMounted(async () => {
  if (!currentWindow) return

  if (isCaptureWindow) {
    unlistenCloseRequested = await currentWindow.onCloseRequested(() => {
      void clearQueuedFiles()
    })

    unlistenDragDrop = await currentWindow.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        hasActiveFileDrag.value = false
        void addDroppedPaths(event.payload.paths, {
          keepCaptureWindowOpen: true,
        })
      }
    })
  }
})

onBeforeUnmount(() => {
  clearBrowserDragState()
  isVisible.value = false
  queuedFiles.value.forEach(revokeQueuedFileObjectUrl)

  if (unlistenDragDrop) {
    unlistenDragDrop()
    unlistenDragDrop = null
  }

  if (unlistenCloseRequested) {
    unlistenCloseRequested()
    unlistenCloseRequested = null
  }
})

const isFullscreen = useIsFullscreen()
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-in-out"
    leave-active-class="transition duration-200 ease-in-out"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="shouldRender"
      data-tauri-drag-region
      class="bg-background/50 fixed inset-0 isolate z-50 flex flex-col gap-2 p-2 backdrop-blur-lg"
    >
      <div
        data-tauri-drag-region
        :class="{ 'pl-20': isTauri && !isFullscreen }"
        class="flex items-start justify-between gap-2"
      >
        <TooltipProvider>
          <ToggleGroup
            type="single"
            size="sm"
            :model-value="fileListLayout"
            @update:model-value="updateFileListLayout"
          >
            <Tooltip>
              <TooltipTrigger as-child>
                <ToggleGroupItem
                  value="list"
                  variant="outline"
                  size="sm"
                  :class="[
                    'aspect-square',
                    fileListLayout === 'list'
                      ? 'bg-background text-foreground hover:bg-background'
                      : 'bg-secondary',
                  ]"
                >
                  <IconList />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                {{ t("components.fileDropOverlay.tooltips.listView") }}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <ToggleGroupItem
                  value="grid"
                  variant="outline"
                  size="sm"
                  :class="[
                    'aspect-square',
                    fileListLayout === 'grid'
                      ? 'bg-background text-foreground hover:bg-background'
                      : 'bg-secondary',
                  ]"
                >
                  <IconGrid2X2 />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                {{ t("components.fileDropOverlay.tooltips.gridView") }}
              </TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </TooltipProvider>
        <ButtonGroup>
          <ButtonGroup>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    :disabled="isMoving"
                    @click="selectFiles()"
                  >
                    <IconUpload />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {{ t("components.fileDropOverlay.tooltips.uploadFiles") }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </ButtonGroup>
          <ButtonGroup>
            <Sheet
              :open="saveSheetOpen"
              @update:open="handleSaveSheetOpenChange"
            >
              <Button
                size="sm"
                :disabled="!hasQueuedFiles || isMoving"
                @click="openSaveSheet"
              >
                {{ t("components.fileDropOverlay.buttons.save") }}
              </Button>
              <SheetContent
                class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+var(--spacing)*2)] h-auto gap-0 overflow-clip rounded border"
                :class="{ 'mt-12': isTauri && !isFullscreen }"
              >
                <SheetHeader>
                  <SheetTitle>
                    {{ t("components.fileDropOverlay.saveSheet.title") }}
                  </SheetTitle>
                  <SheetDescription>
                    {{ t("components.fileDropOverlay.saveSheet.description") }}
                  </SheetDescription>
                </SheetHeader>
                <OverlayScrollbarsWrapper>
                  <TeamSelector v-if="!currentTeamId" />
                  <WorkspaceSelector v-else-if="!currentWorkspaceId" />
                  <Tabs
                    v-else
                    class="gap-0"
                    :model-value="activeSaveScope"
                    @update:model-value="updateActiveSaveScope"
                  >
                    <TabsList class="m-2 bg-transparent">
                      <TabsTrigger value="code">
                        {{
                          t("components.fileDropOverlay.saveSheet.tabs.code")
                        }}
                      </TabsTrigger>
                      <TabsTrigger value="write">
                        {{
                          t("components.fileDropOverlay.saveSheet.tabs.write")
                        }}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="code">
                      <Sidebar collapsible="none" class="w-full">
                        <SidebarContent>
                          <OverlayScrollbarsWrapper>
                            <FileTree
                              :scope="'code'"
                              :team-id="currentTeamId"
                              :workspace-id="currentWorkspaceId"
                              :selected-node-id="saveSheetTargetIds.code"
                              @select="handleSaveTargetSelect('code', $event)"
                            />
                          </OverlayScrollbarsWrapper>
                        </SidebarContent>
                      </Sidebar>
                    </TabsContent>
                    <TabsContent value="write">
                      <Sidebar collapsible="none" class="w-full">
                        <SidebarContent>
                          <OverlayScrollbarsWrapper>
                            <FileTree
                              :scope="'write'"
                              :team-id="currentTeamId"
                              :workspace-id="currentWorkspaceId"
                              :selected-node-id="saveSheetTargetIds.write"
                              @select="handleSaveTargetSelect('write', $event)"
                            />
                          </OverlayScrollbarsWrapper>
                        </SidebarContent>
                      </Sidebar>
                    </TabsContent>
                  </Tabs>
                  <div
                    class="text-muted-foreground p-4 text-xs"
                    :class="{
                      'text-destructive-foreground': !canMoveQueuedFiles,
                    }"
                  >
                    {{ saveSheetStatusMessage }}
                  </div>
                </OverlayScrollbarsWrapper>
                <SheetFooter>
                  <ButtonGroup>
                    <ButtonGroup>
                      <Button
                        class="justify-start"
                        :disabled="!canMoveQueuedFiles"
                        @click="moveQueuedFilesToSelectedNode"
                      >
                        {{
                          isMoving
                            ? t("components.fileDropOverlay.saveSheet.moving")
                            : t(
                                "components.fileDropOverlay.saveSheet.configure"
                              )
                        }}
                      </Button>
                    </ButtonGroup>
                    <ButtonGroup>
                      <Button
                        variant="outline"
                        class="justify-start"
                        :disabled="isMoving"
                        @click="handleSaveSheetOpenChange(false)"
                      >
                        {{ t("actions.cancel") }}
                      </Button>
                    </ButtonGroup>
                  </ButtonGroup>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </ButtonGroup>
        </ButtonGroup>
      </div>
      <OverlayScrollbarsWrapper
        v-if="hasQueuedFiles"
        class="bg-background @container grow rounded-md"
      >
        <ItemGroup v-if="!isGridLayout" class="gap-2 p-2">
          <Item
            v-for="file in droppedFileItems"
            :key="file.id"
            size="sm"
            class="group bg-sidebar w-full gap-2 p-2"
          >
            <ItemMedia
              v-if="
                file.isImage &&
                file.previewSrc &&
                !imagePreviewFailures[file.id]
              "
              variant="image"
            >
              <img
                :src="file.previewSrc"
                :alt="file.name"
                loading="lazy"
                @error="handleImagePreviewError(file.id)"
              />
            </ItemMedia>
            <ItemMedia v-else variant="icon">
              <Component :is="file.icon" />
            </ItemMedia>
            <ItemContent class="gap-0.5 truncate">
              <ItemTitle class="truncate">
                {{ file.name }}
              </ItemTitle>
              <ItemDescription class="line-clamp-1 truncate text-xs">
                {{ file.description }}
              </ItemDescription>
            </ItemContent>
            <ItemActions class="hidden group-hover:flex">
              <TooltipProvider>
                <ButtonGroup>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        :disabled="
                          file.source === 'tauri' ? !isTauri : !file.openTarget
                        "
                        @click="previewFile(file)"
                      >
                        <IconEye />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("components.fileDropOverlay.tooltips.previewFile") }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        :disabled="!isTauri || file.source !== 'tauri'"
                        @click="revealFile(file)"
                      >
                        <IconSquareArrowOutUpRight />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{{ revealFileTooltip }}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        :disabled="isMoving"
                        @click="removeQueuedFile(file.id)"
                      >
                        <IconTrash />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("components.fileDropOverlay.tooltips.removeFile") }}
                    </TooltipContent>
                  </Tooltip>
                </ButtonGroup>
              </TooltipProvider>
            </ItemActions>
          </Item>
        </ItemGroup>
        <ItemGroup
          v-else
          class="grid grid-cols-2 gap-2 p-2 @sm:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5 @6xl:grid-cols-6"
        >
          <Item
            v-for="file in droppedFileItems"
            :key="file.id"
            size="sm"
            class="group bg-sidebar w-full gap-2 p-2"
          >
            <ItemHeader>
              <img
                v-if="
                  file.isImage &&
                  file.previewSrc &&
                  !imagePreviewFailures[file.id]
                "
                :src="file.previewSrc"
                :alt="file.name"
                loading="lazy"
                class="aspect-square size-full rounded object-cover"
                @error="handleImagePreviewError(file.id)"
              />
              <ItemMedia v-else variant="icon" class="aspect-square size-full">
                <Component :is="file.icon" class="size-16" />
              </ItemMedia>
            </ItemHeader>
            <ItemContent class="gap-0.5 truncate">
              <ItemTitle class="truncate">
                {{ file.name }}
              </ItemTitle>
              <ItemDescription class="line-clamp-1 truncate text-xs">
                {{ file.description }}
              </ItemDescription>
            </ItemContent>
            <ItemActions class="hidden group-hover:flex">
              <TooltipProvider>
                <ButtonGroup>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        :disabled="
                          file.source === 'tauri' ? !isTauri : !file.openTarget
                        "
                        @click="previewFile(file)"
                      >
                        <IconEye />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("components.fileDropOverlay.tooltips.previewFile") }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="!(!isTauri || file.source !== 'tauri')">
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        @click="revealFile(file)"
                      >
                        <IconSquareArrowOutUpRight />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{{ revealFileTooltip }}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        :disabled="isMoving"
                        @click="removeQueuedFile(file.id)"
                      >
                        <IconTrash />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("components.fileDropOverlay.tooltips.removeFile") }}
                    </TooltipContent>
                  </Tooltip>
                </ButtonGroup>
              </TooltipProvider>
            </ItemActions>
          </Item>
        </ItemGroup>
      </OverlayScrollbarsWrapper>
      <Empty
        v-else
        class="flex grow border border-dashed"
        @click="!isMoving && selectFiles()"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconUpload />
          </EmptyMedia>
          <EmptyTitle>
            {{ t("components.fileDropOverlay.empty.title") }}
          </EmptyTitle>
          <EmptyDescription>
            {{ t("components.fileDropOverlay.empty.description") }}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent class="w-full max-w-none items-stretch"> </EmptyContent>
      </Empty>
      <div data-tauri-drag-region class="flex justify-between">
        <ButtonGroup>
          <TooltipProvider>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button variant="secondary" size="icon-sm">
                      <IconMoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  {{ t("components.fileDropOverlay.tooltips.more") }}
                </TooltipContent>
                <DropdownMenuContent align="start" side="top" class="w-40">
                  <DropdownMenuItem
                    :disabled="!hasQueuedFiles || isMoving"
                    @click="clearQueuedFiles()"
                  >
                    <IconTrash />
                    {{ t("components.fileDropOverlay.buttons.deleteAll") }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
            <ButtonGroupSeparator />
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="secondary" size="icon-sm">
                  <IconSettings />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {{ t("components.fileDropOverlay.tooltips.settings") }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </ButtonGroup>
        <Button
          variant="secondary"
          size="sm"
          :disabled="isMoving"
          @click="closeOverlayOrWindow"
        >
          {{ t("components.fileDropOverlay.buttons.close") }}
        </Button>
      </div>
    </div>
  </Transition>
</template>

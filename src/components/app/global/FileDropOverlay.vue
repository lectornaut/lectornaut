<script lang="ts" setup>
import {
  getCurrentTauriWindow,
  isTauri,
  platform,
  useIsFullscreen,
} from "@/composables/usePlatform"
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
  IconFormatFont,
  IconGrid2X2,
  IconList,
  IconMoreHorizontal,
  IconSettings,
  IconSquareArrowOutUpRight,
  IconTrash,
  IconUpload,
} from "@/data/icons"
import { showErrorToast } from "@/helpers/toast"
import {
  FILE_CAPTURE_WINDOW_LABEL,
  type FileCaptureFileKind,
  clearDroppedPaths,
  getFileExtensionFromPath,
  getFileKindFromPath,
  getFileNameFromPath,
  mergeDroppedPaths,
  normalizeDroppedPaths,
  publishDroppedPaths,
  removeDroppedPath,
} from "@/modules/fileCapture"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import type { Component } from "vue"

const { t } = useI18n()
const currentWindow = getCurrentTauriWindow()
const isCaptureWindow = currentWindow?.label === FILE_CAPTURE_WINDOW_LABEL
const isVisible = ref(false)
const hasActiveFileDrag = ref(false)
const droppedPaths = ref<string[]>([])
const imagePreviewFailures = ref<Record<string, boolean>>({})
const hasDroppedPaths = computed(() => droppedPaths.value.length > 0)
const shouldRender = computed(
  () =>
    isCaptureWindow ||
    isVisible.value ||
    hasActiveFileDrag.value ||
    hasDroppedPaths.value
)

type FileListLayout = "list" | "grid"
type DroppedFileItem = {
  path: string
  name: string
  extension: string
  kind: FileCaptureFileKind
  isImage: boolean
  previewSrc: string | null
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

const droppedFileItems = computed<DroppedFileItem[]>(() =>
  droppedPaths.value.map((path) => {
    const kind = getFileKindFromPath(path)
    const isImage = kind === "image"

    return {
      path,
      name: getFileNameFromPath(path),
      extension: getFileExtensionFromPath(path),
      kind,
      isImage,
      previewSrc: isTauri.value && isImage ? convertFileSrc(path) : null,
      icon: fileKindIcons[kind],
    }
  })
)

let unlistenDragDrop: UnlistenFn | null = null
let unlistenCloseRequested: UnlistenFn | null = null

const updateFileListLayout = (value: unknown) => {
  if (value === "list" || value === "grid") {
    fileListLayout.value = value
  }
}

const applyDroppedPaths = (
  paths: string[],
  options: { keepOverlayOpen?: boolean } = {}
): string[] => {
  droppedPaths.value = paths

  if (paths.length > 0 || options.keepOverlayOpen) {
    isVisible.value = true
  }

  return paths
}

const syncImagePreviewFailures = (paths: string[]) => {
  imagePreviewFailures.value = Object.fromEntries(
    Object.entries(imagePreviewFailures.value).filter(([path]) =>
      paths.includes(path)
    )
  )
}

const resetOverlay = () => {
  hasActiveFileDrag.value = false
  isVisible.value = false
  droppedPaths.value = []
  imagePreviewFailures.value = {}
}

const keepCaptureWindowOpen = async () => {
  await invoke("keep_file_capture_window_open")
}

const dismissCaptureWindow = async () => {
  await invoke("dismiss_file_capture_window")
}

const syncDroppedPaths = async (
  paths: string[],
  options: {
    keepCaptureWindowOpen?: boolean
    keepOverlayOpen?: boolean
  } = {}
): Promise<string[]> => {
  const updatedPaths = applyDroppedPaths(normalizeDroppedPaths(paths), {
    keepOverlayOpen: options.keepOverlayOpen,
  })
  syncImagePreviewFailures(updatedPaths)

  if (isCaptureWindow) {
    if (options.keepCaptureWindowOpen && updatedPaths.length) {
      await keepCaptureWindowOpen()
    }
    return updatedPaths
  }

  publishDroppedPaths(updatedPaths)

  return updatedPaths
}

const addDroppedPaths = async (
  paths: string[],
  options: {
    keepCaptureWindowOpen?: boolean
    keepOverlayOpen?: boolean
  } = {}
) => syncDroppedPaths(mergeDroppedPaths(droppedPaths.value, paths), options)

const removeQueuedPath = async (path: string) =>
  syncDroppedPaths(removeDroppedPath(droppedPaths.value, path), {
    keepOverlayOpen: true,
  })

const clearQueuedPaths = async () =>
  syncDroppedPaths(clearDroppedPaths(), {
    keepOverlayOpen: true,
  })

const handleImagePreviewError = (path: string) => {
  if (imagePreviewFailures.value[path]) return

  imagePreviewFailures.value = {
    ...imagePreviewFailures.value,
    [path]: true,
  }
}

const selectFiles = async () => {
  if (!isTauri.value) return

  const selection = await open({
    multiple: true,
  })

  if (!selection) return

  const selectedPaths = Array.isArray(selection) ? selection : [selection]

  await addDroppedPaths(selectedPaths, {
    keepCaptureWindowOpen: isCaptureWindow,
  })
}

const previewFile = async (path: string) => {
  if (!isTauri.value) return

  try {
    await invoke("preview_file_path", { path })
  } catch (error) {
    showErrorToast(
      t("components.fileDropOverlay.errors.previewFile"),
      (error as Error).message
    )
  }
}

const revealFile = async (path: string) => {
  if (!isTauri.value) return

  try {
    await revealItemInDir(path)
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
  await clearQueuedPaths()
  resetOverlay()

  if (isCaptureWindow) {
    await dismissCaptureWindow()
  }
}

onMounted(async () => {
  if (!currentWindow) return

  if (isCaptureWindow) {
    unlistenCloseRequested = await currentWindow.onCloseRequested(() => {
      clearQueuedPaths()
    })
  }

  unlistenDragDrop = await currentWindow.onDragDropEvent((event) => {
    if (isCaptureWindow) {
      if (event.payload.type === "drop") {
        addDroppedPaths(event.payload.paths, {
          keepCaptureWindowOpen: true,
        })
      }

      return
    }

    switch (event.payload.type) {
      case "enter":
        hasActiveFileDrag.value = event.payload.paths.length > 0
        break
      case "over":
        break
      case "leave":
        hasActiveFileDrag.value = false
        break
      case "drop":
        hasActiveFileDrag.value = false
        addDroppedPaths(event.payload.paths)
        break
    }
  })
})

onBeforeUnmount(() => {
  hasActiveFileDrag.value = false
  isVisible.value = false

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
                    fileListLayout === 'list' &&
                      'bg-accent text-accent-foreground',
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
                    fileListLayout === 'grid' &&
                      'bg-accent text-accent-foreground',
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
                    :disabled="!isTauri"
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
            <Button size="sm" :disabled="!hasDroppedPaths">
              {{ t("components.fileDropOverlay.buttons.save") }}
            </Button>
          </ButtonGroup>
        </ButtonGroup>
      </div>
      <OverlayScrollbarsWrapper
        v-if="hasDroppedPaths"
        class="bg-secondary @container grow rounded-md"
      >
        <ItemGroup v-if="!isGridLayout" class="gap-2 p-2">
          <Item
            v-for="file in droppedFileItems"
            :key="file.path"
            variant="muted"
            size="sm"
            class="group w-full gap-2 p-2"
          >
            <ItemMedia
              v-if="
                file.isImage &&
                file.previewSrc &&
                !imagePreviewFailures[file.path]
              "
              variant="image"
            >
              <img
                :src="file.previewSrc"
                :alt="file.name"
                loading="lazy"
                @error="handleImagePreviewError(file.path)"
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
                {{ file.path }}
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
                        :disabled="!isTauri"
                        @click="previewFile(file.path)"
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
                        :disabled="!isTauri"
                        @click="revealFile(file.path)"
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
                        @click="removeQueuedPath(file.path)"
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
            :key="file.path"
            variant="muted"
            size="sm"
            class="group w-full gap-2 p-2"
          >
            <ItemHeader>
              <img
                v-if="
                  file.isImage &&
                  file.previewSrc &&
                  !imagePreviewFailures[file.path]
                "
                :src="file.previewSrc"
                :alt="file.name"
                loading="lazy"
                class="aspect-square size-full rounded object-cover"
                @error="handleImagePreviewError(file.path)"
              />
              <ItemMedia v-else variant="icon" class="aspect-square size-full">
                <Component :is="file.icon" />
              </ItemMedia>
            </ItemHeader>
            <ItemContent class="gap-0.5 truncate">
              <ItemTitle class="truncate">
                {{ file.name }}
              </ItemTitle>
              <ItemDescription class="line-clamp-1 truncate text-xs">
                {{ file.path }}
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
                        :disabled="!isTauri"
                        @click="previewFile(file.path)"
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
                        :disabled="!isTauri"
                        @click="revealFile(file.path)"
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
                        @click="removeQueuedPath(file.path)"
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
        @click="selectFiles()"
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
                    :disabled="!hasDroppedPaths"
                    @click="clearQueuedPaths()"
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
        <Button variant="secondary" size="sm" @click="closeOverlayOrWindow">
          {{ t("components.fileDropOverlay.buttons.close") }}
        </Button>
      </div>
    </div>
  </Transition>
</template>

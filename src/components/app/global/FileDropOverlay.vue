<script lang="ts" setup>
import { IconFile, IconUpload, IconX } from "@/data/icons"
import {
  FILE_CAPTURE_WINDOW_LABEL,
  normalizeDroppedPaths,
  publishDroppedPaths,
} from "@/modules/fileCapture"
import { invoke } from "@tauri-apps/api/core"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

const currentWindow = getCurrentWindow()
const isCaptureWindow = currentWindow.label === FILE_CAPTURE_WINDOW_LABEL
const isMainWindow = currentWindow.label === "main"
const isVisible = ref(false)
const hasActiveFileDrag = ref(false)
const droppedPaths = ref<string[]>([])
const hasDroppedPaths = computed(() => droppedPaths.value.length > 0)
const shouldRender = computed(
  () => isCaptureWindow || isVisible.value || hasDroppedPaths.value
)
const droppedFilesTitle = computed(() => {
  if (!hasDroppedPaths.value) return "Drop files here"

  return droppedPaths.value.length === 1
    ? "1 file ready"
    : `${droppedPaths.value.length} files ready`
})
const droppedFilesDescription = computed(() => {
  if (!hasDroppedPaths.value) {
    return "Release to hand file paths back to Lectornaut."
  }

  return "Review the files below. Drop another set to replace this list."
})
const closeButtonLabel = computed(() =>
  isCaptureWindow ? "Close window" : "Close overlay"
)

let unlistenDragDrop: UnlistenFn | null = null
let unlistenNativeDrop: UnlistenFn | null = null
let unlistenCloseRequested: UnlistenFn | null = null

const getFileName = (path: string): string => {
  const segments = path.split(/[/\\]/)
  return segments.at(-1) || path
}

const updateDroppedPaths = (paths: string[]): string[] => {
  const normalized = normalizeDroppedPaths(paths)

  if (!normalized.length) return normalized

  droppedPaths.value = normalized
  isVisible.value = true

  return normalized
}

const resetOverlay = () => {
  hasActiveFileDrag.value = false
  isVisible.value = false
  droppedPaths.value = []
}

const forwardDroppedPathsToMain = async (paths: string[]) => {
  await currentWindow.emitTo("main", "native-file-capture:dropped", paths)
}

const keepCaptureWindowOpen = async () => {
  await invoke("keep_file_capture_window_open")
}

const dismissCaptureWindow = async () => {
  await invoke("dismiss_file_capture_window")
}

const handleCaptureDrop = async (paths: string[]) => {
  const normalized = updateDroppedPaths(paths)

  if (!normalized.length) return

  await keepCaptureWindowOpen()
  await forwardDroppedPathsToMain(normalized)
}

const handleMainDrop = (paths: string[]) => {
  const normalized = updateDroppedPaths(paths)

  if (!normalized.length) {
    isVisible.value = false
    return
  }

  publishDroppedPaths(normalized)
}

const closeOverlayOrWindow = async () => {
  resetOverlay()

  if (isCaptureWindow) {
    await dismissCaptureWindow()
  }
}

onMounted(async () => {
  if (isCaptureWindow) {
    unlistenCloseRequested = await currentWindow.onCloseRequested(() => {
      resetOverlay()
    })
  }

  if (isMainWindow) {
    unlistenNativeDrop = await currentWindow.listen<string[]>(
      "native-file-capture:dropped",
      (event) => {
        publishDroppedPaths(event.payload)
      }
    )
  }

  unlistenDragDrop = await currentWindow.onDragDropEvent((event) => {
    if (isCaptureWindow) {
      if (event.payload.type === "drop") {
        void handleCaptureDrop(event.payload.paths)
      }

      return
    }

    switch (event.payload.type) {
      case "enter":
        hasActiveFileDrag.value = event.payload.paths.length > 0
        isVisible.value = hasActiveFileDrag.value || hasDroppedPaths.value
        break
      case "over":
        if (hasActiveFileDrag.value) {
          isVisible.value = true
        }
        break
      case "leave":
        hasActiveFileDrag.value = false
        if (!hasDroppedPaths.value) {
          isVisible.value = false
        }
        break
      case "drop":
        hasActiveFileDrag.value = false
        handleMainDrop(event.payload.paths)
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

  if (unlistenNativeDrop) {
    unlistenNativeDrop()
    unlistenNativeDrop = null
  }

  if (unlistenCloseRequested) {
    unlistenCloseRequested()
    unlistenCloseRequested = null
  }
})
</script>

<template>
  <div
    v-if="shouldRender"
    data-tauri-drag-region
    class="bg-background/5 fixed inset-0 isolate z-100 grid place-items-center p-2 backdrop-blur-lg"
  >
    <div
      class="bg-background pointer-events-auto relative w-full max-w-lg rounded-lg p-2 shadow-lg"
    >
      <Empty
        class="flex size-full items-center justify-center rounded-xl border border-dashed p-6 sm:p-8"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconUpload />
          </EmptyMedia>
          <EmptyTitle>{{ droppedFilesTitle }}</EmptyTitle>
          <EmptyDescription>
            {{ droppedFilesDescription }}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent
          v-if="hasDroppedPaths"
          class="w-full max-w-none items-stretch gap-3"
        >
          <div
            class="text-muted-foreground flex items-center justify-between text-xs uppercase"
          >
            <span>Received files</span>
            <span>{{ droppedPaths.length }}</span>
          </div>
          <ScrollArea class="max-h-44 rounded-md border">
            <div class="space-y-2 p-3">
              <div
                v-for="path in droppedPaths"
                :key="path"
                class="bg-muted/40 flex items-start gap-3 rounded-md border p-3 text-left"
              >
                <IconFile
                  class="text-muted-foreground mt-0.5 size-4 shrink-0"
                />
                <div class="min-w-0 space-y-1">
                  <p class="truncate text-sm font-medium">
                    {{ getFileName(path) }}
                  </p>
                  <p class="text-muted-foreground font-mono text-xs break-all">
                    {{ path }}
                  </p>
                </div>
              </div>
            </div>
          </ScrollArea>
        </EmptyContent>
        <EmptyContent class="w-full max-w-none items-stretch">
          <Button class="w-full" @click="closeOverlayOrWindow">
            <IconX />
            {{ closeButtonLabel }}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  </div>
</template>

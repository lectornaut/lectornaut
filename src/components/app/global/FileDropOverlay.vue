<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  IconFile,
  IconMoreHorizontal,
  IconSettings,
  IconTrash,
  IconTrash2,
  IconUpload,
} from "@/data/icons"
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
      class="bg-background/50 fixed inset-0 isolate z-100 flex flex-col gap-2 p-2 backdrop-blur-lg"
    >
      <div
        data-tauri-drag-region
        :class="{ 'pl-20': isTauri && !isFullscreen }"
        class="flex justify-end"
      >
        <ButtonGroup>
          <ButtonGroup>
            <Button variant="ghost" size="icon-sm">
              <IconUpload />
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button size="sm" :disabled="!hasDroppedPaths"> Save </Button>
          </ButtonGroup>
        </ButtonGroup>
      </div>
      <OverlayScrollbarsWrapper
        v-if="hasDroppedPaths"
        class="bg-secondary grow rounded-md"
      >
        <ItemGroup class="gap-2 p-2">
          <Item
            v-for="path in droppedPaths"
            :key="path"
            variant="muted"
            size="sm"
            class="group w-full gap-2 p-2"
          >
            <ItemMedia variant="icon">
              <IconFile />
            </ItemMedia>
            <ItemContent class="gap-0.5 truncate">
              <ItemTitle class="truncate">
                {{ getFileName(path) }}
              </ItemTitle>
              <ItemDescription class="line-clamp-1 truncate text-xs">
                {{ path }}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="icon-sm"
                class="hidden group-hover:flex"
              >
                <IconTrash />
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </OverlayScrollbarsWrapper>
      <Empty v-else class="flex grow border border-dashed">
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
        </EmptyContent>
        <EmptyContent class="w-full max-w-none items-stretch"> </EmptyContent>
      </Empty>
      <div data-tauri-drag-region class="flex justify-between">
        <ButtonGroup>
          <Button variant="secondary" size="icon-sm">
            <IconMoreHorizontal />
          </Button>
          <ButtonGroupSeparator />
          <Button variant="secondary" size="icon-sm">
            <IconSettings />
          </Button>
        </ButtonGroup>
        <Button
          :disabled="!hasDroppedPaths"
          variant="secondary"
          size="icon-sm"
          @click="closeOverlayOrWindow"
        >
          <IconTrash2 />
        </Button>
      </div>
    </div>
  </Transition>
</template>

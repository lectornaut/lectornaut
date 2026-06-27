<script lang="ts" setup>
/**
 * DriveFilePicker — in-app "Add from Drive" dialog
 * (docs/connections-google-drive-d3.prompt.md). Browses the member's
 * connected Google Drive through the `listDriveFiles` callable — the
 * deliberate replacement for Google's Picker widget, so OAuth tokens never
 * reach the browser — and imports a picked file via the caller-provided
 * `importFile` (bytes move entirely server-side). Target-agnostic: chat
 * sessions (SessionAttachments) and workspace nodes (NodeAttachments) each
 * pass their own import callable; the picker only knows Drive.
 *
 * Browse model: debounced free-text search over the whole corpus, plus
 * one-level folder drill-in (clicking a folder scopes the list to it; the
 * "All files" chip backs out). Pagination via the API's opaque pageToken.
 * Binding problems (not connected / needs reauth / app disabled) surface as
 * the server's own message in the dialog body — the copy steers the member.
 */
import { listDriveFiles, type DriveFileRow } from "@/composables/useFunctions"
import {
  IconFile,
  IconFileImage,
  IconFilePdf,
  IconFileText,
  IconFolder,
  IconSearch,
  IconX,
} from "@/data/icons"
import { formatAttachmentSize } from "@/helpers/node-attachments"
import type { Component } from "vue"
import { computed, ref, watch } from "vue"

/** What an `importFile` resolves with — surfaced via the `imported` emit. */
interface DriveImportedAttachment {
  attachmentId: string
  displayName: string
}

const props = defineProps<{
  /** Team whose member binding backs the browse; null disables the picker. */
  teamId: string | null
  /**
   * Target-specific import callable (session vs node attachment). Receives the
   * picked file's id plus its Drive display name — the real import callables
   * re-derive the name server-side and ignore the second arg, but the chat
   * "buffer for first message" path uses it to label the pending chip.
   */
  importFile:
    | ((
        fileId: string,
        displayName: string
      ) => Promise<DriveImportedAttachment>)
    | null
}>()

const open = defineModel<boolean>("open", { default: false })

const emit = defineEmits<{
  /** Fired after a successful import with the new attachment's id. */
  imported: [attachmentId: string, displayName: string]
}>()

const search = ref("")
const folder = ref<{ id: string; name: string } | null>(null)
const files = ref<DriveFileRow[]>([])
const nextPageToken = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const listError = ref<string | null>(null)
const importingId = ref<string | null>(null)
const importError = ref<string | null>(null)

const isFolder = (file: DriveFileRow) =>
  file.mimeType === "application/vnd.google-apps.folder"

const rowIcon = (file: DriveFileRow): Component => {
  if (isFolder(file)) return IconFolder
  const mime = file.mimeType.toLowerCase()
  if (mime.startsWith("image/")) return IconFileImage
  if (mime === "application/pdf") return IconFilePdf
  if (
    mime.startsWith("text/") ||
    mime.startsWith("application/vnd.google-apps.")
  ) {
    return IconFileText
  }
  return IconFile
}

const rowMeta = (file: DriveFileRow): string => {
  const parts: string[] = []
  if (file.size !== null) parts.push(formatAttachmentSize(file.size))
  if (file.modifiedTime) {
    const ms = Date.parse(file.modifiedTime)
    if (Number.isFinite(ms)) parts.push(new Date(ms).toLocaleDateString())
  }
  if (file.owner) parts.push(file.owner)
  return parts.join(" · ")
}

async function load(append = false) {
  const teamId = props.teamId
  if (!teamId) return
  if (append && !nextPageToken.value) return
  if (append) loadingMore.value = true
  else loading.value = true
  listError.value = null
  try {
    const { data } = await listDriveFiles({
      teamId,
      ...(search.value.trim() ? { query: search.value.trim() } : {}),
      ...(folder.value ? { folderId: folder.value.id } : {}),
      ...(append && nextPageToken.value
        ? { pageToken: nextPageToken.value }
        : {}),
    })
    files.value = append ? [...files.value, ...data.files] : data.files
    nextPageToken.value = data.nextPageToken
  } catch (error) {
    if (!append) files.value = []
    listError.value = (error as Error).message
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

// Fresh state per open; search re-queries debounced (fullText queries are
// server-clamped, so firing per keystroke-burst is safe).
watch(open, (value) => {
  if (!value) return
  search.value = ""
  folder.value = null
  importError.value = null
  void load()
})
watchDebounced(search, () => open.value && load(), {
  debounce: 350,
  maxWait: 1200,
})

const enterFolder = (file: DriveFileRow) => {
  folder.value = { id: file.id, name: file.name }
  void load()
}
const exitFolder = () => {
  folder.value = null
  void load()
}

const pick = async (file: DriveFileRow) => {
  const importFile = props.importFile
  if (!importFile || importingId.value) return
  if (isFolder(file)) {
    enterFolder(file)
    return
  }
  importingId.value = file.id
  importError.value = null
  try {
    const imported = await importFile(file.id, file.name)
    emit("imported", imported.attachmentId, imported.displayName)
    open.value = false
  } catch (error) {
    importError.value = (error as Error).message
  } finally {
    importingId.value = null
  }
}

const emptyHint = computed(() =>
  search.value.trim() ? "No files matched your search." : "No files here yet."
)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[80vh] flex-col gap-3 sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Add from Google Drive</DialogTitle>
        <DialogDescription>
          Pick a file from your connected Drive. Docs are imported as markdown,
          Sheets as CSV.
        </DialogDescription>
      </DialogHeader>

      <InputGroup>
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
        <InputGroupInput
          v-model="search"
          placeholder="Search your Drive..."
          :disabled="!!listError && files.length === 0 && !search"
        />
      </InputGroup>

      <div v-if="folder" class="flex items-center gap-1">
        <Badge variant="secondary" class="max-w-full">
          <IconFolder />
          <span class="truncate">{{ folder.name }}</span>
        </Badge>
        <Button variant="ghost" size="icon-sm" @click="exitFolder">
          <IconX />
          <span class="sr-only">All files</span>
        </Button>
      </div>

      <div
        v-if="importError"
        class="text-destructive rounded-xl border p-2 text-xs"
      >
        {{ importError }}
      </div>

      <OverlayScrollbarsWrapper class="min-h-0 grow">
        <LoadingState v-if="loading" label="Loading your Drive..." />

        <div
          v-else-if="listError"
          class="text-muted-foreground space-y-2 rounded-xl border border-dashed p-4 text-sm"
        >
          <p>{{ listError }}</p>
          <Button variant="secondary" size="sm" @click="load()">
            Try again
          </Button>
        </div>

        <Empty v-else-if="files.length === 0" class="border-dashed p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon"><IconSearch /></EmptyMedia>
            <EmptyTitle>Nothing found</EmptyTitle>
            <EmptyDescription>{{ emptyHint }}</EmptyDescription>
          </EmptyHeader>
        </Empty>

        <div v-else class="grid gap-1">
          <button
            v-for="file in files"
            :key="file.id"
            type="button"
            class="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-2 rounded-xl border p-2 text-left focus-visible:ring-2 focus-visible:outline-none"
            :disabled="importingId !== null && importingId !== file.id"
            @click="pick(file)"
          >
            <div
              class="bg-muted flex size-9 shrink-0 items-center justify-center rounded border"
            >
              <Spinner v-if="importingId === file.id" />
              <Component :is="rowIcon(file)" v-else />
            </div>
            <div class="min-w-0 grow">
              <p class="truncate text-sm font-medium">{{ file.name }}</p>
              <p class="text-muted-foreground truncate text-xs">
                {{ isFolder(file) ? "Folder" : rowMeta(file) }}
              </p>
            </div>
          </button>

          <Button
            v-if="nextPageToken"
            variant="ghost"
            size="sm"
            :disabled="loadingMore"
            @click="load(true)"
          >
            <Spinner v-if="loadingMore" />
            Load more
          </Button>
        </div>
      </OverlayScrollbarsWrapper>
    </DialogContent>
  </Dialog>
</template>

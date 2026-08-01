<script lang="ts" setup>
/**
 * DriveFilePicker — in-app "Add from Drive" sheet
 * (docs/connections-google-drive-d3.prompt.md). Browses the member's
 * connected Google Drive through the `listDriveFiles` callable — the
 * deliberate replacement for Google's Picker widget, so OAuth tokens never
 * reach the browser — and imports the multi-selected files via the
 * caller-provided `importFile`, one call per file from the footer's Add
 * button (bytes move entirely server-side). Target-agnostic: chat
 * sessions (SessionAttachments) and workspace nodes (NodeAttachments) each
 * pass their own import callable; the picker only knows Drive.
 *
 * Browse model: debounced free-text search over the whole corpus, plus
 * one-level folder drill-in (clicking a folder scopes the list to it; the
 * "All files" chip backs out). Pagination via the API's opaque pageToken.
 * Availability lives here too: the trigger always renders, and an
 * unconnected member gets an in-sheet steer to Settings → Connections
 * instead of the browser. Remaining binding problems (needs reauth / app
 * disabled mid-session) still surface as the server's own message.
 */
import { useMyConnectionFeature } from "@/composables/useConnections"
import { listDriveFiles, type DriveFileRow } from "@/composables/useFunctions"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  IconCheck,
  IconFile,
  IconFileImage,
  IconFilePdf,
  IconFileText,
  IconFolder,
  IconLogosGoogleDrive,
  IconSearch,
  IconX,
} from "@/data/icons"
import { formatAttachmentSize } from "@/helpers/node-attachments"
import { emitter } from "@/modules/mitt"
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
  /**
   * Accessible name for the built-in trigger button — surfaced as its
   * tooltip on hover/focus AND as its `aria-label` (the trigger is
   * icon-only).
   */
  triggerLabel: string
}>()

const open = defineModel<boolean>("open", { default: false })

const isFullscreen = useIsFullscreen()

// Three-condition gate (installed + not killed + own account linked); when
// it fails the sheet swaps the browser for the connect steer below.
const { available: driveAvailable } = useMyConnectionFeature("google-drive")

const openConnectionsSettings = () => {
  // Close first so the Settings dialog doesn't stack on the sheet.
  open.value = false
  emitter.emit("Dialog.Settings.Open", "connections")
}

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
// Selection is a Map (id → row) so picks survive folder drill-in, search
// re-queries and pagination — the footer imports whatever has accumulated.
const selected = ref(new Map<string, DriveFileRow>())
const importingId = ref<string | null>(null)
const importing = computed(() => importingId.value !== null)
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
  // Single guard for every entry point (open, search, folder, retry, page).
  if (!teamId || !driveAvailable.value) return
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
  selected.value = new Map()
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

const isPicked = (file: DriveFileRow) => selected.value.has(file.id)

const pick = (file: DriveFileRow) => {
  if (importing.value) return
  if (isFolder(file)) {
    enterFolder(file)
    return
  }
  if (selected.value.has(file.id)) selected.value.delete(file.id)
  else selected.value.set(file.id, file)
}

// Sequential on purpose: each import is a heavy server-side Drive fetch, and
// one-at-a-time keeps error handling honest — a failure stops the batch with
// the failed file (and everything after it) still selected for retry.
const importSelected = async () => {
  const importFile = props.importFile
  if (!importFile || importing.value || selected.value.size === 0) return
  importError.value = null
  try {
    for (const file of [...selected.value.values()]) {
      importingId.value = file.id
      const imported = await importFile(file.id, file.name)
      emit("imported", imported.attachmentId, imported.displayName)
      selected.value.delete(file.id)
    }
    open.value = false
  } catch (error) {
    importError.value = (error as Error).message
  } finally {
    importingId.value = null
  }
}

const addLabel = computed(() => {
  const count = selected.value.size
  if (count === 0) return "Add files"
  return count === 1 ? "Add 1 file" : `Add ${count} files`
})

const emptyHint = computed(() =>
  search.value.trim() ? "No files matched your search." : "No files here yet."
)
</script>

<template>
  <Sheet v-model:open="open">
    <!-- Built-in trigger — the Drive-logo button both call sites shared, so
         it lives here; parents pass only `triggerLabel`/`triggerDisabled`
         (and may still force-close via v-model on session/node switch).
         Tooltip-around-SheetTrigger per the SettingsMemoryRowActions
         nesting; every layer down to the Button is renderless or as-child,
         so the button stays a direct DOM child of the parent's ButtonGroup
         for its joined-corner selectors. -->
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <SheetTrigger as-child>
            <Button variant="outline" size="icon" :aria-label="triggerLabel">
              <IconLogosGoogleDrive />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>{{ triggerLabel }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <!-- House floating-sheet treatment (Agents.vue / AiAsk.vue): inset rounded
         panel, `h-auto!` so inset-y-0 + margins define a definite height — the
         files list scrolls via ScrollContainer, whose viewport resolves
         `height: 100%` against this flex column. -->
    <SheetContent
      class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-4xl border"
      :class="{ 'mt-12': isTauri && !isFullscreen }"
    >
      <SheetHeader>
        <SheetTitle>Add from Google Drive</SheetTitle>
        <SheetDescription>
          Pick files from your connected Drive. Docs are imported as markdown,
          Sheets as CSV.
        </SheetDescription>
      </SheetHeader>

      <!-- SheetContent has no built-in padding (DialogContent did), so the
           pinned controls carry their own gutters. Search (and the footer)
           only make sense once Drive is connected. -->
      <div v-if="driveAvailable" class="flex flex-col gap-2 px-4 pb-2">
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
          <Button variant="ghost" size="icon" @click="exitFolder">
            <IconX />
            <span class="sr-only">All files</span>
          </Button>
        </div>

        <div
          v-if="importError"
          class="text-destructive rounded-4xl border p-2 text-xs"
        >
          {{ importError }}
        </div>
      </div>

      <!-- House sheet-scroll treatment (Shortcuts.vue / Changelog.vue): bare
           wrapper as a direct flex child of SheetContent, gutters on the
           inner scroll content so the scrollbar and fade hints span the
           sheet's full width. -->
      <ScrollContainer>
        <div class="flex grow flex-col px-4 pb-4">
          <!-- Not connected: the trigger is never hidden or disabled for
               this — the sheet itself steers to Settings → Connections. -->
          <Empty v-if="!driveAvailable" class="border-dashed p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon"><IconLogosGoogleDrive /></EmptyMedia>
              <EmptyTitle>Connect Google Drive</EmptyTitle>
              <EmptyDescription>
                Link your Google account to browse and import your Drive files
                here.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="secondary" @click="openConnectionsSettings">
                Open settings
              </Button>
            </EmptyContent>
          </Empty>

          <LoadingState v-else-if="loading" label="Loading your Drive..." />

          <div
            v-else-if="listError"
            class="text-muted-foreground space-y-2 rounded-4xl border border-dashed p-4 text-sm"
          >
            <p>{{ listError }}</p>
            <Button variant="secondary" @click="load()"> Try again </Button>
          </div>

          <Empty v-else-if="files.length === 0" class="border-dashed p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon"><IconSearch /></EmptyMedia>
              <EmptyTitle>Nothing found</EmptyTitle>
              <EmptyDescription>{{ emptyHint }}</EmptyDescription>
            </EmptyHeader>
          </Empty>

          <div v-else class="grid gap-1">
            <!-- `AttachmentTrigger` makes the whole card the pick target
               (open folder / toggle selection — the footer button runs the
               import); `state="processing"` shimmers the title of the row
               currently importing. Selection follows the SessionAttachments
               card-toggle convention: check icon in the media, border tint,
               aria-pressed on the trigger. -->
            <Attachment
              v-for="file in files"
              :key="file.id"
              :class="['w-full', isPicked(file) && 'border-primary']"
              :state="importingId === file.id ? 'processing' : 'done'"
            >
              <AttachmentMedia>
                <Spinner v-if="importingId === file.id" />
                <IconCheck v-else-if="isPicked(file)" />
                <Component :is="rowIcon(file)" v-else />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{{ file.name }}</AttachmentTitle>
                <AttachmentDescription>
                  {{ isFolder(file) ? "Folder" : rowMeta(file) }}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentTrigger
                :aria-label="
                  isFolder(file)
                    ? `Open folder ${file.name}`
                    : isPicked(file)
                      ? `Unselect ${file.name}`
                      : `Select ${file.name}`
                "
                :aria-pressed="isFolder(file) ? undefined : isPicked(file)"
                :disabled="importing"
                @click="pick(file)"
              />
            </Attachment>

            <Button
              v-if="nextPageToken"
              variant="ghost"
              :disabled="loadingMore"
              @click="load(true)"
            >
              <Spinner v-if="loadingMore" />
              Load more
            </Button>
          </div>
        </div>
      </ScrollContainer>

      <!-- `data-dialog-action` gives the sheet macOS default-button semantics
           via the app-level useDialogActionHotkey (SheetContent renders as
           role="dialog"), matching every dialog footer's ↩ hint. -->
      <SheetFooter v-if="driveAvailable">
        <Button
          data-dialog-action
          :disabled="!importFile || importing || selected.size === 0"
          @click="importSelected"
        >
          <Spinner v-if="importing" />
          {{ addLabel }}
          <Kbd>↩</Kbd>
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

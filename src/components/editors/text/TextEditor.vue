<script lang="ts" setup>
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconBold,
  IconBraces,
  IconCheck,
  IconCircleFilled,
  IconCode,
  IconColumns,
  IconCombine,
  IconCopy,
  IconExternalLink,
  IconGripVertical,
  IconHeading1,
  IconHeading2,
  IconHeading3,
  IconHighlighter,
  IconItalic,
  IconLink,
  IconList,
  IconListChecks,
  IconListCollapse,
  IconListOrdered,
  IconPalette,
  IconPlus,
  IconQuote,
  IconRefreshCcw,
  IconRows,
  IconSettings,
  IconSplit,
  IconSplitSquareHorizontal,
  IconSquare,
  IconStrikethrough,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconText,
  IconTrash,
  IconType,
  IconUnderline,
  IconUnlink,
  IconWrench,
  IconX,
} from "@/data/icons"
import { accents, fonts, sizes } from "@/helpers/defaults"
import type { JSONContent, Editor as TiptapEditor } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import Code from "@tiptap/extension-code"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details"
import Document from "@tiptap/extension-document"
import { DragHandle } from "@tiptap/extension-drag-handle-vue-3"
import Emoji from "@tiptap/extension-emoji"
import FileHandler from "@tiptap/extension-file-handler"
import HardBreak from "@tiptap/extension-hard-break"
import Heading from "@tiptap/extension-heading"
import Highlight from "@tiptap/extension-highlight"
import HorizontalRule from "@tiptap/extension-horizontal-rule"
import Image from "@tiptap/extension-image"
import InvisibleCharacters from "@tiptap/extension-invisible-characters"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import { BulletList } from "@tiptap/extension-list/bullet-list"
import { ListItem } from "@tiptap/extension-list/item"
import { ListKeymap } from "@tiptap/extension-list/keymap"
import { OrderedList } from "@tiptap/extension-list/ordered-list"
import { TaskItem } from "@tiptap/extension-list/task-item"
import { TaskList } from "@tiptap/extension-list/task-list"
import { Mathematics, migrateMathStrings } from "@tiptap/extension-mathematics"
import Paragraph from "@tiptap/extension-paragraph"
import Strike from "@tiptap/extension-strike"
import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import { TableCell } from "@tiptap/extension-table/cell"
import { TableHeader } from "@tiptap/extension-table/header"
import { TableRow } from "@tiptap/extension-table/row"
import { Table } from "@tiptap/extension-table/table"
import Text from "@tiptap/extension-text"
import TextAlign from "@tiptap/extension-text-align"
import { TextStyle } from "@tiptap/extension-text-style"
import { BackgroundColor } from "@tiptap/extension-text-style/background-color"
import { Color } from "@tiptap/extension-text-style/color"
import { FontFamily } from "@tiptap/extension-text-style/font-family"
import { FontSize } from "@tiptap/extension-text-style/font-size"
import { LineHeight } from "@tiptap/extension-text-style/line-height"
import Typography from "@tiptap/extension-typography"
import Underline from "@tiptap/extension-underline"
import UniqueID from "@tiptap/extension-unique-id"
import { CharacterCount } from "@tiptap/extensions/character-count"
import { Dropcursor } from "@tiptap/extensions/drop-cursor"
import { Focus } from "@tiptap/extensions/focus"
import { Gapcursor } from "@tiptap/extensions/gap-cursor"
import { Placeholder } from "@tiptap/extensions/placeholder"
import { Selection } from "@tiptap/extensions/selection"
import { TrailingNode } from "@tiptap/extensions/trailing-node"
import { UndoRedo } from "@tiptap/extensions/undo-redo"
import { EditorContent, useEditor } from "@tiptap/vue-3"
import { BubbleMenu, FloatingMenu } from "@tiptap/vue-3/menus"
import { common, createLowlight } from "lowlight"
import type { Awareness } from "y-protocols/awareness"
import type { Doc as YDoc } from "yjs"

const props = withDefaults(
  defineProps<{
    modelValue?: string
    readOnly?: boolean
    collaborationDoc?: YDoc | null
    collaborationAwareness?: Awareness | null
  }>(),
  {
    modelValue: "",
    readOnly: false,
    collaborationDoc: null,
    collaborationAwareness: null,
  }
)

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
}>()

const createEmptyDoc = (): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph" }],
})

const isJSONDoc = (value: unknown): value is JSONContent =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "doc"

const parseModelValue = (raw: string | undefined): JSONContent => {
  const trimmed = raw?.trim() ?? ""
  if (!trimmed.length) {
    return createEmptyDoc()
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (isJSONDoc(parsed)) {
      return parsed
    }
  } catch {
    // Fallback to plain-text content.
  }

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: raw ?? "",
          },
        ],
      },
    ],
  }
}

const isEmptyDoc = (value: JSONContent | null | undefined): boolean => {
  if (!value || value.type !== "doc") {
    return false
  }

  const nodes = value.content ?? []
  if (!nodes.length) {
    return true
  }

  if (nodes.length > 1) {
    return false
  }

  const [node] = nodes
  if (!node || node.type !== "paragraph") {
    return false
  }

  return !node.content?.length
}

const serializeModelValue = (value: JSONContent | null | undefined): string => {
  if (!value || isEmptyDoc(value)) {
    return ""
  }

  return JSON.stringify(value)
}

const normalizeIncomingModelValue = (value: string | undefined): string => {
  const normalized = value ?? ""
  return normalized.trim().length ? normalized : ""
}

const READING_WORDS_PER_MINUTE = 200
const MODEL_EMIT_DEBOUNCE_MS = 120
const MAX_IMAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const

const isReadOnly = computed(() => props.readOnly)
const initialContent = parseModelValue(props.modelValue)
let currentSerializedModelValue = serializeModelValue(initialContent)
const editorStats = ref({
  characters: 0,
  words: 0,
  readingMinutes: 0,
})
let modelEmitTimer: ReturnType<typeof setTimeout> | null = null
let pendingModelValue: string | null = null

const sharedLowlight = createLowlight(common)

type CollaborationProvider = {
  awareness: Awareness
  on: (event: string, listener: () => void) => void
  off: (event: string, listener: () => void) => void
}

const createCollaborationProvider = (
  awareness: Awareness
): CollaborationProvider => {
  const syncedListeners = new Set<() => void>()

  const scheduleSynced = (listener: () => void) => {
    queueMicrotask(() => {
      if (syncedListeners.has(listener)) {
        listener()
      }
    })
  }

  return {
    awareness,
    on: (event, listener) => {
      if (event !== "synced") {
        return
      }
      syncedListeners.add(listener)
      scheduleSynced(listener)
    },
    off: (event, listener) => {
      if (event !== "synced") {
        return
      }
      syncedListeners.delete(listener)
    },
  }
}

const collaborationProvider = props.collaborationAwareness
  ? createCollaborationProvider(props.collaborationAwareness)
  : null

const getCollaborationUser = () => {
  const localState = props.collaborationAwareness?.getLocalState() as {
    user?: {
      [key: string]: unknown
      name?: unknown
      color?: unknown
    }
  } | null
  const currentUser = localState?.user ?? {}

  const name =
    typeof localState?.user?.name === "string" &&
    localState.user.name.trim().length
      ? localState.user.name.trim()
      : "Anonymous"

  const color =
    typeof localState?.user?.color === "string" &&
    localState.user.color.trim().length
      ? localState.user.color
      : "#3b82f6"

  return {
    ...currentUser,
    name,
    color,
  }
}

const updateEditorStats = (currentEditor: TiptapEditor) => {
  const characterCountStorage = currentEditor.storage.characterCount as
    | {
        characters: () => number
        words: () => number
      }
    | undefined

  const characters = characterCountStorage?.characters?.() ?? 0
  const words = characterCountStorage?.words?.() ?? 0

  editorStats.value = {
    characters,
    words,
    readingMinutes: Math.ceil(words / READING_WORDS_PER_MINUTE),
  }
}

const readImageFileAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const fileReader = new FileReader()

    fileReader.onload = () => {
      if (typeof fileReader.result === "string") {
        resolve(fileReader.result)
        return
      }
      reject(new Error("Unable to read image file"))
    }

    fileReader.onerror = () => {
      reject(fileReader.error ?? new Error("Unable to read image file"))
    }

    fileReader.onabort = () => {
      reject(new Error("Image file read was aborted"))
    }

    fileReader.readAsDataURL(file)
  })

const insertImageFiles = async (
  currentEditor: TiptapEditor,
  files: File[],
  position?: number
) => {
  const imageNodes = (
    await Promise.all(
      files.map(async (file) => {
        if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
          console.warn(
            `[TextEditor] Skipping "${file.name}" because it exceeds ${MAX_IMAGE_FILE_SIZE_BYTES} bytes.`
          )
          return null
        }

        try {
          const src = await readImageFileAsDataURL(file)
          return {
            type: "image",
            attrs: { src },
          } as JSONContent
        } catch (error) {
          console.error(`[TextEditor] Failed to insert "${file.name}":`, error)
          return null
        }
      })
    )
  ).flatMap((node) => (node ? [node] : []))

  if (!imageNodes.length) {
    return
  }

  const chain = currentEditor.chain().focus()
  if (typeof position === "number") {
    chain.insertContentAt(position, imageNodes).run()
    return
  }

  chain.insertContent(imageNodes).run()
}

const normalizeLinkHref = (href: string): string | null => {
  const trimmed = href.trim()
  if (!trimmed.length) {
    return ""
  }

  if (/^(mailto:|tel:)/i.test(trimmed)) {
    return trimmed
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    return new URL(withProtocol).toString()
  } catch {
    return null
  }
}

const setLinkFromPrompt = () => {
  const currentEditor = editor.value
  if (!currentEditor || typeof window === "undefined") {
    return
  }

  const currentHref = currentEditor.getAttributes("link").href
  const nextHref = window.prompt(
    "Enter URL",
    typeof currentHref === "string" ? currentHref : "https://"
  )

  if (nextHref === null) {
    return
  }

  const normalizedHref = normalizeLinkHref(nextHref)
  if (normalizedHref === null) {
    console.warn("[TextEditor] Ignoring invalid URL input")
    return
  }

  const chain = currentEditor.chain().focus().extendMarkRange("link")
  if (!normalizedHref.length) {
    chain.unsetLink().run()
    return
  }

  chain.setLink({ href: normalizedHref }).run()
}

const extensions = [
  Document,
  Paragraph,
  Text,
  Blockquote,
  BulletList,
  OrderedList,
  TaskList,
  ListItem,
  TaskItem.configure({
    nested: true,
  }),
  ListKeymap,
  CodeBlockLowlight.configure({
    lowlight: sharedLowlight,
  }),
  Details.configure({
    persist: true,
  }),
  DetailsSummary,
  DetailsContent,
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node }) => {
      if (node.type.name === "detailsSummary") {
        return "Summary"
      }
      return "Type '/' for commands"
    },
  }),
  Selection,
  TrailingNode,
  Emoji.configure({
    enableEmoticons: true,
  }),
  HardBreak,
  Heading.configure({
    levels: [1, 2, 3],
  }),
  TextAlign.configure({
    types: ["heading", "paragraph"],
  }),
  HorizontalRule,
  Image,
  Dropcursor,
  Gapcursor,
  Bold,
  Italic,
  Underline,
  Code,
  Highlight.configure({ multicolor: true }),
  Link.configure({
    openOnClick: false,
    defaultProtocol: "https",
  }),
  Strike,
  Subscript,
  Superscript,
  TextStyle,
  Color,
  BackgroundColor,
  Table.configure({
    resizable: true,
    allowTableNodeSelection: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  CharacterCount,
  Typography,
  Focus,
  FileHandler.configure({
    allowedMimeTypes: [...IMAGE_MIME_TYPES],
    onDrop: (currentEditor, files, pos) => {
      void insertImageFiles(currentEditor, files, pos)
    },
    onPaste: (currentEditor, files, pasteContent) => {
      if (pasteContent?.length) {
        return
      }

      // Snapshot the original selection before async file reads complete.
      const insertPosition = currentEditor.state.selection.anchor
      void insertImageFiles(currentEditor, files, insertPosition)
    },
  }),
  FontFamily,
  FontSize,
  LineHeight,
  InvisibleCharacters.configure({
    visible: false, // Hide invisible characters by default
  }),
  Mathematics.configure({
    inlineOptions: {
      // optional options for the inline math node
    },
    blockOptions: {
      // optional options for the block math node
    },
    katexOptions: {
      // optional options for the KaTeX renderer
    },
  }),
  UniqueID.configure({
    types: ["heading", "paragraph"],
  }),
]

if (props.collaborationDoc) {
  extensions.push(
    Collaboration.configure({
      document: props.collaborationDoc,
      field: "tiptap",
      provider: collaborationProvider,
    })
  )

  if (collaborationProvider) {
    extensions.push(
      CollaborationCaret.configure({
        provider: collaborationProvider,
        user: getCollaborationUser(),
      })
    )
  }
} else {
  extensions.push(UndoRedo)
}

const clearPendingModelEmit = () => {
  if (modelEmitTimer !== null) {
    clearTimeout(modelEmitTimer)
    modelEmitTimer = null
  }
  pendingModelValue = null
}

const flushPendingModelEmit = () => {
  if (pendingModelValue === null) {
    return
  }

  const nextValue = pendingModelValue
  pendingModelValue = null
  emit("update:modelValue", nextValue)
}

const scheduleModelEmit = (value: string, immediate = false) => {
  pendingModelValue = value

  if (immediate) {
    if (modelEmitTimer !== null) {
      clearTimeout(modelEmitTimer)
      modelEmitTimer = null
    }
    flushPendingModelEmit()
    return
  }

  if (modelEmitTimer !== null) {
    return
  }

  modelEmitTimer = setTimeout(() => {
    modelEmitTimer = null
    flushPendingModelEmit()
  }, MODEL_EMIT_DEBOUNCE_MS)
}

const syncModelFromEditor = (
  currentEditor: TiptapEditor,
  options?: { immediate?: boolean }
) => {
  const nextJson = currentEditor.getJSON()
  const serialized = serializeModelValue(nextJson)

  currentSerializedModelValue = serialized
  updateEditorStats(currentEditor)
  scheduleModelEmit(serialized, options?.immediate ?? false)
}

const editor = useEditor({
  editable: !props.readOnly,
  content: props.collaborationDoc ? undefined : initialContent,
  editorProps: {
    attributes: {
      class:
        "focus:outline-none size-full pl-10 pr-2 py-8 prose prose-sm max-w-none prose-neutral dark:prose-invert",
    },
  },
  extensions,
  onCreate: ({ editor: currentEditor }) => {
    migrateMathStrings(currentEditor)

    if (
      props.collaborationDoc &&
      currentEditor.isEmpty &&
      (props.modelValue ?? "").trim().length
    ) {
      try {
        currentEditor.commands.setContent(parseModelValue(props.modelValue), {
          emitUpdate: true,
        })
      } catch (error) {
        console.error(
          "[TextEditor] Failed to hydrate collaborative content:",
          error
        )
      }
      migrateMathStrings(currentEditor)
    }

    syncModelFromEditor(currentEditor, { immediate: true })
  },
  onUpdate: ({ editor: currentEditor }) => {
    syncModelFromEditor(currentEditor)
  },
})

watch(
  () => props.modelValue,
  (value) => {
    const currentEditor = editor.value
    if (!currentEditor) {
      return
    }

    const normalizedIncomingValue = normalizeIncomingModelValue(value)
    if (normalizedIncomingValue === currentSerializedModelValue) {
      return
    }

    const nextJson = parseModelValue(value)
    const nextSerialized = serializeModelValue(nextJson)
    if (nextSerialized === currentSerializedModelValue) {
      return
    }

    clearPendingModelEmit()
    try {
      currentEditor.commands.setContent(nextJson, {
        emitUpdate: false,
      })
    } catch (error) {
      console.error("[TextEditor] Failed to sync model value:", error)
      currentEditor.commands.setContent(createEmptyDoc(), {
        emitUpdate: false,
      })
    }

    currentSerializedModelValue = serializeModelValue(currentEditor.getJSON())
    updateEditorStats(currentEditor)
  }
)

watch(
  () => props.readOnly,
  (newValue) => {
    editor.value?.setEditable(!newValue, false)
  }
)

onBeforeUnmount(() => {
  if (modelEmitTimer !== null) {
    clearTimeout(modelEmitTimer)
    modelEmitTimer = null
  }
  flushPendingModelEmit()

  editor.value?.destroy()
})

const { copy, copied } = useClipboard({ legacy: true })

const copySource = async () => {
  if (!editor.value) {
    return
  }

  await copy(JSON.stringify(editor.value.getJSON(), null, 2))
}
</script>

<template>
  <div
    class="bg-background/50 sticky top-2 m-2 flex items-center gap-2 rounded-md border p-2 backdrop-blur-lg"
  >
    <p class="text-muted-foreground mr-auto ml-2 text-xs">
      {{ editorStats.characters }} characters / {{ editorStats.words }} words /
      {{ editorStats.readingMinutes }} min read
    </p>
    <Button variant="outline" size="icon-sm" @click="copySource">
      <IconCopy v-if="!copied" />
      <IconCheck v-else />
    </Button>
  </div>
  <EditorContent :editor="editor" />
  <BubbleMenu v-if="editor && !isReadOnly" :editor="editor">
    <div class="bg-card flex gap-1 rounded-lg border p-1 shadow-lg">
      <TooltipProvider>
        <ButtonGroup>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconRefreshCcw />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Turn Into</TooltipContent>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Turn into
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().setParagraph().run()"
                  >
                    <IconType /> Paragraph
                    <DropdownMenuShortcut v-if="editor?.isActive('paragraph')">
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="
                      editor?.chain().focus().toggleHeading({ level: 1 }).run()
                    "
                  >
                    <IconHeading1 /> Heading 1
                    <DropdownMenuShortcut
                      v-if="editor?.isActive('heading', { level: 1 })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="
                      editor?.chain().focus().toggleHeading({ level: 2 }).run()
                    "
                  >
                    <IconHeading2 /> Heading 2
                    <DropdownMenuShortcut
                      v-if="editor?.isActive('heading', { level: 2 })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="
                      editor?.chain().focus().toggleHeading({ level: 3 }).run()
                    "
                  >
                    <IconHeading3 /> Heading 3
                    <DropdownMenuShortcut
                      v-if="editor?.isActive('heading', { level: 3 })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleBulletList().run()"
                  >
                    <IconList /> {{ $t("components.textEditor.bulletedList") }}
                    <DropdownMenuShortcut v-if="editor?.isActive('bulletList')">
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleOrderedList().run()"
                  >
                    <IconListOrdered />
                    {{ $t("components.textEditor.numberedList") }}
                    <DropdownMenuShortcut
                      v-if="editor?.isActive('orderedList')"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleTaskList().run()"
                  >
                    <IconListChecks />
                    {{ $t("components.textEditor.todoList") }}
                    <DropdownMenuShortcut v-if="editor?.isActive('taskList')">
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().setDetails().run()"
                  >
                    <IconListCollapse />
                    {{ $t("components.textEditor.toggleList") }}
                    <DropdownMenuShortcut v-if="editor?.isActive('details')">
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleCodeBlock().run()"
                  >
                    <IconCode /> {{ $t("components.textEditor.codeBlock") }}
                    <DropdownMenuShortcut v-if="editor?.isActive('codeBlock')">
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleBlockquote().run()"
                  >
                    <IconQuote /> {{ $t("components.textEditor.blockquote") }}
                    <DropdownMenuShortcut v-if="editor?.isActive('blockquote')">
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
        </ButtonGroup>

        <Tooltip>
          <TooltipTrigger as-child>
            <Toggle
              variant="outline"
              :value="'bold'"
              :pressed="editor?.isActive('bold')"
              @click="editor?.chain().focus().toggleBold().run()"
            >
              <IconBold />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.textEditor.bold")
          }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Toggle
              variant="outline"
              :value="'italic'"
              :pressed="editor?.isActive('italic')"
              @click="editor?.chain().focus().toggleItalic().run()"
            >
              <IconItalic />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.textEditor.italic")
          }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Toggle
              variant="outline"
              :value="'underline'"
              :pressed="editor?.isActive('underline')"
              @click="editor?.chain().focus().toggleUnderline().run()"
            >
              <IconUnderline />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.textEditor.underline")
          }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Toggle
              variant="outline"
              :value="'strike'"
              :pressed="editor?.isActive('strike')"
              @click="editor?.chain().focus().toggleStrike().run()"
            >
              <IconStrikethrough />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.textEditor.strike")
          }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Toggle
              variant="outline"
              :value="'code'"
              :pressed="editor?.isActive('code')"
              @click="editor?.chain().focus().toggleCode().run()"
            >
              <IconBraces />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{{
            $t("components.textEditor.code")
          }}</TooltipContent>
        </Tooltip>

        <ButtonGroup>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconPalette />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{{
                $t("components.textEditor.textColor")
              }}</TooltipContent>
              <DropdownMenuContent>
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  {{ $t("components.textEditor.textColor") }}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    v-for="color in accents"
                    :key="color.id"
                    @click="editor?.chain().focus().setColor(color.id).run()"
                  >
                    <IconCircleFilled :class="`text-${color.id}-500`" />
                    {{ color.name }}
                    <DropdownMenuShortcut
                      v-if="editor?.isActive('textStyle', { color: color.id })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  @click="editor?.chain().focus().unsetColor().run()"
                >
                  <IconX /> {{ $t("components.textEditor.removeColor") }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconHighlighter />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{{
                $t("components.textEditor.highlightColor")
              }}</TooltipContent>
              <DropdownMenuContent>
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  {{ $t("components.textEditor.highlightColor") }}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    v-for="color in accents"
                    :key="color.id"
                    @click="
                      editor
                        ?.chain()
                        .focus()
                        .toggleHighlight({ color: color.id })
                        .run()
                    "
                  >
                    <IconCircleFilled :class="`text-${color.id}-500`" />
                    {{ color.name }}
                    <DropdownMenuShortcut
                      v-if="editor?.isActive('highlight', { color: color.id })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  @click="editor?.chain().focus().unsetHighlight().run()"
                >
                  <IconX /> Remove Highlight
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
        </ButtonGroup>

        <ButtonGroup>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconType />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Font Size</TooltipContent>
              <DropdownMenuContent>
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Font Size
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    v-for="size in sizes"
                    :key="size.id"
                    @click="editor?.chain().focus().setFontSize(size.id).run()"
                  >
                    <span class="mr-2" :style="{ fontSize: size.id }">Aa</span>
                    {{ size.name }}
                    <DropdownMenuShortcut
                      v-if="
                        editor?.isActive('textStyle', { fontSize: size.id })
                      "
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  @click="editor?.chain().focus().unsetFontSize().run()"
                >
                  <IconX /> Remove Font Size
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconText />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Font Family</TooltipContent>
              <DropdownMenuContent>
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Font Family
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    v-for="font in fonts"
                    :key="font.id"
                    @click="
                      editor?.chain().focus().setFontFamily(font.id).run()
                    "
                  >
                    <span class="mr-2" :style="{ fontFamily: font.id }"
                      >Aa</span
                    >
                    {{ font.name }}
                    <DropdownMenuShortcut
                      v-if="
                        editor?.isActive('textStyle', {
                          fontFamily: font.id,
                        })
                      "
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="
                      editor
                        ?.chain()
                        .focus()
                        .setFontFamily('Comic Sans MS, Comic Sans')
                        .run()
                    "
                  >
                    <span class="mr-2" :style="{ fontFamily: 'Comic Sans MS' }"
                      >Aa</span
                    >
                    Comic Sans
                    <DropdownMenuShortcut
                      v-if="
                        editor?.isActive('textStyle', {
                          fontFamily: 'Comic Sans MS, Comic Sans',
                        })
                      "
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="
                      editor?.chain().focus().setFontFamily('cursive').run()
                    "
                  >
                    <span class="mr-2" style="font-family: cursive">Aa</span>
                    Cursive
                    <DropdownMenuShortcut
                      v-if="
                        editor?.isActive('textStyle', {
                          fontFamily: 'cursive',
                        })
                      "
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  @click="editor?.chain().focus().unsetFontFamily().run()"
                >
                  <IconX /> Remove Font Family
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconAlignLeft />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Text Align</TooltipContent>
              <DropdownMenuContent>
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Text Alignment
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().setTextAlign('left').run()"
                  >
                    <IconAlignLeft /> Left
                    <DropdownMenuShortcut
                      v-if="editor?.isActive({ textAlign: 'left' })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="
                      editor?.chain().focus().setTextAlign('center').run()
                    "
                  >
                    <IconAlignCenter /> Center
                    <DropdownMenuShortcut
                      v-if="editor?.isActive({ textAlign: 'center' })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().setTextAlign('right').run()"
                  >
                    <IconAlignRight /> Right
                    <DropdownMenuShortcut
                      v-if="editor?.isActive({ textAlign: 'right' })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="
                      editor?.chain().focus().setTextAlign('justify').run()
                    "
                  >
                    <IconAlignJustify /> Justify
                    <DropdownMenuShortcut
                      v-if="editor?.isActive({ textAlign: 'justify' })"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Text Style
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleSubscript().run()"
                  >
                    <IconSubscript /> Subscript
                    <DropdownMenuShortcut v-if="editor?.isActive('subscript')">
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleSuperscript().run()"
                  >
                    <IconSuperscript /> Superscript
                    <DropdownMenuShortcut
                      v-if="editor?.isActive('superscript')"
                    >
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  @click="editor?.chain().focus().unsetTextAlign().run()"
                >
                  <IconX /> Remove Alignment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
        </ButtonGroup>

        <ButtonGroup>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconTable />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{{
                $t("components.textEditor.table")
              }}</TooltipContent>
              <DropdownMenuContent>
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  {{ $t("components.textEditor.table") }}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="
                      editor
                        ?.chain()
                        .focus()
                        .insertTable({
                          rows: 3,
                          cols: 3,
                          withHeaderRow: true,
                        })
                        .run()
                    "
                  >
                    <IconPlus /> {{ $t("components.textEditor.insertTable") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().deleteTable().run()"
                  >
                    <IconTrash /> {{ $t("components.textEditor.deleteTable") }}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  {{ $t("components.textEditor.columns") }}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().addColumnBefore().run()"
                  >
                    <IconArrowLeft />
                    {{ $t("components.textEditor.addColumnBefore") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().addColumnAfter().run()"
                  >
                    <IconArrowRight />
                    {{ $t("components.textEditor.addColumnAfter") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().deleteColumn().run()"
                  >
                    <IconTrash /> {{ $t("components.textEditor.deleteColumn") }}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  {{ $t("components.textEditor.rows") }}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().addRowBefore().run()"
                  >
                    <IconArrowUp />
                    {{ $t("components.textEditor.addRowBefore") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().addRowAfter().run()"
                  >
                    <IconArrowDown />
                    {{ $t("components.textEditor.addRowAfter") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().deleteRow().run()"
                  >
                    <IconTrash /> {{ $t("components.textEditor.deleteRow") }}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  {{ $t("components.textEditor.cells") }}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().mergeCells().run()"
                  >
                    <IconCombine /> {{ $t("components.textEditor.mergeCells") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().splitCell().run()"
                  >
                    <IconSplit /> {{ $t("components.textEditor.splitCell") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().mergeOrSplit().run()"
                  >
                    <IconSplitSquareHorizontal /> Merge or Split
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Headers
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleHeaderColumn().run()"
                  >
                    <IconColumns /> Toggle Header Column
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleHeaderRow().run()"
                  >
                    <IconRows /> Toggle Header Row
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().toggleHeaderCell().run()"
                  >
                    <IconSquare /> Toggle Header Cell
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Navigation
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().goToNextCell().run()"
                  >
                    <IconArrowRight /> Go to Next Cell
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().goToPreviousCell().run()"
                  >
                    <IconArrowLeft /> Go to Previous Cell
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Advanced
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    @click="
                      editor
                        ?.chain()
                        .focus()
                        .setCellAttribute('colspan', 2)
                        .run()
                    "
                  >
                    <IconSettings /> Set Cell Attribute
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    @click="editor?.chain().focus().fixTables().run()"
                  >
                    <IconWrench /> Fix Tables
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
        </ButtonGroup>

        <ButtonGroup>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="icon"
                    class="data-[state=open]:bg-accent"
                  >
                    <IconLink />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Link</TooltipContent>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel class="text-muted-foreground text-xs">
                  Link Management
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem @click="setLinkFromPrompt">
                    <IconExternalLink />
                    {{ editor?.isActive("link") ? "Edit Link" : "Add Link" }}
                    <DropdownMenuShortcut v-if="editor?.isActive('link')">
                      <IconCheck />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    :disabled="!editor?.isActive('link')"
                    @click="editor?.chain().focus().unsetLink().run()"
                  >
                    <IconUnlink /> Remove Link
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tooltip>
        </ButtonGroup>
      </TooltipProvider>
    </div>
  </BubbleMenu>
  <FloatingMenu
    v-if="editor && !isReadOnly"
    :editor="editor"
    :tippy-options="{ duration: 100 }"
  >
    <div
      class="bg-card flex items-center gap-1 rounded-lg border p-1 shadow-lg"
    >
      <Button
        variant="outline"
        size="icon"
        :class="{ 'bg-accent': editor?.isActive('heading', { level: 1 }) }"
        @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
      >
        <IconHeading1 />
      </Button>
      <Button
        variant="outline"
        size="icon"
        :class="{ 'bg-accent': editor?.isActive('heading', { level: 2 }) }"
        @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        <IconHeading2 />
      </Button>
      <Button
        variant="outline"
        size="icon"
        :class="{ 'bg-accent': editor?.isActive('bulletList') }"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        <IconList />
      </Button>
      <Button
        variant="outline"
        size="icon"
        :class="{ 'bg-accent': editor?.isActive('orderedList') }"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        <IconListOrdered />
      </Button>
      <Button
        variant="outline"
        size="icon"
        :class="{ 'bg-accent': editor?.isActive('taskList') }"
        @click="editor?.chain().focus().toggleTaskList().run()"
      >
        <IconListChecks />
      </Button>
      <Button
        variant="outline"
        size="icon"
        :class="{ 'bg-accent': editor?.isActive('codeBlock') }"
        @click="editor?.chain().focus().toggleCodeBlock().run()"
      >
        <IconCode />
      </Button>
    </div>
  </FloatingMenu>
  <DragHandle v-if="editor && !isReadOnly" :editor="editor">
    <Button variant="outline" size="icon-sm" class="mr-2 size-6">
      <IconGripVertical />
    </Button>
  </DragHandle>
</template>

<style lang="scss">
/* Basic editor styles */
.tiptap {
  :first-child {
    margin-top: 0;
  }

  /* List styles */
  ul,
  ol {
    padding: 0 1rem;
    margin: 1.25rem 1rem 1.25rem 0.4rem;

    li p {
      margin-top: 0.25em;
      margin-bottom: 0.25em;
    }
  }

  /* Task list specific styles */
  [data-type="taskList"] {
    list-style: none;
    margin-left: 0;
    padding: 0;

    li {
      align-items: center;
      display: flex;

      > label {
        flex: 0 0 auto;
        margin-right: 0.5rem;
        user-select: none;
      }

      > div {
        flex: 1 1 auto;
      }
    }

    input[type="checkbox"] {
      cursor: pointer;
      accent-color: inherit;
    }
  }

  /* Details */
  [data-type="details"] {
    list-style: none;
    display: flex;
    gap: 0.25rem;
    margin: 1.5rem 0;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    padding: 0.5rem;

    summary {
      font-weight: 700;
    }

    > button {
      align-items: center;
      background: transparent;
      border-radius: 4px;
      display: flex;
      font-size: 0.625rem;
      height: 1.25rem;
      justify-content: center;
      line-height: 1;
      margin-top: 0.1rem;
      padding: 0;
      width: 1.25rem;

      &:hover {
        background-color: var(--color-border);
      }

      &::before {
        content: "\25B6";
      }
    }

    &.is-open > button::before {
      transform: rotate(90deg);
    }

    > div {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      width: 100%;

      > [data-type="detailsContent"] > :last-child {
        margin-bottom: 0.5rem;
      }
    }

    .details {
      margin: 0.5rem 0;
    }
  }

  /* Editable */
  &[contenteditable="false"] {
    color: #999;
    opacity: 0.6;
  }

  /* Give a remote user a caret */
  .collaboration-carets__caret {
    border-left: 1px solid #0d0d0d;
    border-right: 1px solid #0d0d0d;
    margin-left: -1px;
    margin-right: -1px;
    pointer-events: none;
    position: relative;
    word-break: normal;
  }

  /* Render the username above the caret */
  .collaboration-carets__label {
    border-radius: 2px 2px 2px 0;
    color: #fff;
    font-size: 12px;
    font-style: normal;
    font-weight: 600;
    left: -1px;
    line-height: normal;
    padding: 2px 4px;
    position: absolute;
    top: -1.4em;
    user-select: none;
    white-space: nowrap;
  }
}
</style>

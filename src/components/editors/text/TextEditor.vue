<script lang="ts" setup>
import { type ColorOption } from "@/components/editors/text/components/TextEditorColorPicker.vue"
import { EmojiReplacer } from "@/components/editors/text/extensions/emojiReplacer"
import { RichImage } from "@/components/editors/text/extensions/richImage"
import {
  createSlashCommandExtension,
  type SlashCommandItem,
  type SlashCommandPanelState,
} from "@/components/editors/text/extensions/slashCommand"
import {
  IconBold,
  IconBraces,
  IconChevronDown,
  IconCode,
  IconGripVertical,
  IconHeading1,
  IconHeading2,
  IconHeading3,
  IconHighlighter,
  IconImage,
  IconInfo,
  IconItalic,
  IconLink,
  IconList,
  IconListChecks,
  IconListOrdered,
  IconPalette,
  IconQuote,
  IconRefreshCw,
  IconRotateCcw,
  IconStrikethrough,
  IconTable,
  IconUnderline,
  IconUnlink,
} from "@/data/icons"
import { accents } from "@/helpers/defaults"
import { showErrorToast } from "@/helpers/toast"
import type { JSONContent, Editor as TiptapEditor } from "@tiptap/core"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details"
import { DragHandle } from "@tiptap/extension-drag-handle-vue-3"
import Highlight from "@tiptap/extension-highlight"
import { TaskItem } from "@tiptap/extension-list/task-item"
import { TaskList } from "@tiptap/extension-list/task-list"
import { Mathematics, migrateMathStrings } from "@tiptap/extension-mathematics"
import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import {
  TableOfContents,
  getHierarchicalIndexes,
  type TableOfContentData,
  type TableOfContentDataItem,
  type TableOfContentsStorage,
} from "@tiptap/extension-table-of-contents"
import { TableCell } from "@tiptap/extension-table/cell"
import { TableHeader } from "@tiptap/extension-table/header"
import { TableRow } from "@tiptap/extension-table/row"
import { Table } from "@tiptap/extension-table/table"
import { TextStyle } from "@tiptap/extension-text-style"
import { Color } from "@tiptap/extension-text-style/color"
import Typography from "@tiptap/extension-typography"
import Underline from "@tiptap/extension-underline"
import { CharacterCount } from "@tiptap/extensions/character-count"
import { Placeholder } from "@tiptap/extensions/placeholder"
import StarterKit from "@tiptap/starter-kit"
import { EditorContent, useEditor } from "@tiptap/vue-3"
import { BubbleMenu } from "@tiptap/vue-3/menus"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import csharp from "highlight.js/lib/languages/csharp"
import css from "highlight.js/lib/languages/css"
import dockerfile from "highlight.js/lib/languages/dockerfile"
import go from "highlight.js/lib/languages/go"
import graphql from "highlight.js/lib/languages/graphql"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import python from "highlight.js/lib/languages/python"
import ruby from "highlight.js/lib/languages/ruby"
import rust from "highlight.js/lib/languages/rust"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"
import { createLowlight } from "lowlight"
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

const TEXT_COLORS: ColorOption[] = accents.map((accent) => ({
  id: accent.id,
  name: accent.name,
  value: `var(--color-${accent.id}-500)`,
}))

const HIGHLIGHT_COLORS: ColorOption[] = accents.map((accent) => ({
  id: accent.id,
  name: accent.name,
  value: `var(--color-${accent.id}-300)`,
}))

const DEFAULT_TEXT_COLOR =
  TEXT_COLORS.find((color) => color.id === "blue")?.value ??
  TEXT_COLORS[0]!.value
const DEFAULT_HIGHLIGHT_COLOR =
  HIGHLIGHT_COLORS.find((color) => color.id === "yellow")?.value ??
  HIGHLIGHT_COLORS[0]!.value

const CODE_BLOCK_LANGUAGES = [
  "javascript",
  "typescript",
  "json",
  "html",
  "css",
  "markdown",
  "bash",
  "yaml",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "sql",
  "graphql",
  "dockerfile",
]

const TABLE_PICKER_MAX_ROWS = 8
const TABLE_PICKER_MAX_COLS = 8
const TABLE_PICKER_ROWS = Array.from(
  { length: TABLE_PICKER_MAX_ROWS },
  (_, index) => index + 1
)
const TABLE_PICKER_COLS = Array.from(
  { length: TABLE_PICKER_MAX_COLS },
  (_, index) => index + 1
)

const sharedLowlight = createLowlight()
sharedLowlight.register({
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  graphql,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  ruby,
  rust,
  sql,
  typescript,
  xml,
  yaml,
})
sharedLowlight.registerAlias({
  javascript: ["js"],
  typescript: ["ts"],
  xml: ["html"],
  csharp: ["cs"],
  bash: ["sh", "shell"],
  markdown: ["md"],
})

const READING_WORDS_PER_MINUTE = 200
const MODEL_EMIT_DEBOUNCE_MS = 120

const createEmptyDoc = (): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph" }],
})

const isJSONDoc = (value: unknown): value is JSONContent =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "doc"

const stripLegacyMentionNodes = (node: JSONContent): JSONContent => {
  if (node.type === "mention") {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    const label =
      (typeof attrs.label === "string" && attrs.label.trim()) ||
      (typeof attrs.id === "string" && attrs.id.trim()) ||
      "mention"

    return {
      type: "text",
      text: `@${label}`,
    }
  }

  if (!node.content?.length) {
    return node
  }

  return {
    ...node,
    content: node.content.map((child) => stripLegacyMentionNodes(child)),
  }
}

const parseModelValue = (raw: string | undefined): JSONContent => {
  const trimmed = raw?.trim() ?? ""
  if (!trimmed.length) {
    return createEmptyDoc()
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (isJSONDoc(parsed)) {
      return stripLegacyMentionNodes(parsed)
    }
  } catch {
    // Fallback to paragraph text.
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

const isLinkDialogOpen = ref(false)
const linkDialogHref = ref<string | null>(null)
const isImageDialogOpen = ref(false)
const slashPanelState = ref<SlashCommandPanelState | null>(null)
const isTablePickerOpen = ref(false)
const dragHandleNodePos = ref<number | null>(null)
const tablePickerSelection = ref<{ rows: number; cols: number }>({
  rows: 0,
  cols: 0,
})
const tableOfContentsItems = shallowRef<TableOfContentData>([])
let tableOfContentsScrollParent: HTMLElement | Window = window

const getPanelPosition = (rect: DOMRect | null) => {
  if (!rect || typeof window === "undefined") {
    return { x: 0, y: 0 }
  }

  const panelWidth = 320
  const panelHeight = 280
  const x = Math.min(
    Math.max(8, rect.left),
    Math.max(8, window.innerWidth - panelWidth - 8)
  )
  const y = Math.min(
    rect.bottom + 8,
    Math.max(8, window.innerHeight - panelHeight - 8)
  )

  return { x, y }
}

const slashPanelPosition = computed(() =>
  getPanelPosition(slashPanelState.value?.clientRect ?? null)
)

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

const openLinkDialog = () => {
  const currentEditor = editor.value
  if (!currentEditor) {
    return
  }

  const href = currentEditor.getAttributes("link").href
  linkDialogHref.value = typeof href === "string" ? href : ""
  isLinkDialogOpen.value = true
}

const applyLinkFromDialog = (value: string) => {
  const currentEditor = editor.value
  if (!currentEditor) {
    return
  }

  const normalized = normalizeLinkHref(value)
  if (normalized === null) {
    showErrorToast("Invalid URL", "Please enter a valid URL.")
    return
  }

  const chain = currentEditor.chain().focus().extendMarkRange("link")
  if (!normalized.length) {
    chain.unsetLink().run()
    return
  }

  chain.setLink({ href: normalized }).run()
}

const removeLinkFromDialog = () => {
  editor.value?.chain().focus().extendMarkRange("link").unsetLink().run()
}

const openImageDialog = () => {
  isImageDialogOpen.value = true
}

const insertImageFromDialog = (attrs: {
  src: string
  align?: "left" | "center" | "right"
  width?: string
}) => {
  editor.value
    ?.chain()
    .focus()
    .insertContent({
      type: "image",
      attrs,
    })
    .run()
}

const updateTablePickerSelection = (rows: number, cols: number) => {
  tablePickerSelection.value = { rows, cols }
}

const clearTablePickerSelection = () => {
  tablePickerSelection.value = { rows: 0, cols: 0 }
}

const insertTableFromPicker = (rows: number, cols: number) => {
  editor.value
    ?.chain()
    .focus()
    .insertTable({ rows, cols, withHeaderRow: true })
    .run()

  isTablePickerOpen.value = false
  clearTablePickerSelection()
}

const createSlashCommands = (): SlashCommandItem[] => [
  {
    id: "heading-1",
    title: "Heading 1",
    description: "Large section title",
    group: "Headings",
    keywords: ["h1", "title"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleHeading({ level: 1 }).run()
    },
  },
  {
    id: "heading-2",
    title: "Heading 2",
    description: "Medium section title",
    group: "Headings",
    keywords: ["h2", "subtitle"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleHeading({ level: 2 }).run()
    },
  },
  {
    id: "heading-3",
    title: "Heading 3",
    description: "Small section title",
    group: "Headings",
    keywords: ["h3"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleHeading({ level: 3 }).run()
    },
  },
  {
    id: "bullet-list",
    title: "Bullet List",
    description: "Start an unordered list",
    group: "Lists",
    keywords: ["list", "ul"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleBulletList().run()
    },
  },
  {
    id: "ordered-list",
    title: "Numbered List",
    description: "Start an ordered list",
    group: "Lists",
    keywords: ["list", "ol", "numbered"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleOrderedList().run()
    },
  },
  {
    id: "task-list",
    title: "Task List",
    description: "Start a checklist",
    group: "Lists",
    keywords: ["todo", "checklist", "task"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleTaskList().run()
    },
  },
  {
    id: "blockquote",
    title: "Blockquote",
    description: "Add a quote block",
    group: "Blocks",
    keywords: ["quote"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleBlockquote().run()
    },
  },
  {
    id: "code-block",
    title: "Code Block",
    description: "Insert syntax-highlighted code",
    group: "Blocks",
    keywords: ["code", "snippet"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleCodeBlock().run()
    },
  },
  {
    id: "insert-image-url",
    title: "Image",
    description: "Insert image from URL",
    group: "Insert",
    keywords: ["image", "url", "media", "embed"],
    run: () => {
      openImageDialog()
    },
  },
  {
    id: "insert-table",
    title: "Table",
    description: "Insert a 3x3 table",
    group: "Insert",
    keywords: ["table", "grid"],
    run: (activeEditor) => {
      activeEditor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
    },
  },
  {
    id: "format-highlight",
    title: "Highlight",
    description: "Highlight selected text",
    group: "Formatting",
    keywords: ["highlight", "mark"],
    run: (activeEditor) => {
      activeEditor
        .chain()
        .focus()
        .setHighlight({ color: DEFAULT_HIGHLIGHT_COLOR })
        .run()
    },
  },
  {
    id: "format-text-color",
    title: "Text Color",
    description: "Apply a text color",
    group: "Formatting",
    keywords: ["color", "text"],
    run: (activeEditor) => {
      activeEditor.chain().focus().setColor(DEFAULT_TEXT_COLOR).run()
    },
  },
]

const slashCommandExtension = createSlashCommandExtension({
  items: createSlashCommands(),
  onChange: (state) => {
    slashPanelState.value = state
  },
})

const extensions = [
  StarterKit.configure({
    codeBlock: false,
    heading: {
      levels: [1, 2, 3],
    },
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
    },
    undoRedo: props.collaborationDoc ? false : {},
  }),
  Highlight.configure({ multicolor: true }),
  Underline,
  TextStyle,
  Color,
  Typography,
  Placeholder.configure({
    includeChildren: true,
    placeholder: "Type '/' for commands",
  }),
  TableOfContents.configure({
    getIndex: getHierarchicalIndexes,
    onUpdate: (items) => {
      tableOfContentsItems.value = items
    },
    scrollParent: () => tableOfContentsScrollParent,
  }),
  CharacterCount,
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  CodeBlockLowlight.configure({
    lowlight: sharedLowlight,
    defaultLanguage: "plaintext",
  }),
  Table.configure({
    resizable: true,
    allowTableNodeSelection: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  Subscript,
  Superscript,
  Details.configure({
    persist: true,
  }),
  DetailsSummary,
  DetailsContent,
  Mathematics.configure({}),
  RichImage,
  EmojiReplacer,
  slashCommandExtension,
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

const syncTableOfContentsScrollParent = (currentEditor: TiptapEditor) => {
  const storage = currentEditor.storage.tableOfContents as
    | TableOfContentsStorage
    | undefined

  if (!storage) {
    return
  }

  const nextScrollParent =
    (currentEditor.view.dom.closest(".os-viewport") as HTMLElement | null) ??
    window

  if (nextScrollParent === tableOfContentsScrollParent) {
    return
  }

  tableOfContentsScrollParent.removeEventListener(
    "scroll",
    storage.scrollHandler
  )
  tableOfContentsScrollParent = nextScrollParent
  tableOfContentsScrollParent.addEventListener("scroll", storage.scrollHandler)
}

const syncModelFromEditor = (
  currentEditor: TiptapEditor,
  options?: { immediate?: boolean }
) => {
  const serialized = serializeModelValue(currentEditor.getJSON())

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
        "tiptap prose prose-sm max-w-none dark:prose-invert p-16 focus:outline-none",
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

    syncTableOfContentsScrollParent(currentEditor)
    syncModelFromEditor(currentEditor, { immediate: true })
  },
  onUpdate: ({ editor: currentEditor }) => {
    syncModelFromEditor(currentEditor)
  },
})

onMounted(() => {
  const currentEditor = editor.value
  if (!currentEditor) {
    return
  }

  syncTableOfContentsScrollParent(currentEditor)
  currentEditor.commands.updateTableOfContents()
})

watch(
  () => props.modelValue,
  (value) => {
    const currentEditor = editor.value
    if (!currentEditor) {
      return
    }

    const normalizedIncoming = normalizeIncomingModelValue(value)
    if (normalizedIncoming === currentSerializedModelValue) {
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
  (next) => {
    editor.value?.setEditable(!next, false)
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

const selectSlashCommand = (index: number) => {
  slashPanelState.value?.execute(index)
}

const hoverSlashCommand = (index: number) => {
  if (!slashPanelState.value) {
    return
  }

  slashPanelState.value = {
    ...slashPanelState.value,
    selectedIndex: index,
  }
}

const tablePickerLabel = computed(() => {
  const { rows, cols } = tablePickerSelection.value
  if (!rows || !cols) {
    return "Select columns × rows"
  }

  return `${cols} × ${rows} columns × rows`
})

const currentBlockLabel = computed(() => {
  const activeEditor = editor.value
  if (!activeEditor) {
    return "Text"
  }

  if (activeEditor.isActive("heading", { level: 1 })) {
    return "H1"
  }

  if (activeEditor.isActive("heading", { level: 2 })) {
    return "H2"
  }

  if (activeEditor.isActive("heading", { level: 3 })) {
    return "H3"
  }

  if (activeEditor.isActive("blockquote")) {
    return "Quote"
  }

  if (activeEditor.isActive("codeBlock")) {
    return "Code"
  }

  return "Text"
})

const currentCodeLanguage = computed(() => {
  const activeEditor = editor.value
  if (!activeEditor?.isActive("codeBlock")) {
    return "auto"
  }

  const language = activeEditor.getAttributes("codeBlock").language
  return typeof language === "string" && language.trim().length
    ? language
    : "auto"
})

const setCodeLanguage = (language: unknown) => {
  const normalized = typeof language === "string" ? language : "auto"

  editor.value
    ?.chain()
    .focus()
    .updateAttributes("codeBlock", {
      language: normalized === "auto" ? null : normalized,
    })
    .run()
}

const applyImageAttrs = (attrs: Record<string, unknown>) => {
  editor.value?.chain().focus().updateAttributes("image", attrs).run()
}

const handleDragHandleNodeChange = ({ pos }: { pos: number }) => {
  dragHandleNodePos.value = pos >= 0 ? pos : null
}

const selectNodeFromDragHandle = () => {
  const currentEditor = editor.value
  const pos = dragHandleNodePos.value

  if (!currentEditor || pos === null) {
    return
  }

  currentEditor.chain().focus().setNodeSelection(pos).run()
}

const getTableOfContentsItemIndent = (level: number) =>
  `${Math.max(level - 1, 0) * 0.5 + 0.5}rem`

const scrollToTableOfContentsItem = (item: TableOfContentDataItem) => {
  item.dom.scrollIntoView({
    behavior: "smooth",
    block: "start",
    inline: "nearest",
  })
}
</script>

<template>
  <div class="absolute top-0 left-0 z-20 h-full p-2">
    <div class="sticky top-0 p-1.5">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="outline" size="icon-sm">
              <IconInfo />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {{ editorStats.characters }} chars · {{ editorStats.words }} words ·
            {{ editorStats.readingMinutes }} min read
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
  <div class="absolute top-0 right-0 z-20 h-full p-2">
    <aside
      class="sticky top-1/2 ml-auto flex h-max w-max -translate-y-1/2 flex-col items-end gap-2 overflow-auto p-2"
    >
      <div
        v-if="tableOfContentsItems.length"
        class="absolute top-1/2 flex -translate-y-1/2 flex-col items-end"
      >
        <div
          v-for="item in tableOfContentsItems"
          :key="item.id"
          class="group flex cursor-pointer py-1"
          @click="scrollToTableOfContentsItem(item)"
        >
          <span
            class="bg-sidebar-primary h-1 rounded-full opacity-25 group-hover:opacity-75"
            :style="{ width: getTableOfContentsItemIndent(item.level) }"
          >
          </span>
        </div>
      </div>
    </aside>
  </div>

  <EditorContent :editor="editor" />

  <BubbleMenu
    v-if="editor && !isReadOnly"
    :editor="editor"
    :tippy-options="{
      duration: 100,
      interactive: true,
      maxWidth: 'none',
      placement: 'top-start',
      offset: [0, 10],
    }"
  >
    <div
      class="bg-background/50 flex items-center gap-1 overflow-x-auto rounded-xl border p-1 shadow-xl backdrop-blur-lg"
    >
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="h-8 px-2.5 text-xs">
            {{ currentBlockLabel }}
            <IconChevronDown class="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            @click="editor?.chain().focus().setParagraph().run()"
          >
            Text
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
          >
            <IconHeading1 />
            Heading 1
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
          >
            <IconHeading2 />
            Heading 2
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
          >
            <IconHeading3 />
            Heading 3
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleBlockquote().run()"
          >
            <IconQuote />
            Blockquote
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleCodeBlock().run()"
          >
            <IconCode />
            Code block
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" class="mx-0.5 h-6" />

      <Toggle
        variant="outline"
        size="sm"
        :pressed="editor?.isActive('bold')"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        <IconBold />
      </Toggle>
      <Toggle
        variant="outline"
        size="sm"
        :pressed="editor?.isActive('italic')"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        <IconItalic />
      </Toggle>
      <Toggle
        variant="outline"
        size="sm"
        :pressed="editor?.isActive('underline')"
        @click="editor?.chain().focus().toggleUnderline().run()"
      >
        <IconUnderline />
      </Toggle>
      <Toggle
        variant="outline"
        size="sm"
        :pressed="editor?.isActive('strike')"
        @click="editor?.chain().focus().toggleStrike().run()"
      >
        <IconStrikethrough />
      </Toggle>
      <Toggle
        variant="outline"
        size="sm"
        :pressed="editor?.isActive('code')"
        @click="editor?.chain().focus().toggleCode().run()"
      >
        <IconBraces />
      </Toggle>

      <Separator orientation="vertical" class="mx-0.5 h-6" />

      <Toggle
        variant="outline"
        size="sm"
        :pressed="editor?.isActive('bulletList')"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        <IconList />
      </Toggle>
      <Toggle
        variant="outline"
        size="sm"
        :pressed="editor?.isActive('orderedList')"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        <IconListOrdered />
      </Toggle>
      <Toggle
        variant="outline"
        size="sm"
        :pressed="editor?.isActive('taskList')"
        @click="editor?.chain().focus().toggleTaskList().run()"
      >
        <IconListChecks />
      </Toggle>

      <Separator orientation="vertical" class="mx-0.5 h-6" />

      <TextEditorColorPicker
        :colors="TEXT_COLORS"
        :active-color="
          (editor?.getAttributes('textStyle').color as string | undefined) ??
          null
        "
        title="Text color"
        @select="editor?.chain().focus().setColor($event).run()"
        @clear="editor?.chain().focus().unsetColor().run()"
      >
        <template #trigger>
          <IconPalette />
        </template>
      </TextEditorColorPicker>

      <TextEditorColorPicker
        :colors="HIGHLIGHT_COLORS"
        :active-color="
          (editor?.getAttributes('highlight').color as string | undefined) ??
          null
        "
        title="Highlight"
        @select="editor?.chain().focus().setHighlight({ color: $event }).run()"
        @clear="editor?.chain().focus().unsetHighlight().run()"
      >
        <template #trigger>
          <IconHighlighter />
        </template>
      </TextEditorColorPicker>

      <Button variant="outline" size="icon-sm" @click="openLinkDialog">
        <IconLink />
      </Button>
      <Button
        v-if="editor?.isActive('link')"
        variant="outline"
        size="icon-sm"
        @click="
          editor?.chain().focus().extendMarkRange('link').unsetLink().run()
        "
      >
        <IconUnlink />
      </Button>

      <Button variant="outline" size="icon-sm" @click="openImageDialog">
        <IconImage />
      </Button>

      <Popover
        v-model:open="isTablePickerOpen"
        @update:open="!$event && clearTablePickerSelection()"
      >
        <PopoverTrigger as-child>
          <Button variant="outline" size="icon-sm">
            <IconTable />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" class="w-auto p-2">
          <div class="text-muted-foreground mb-2 text-xs font-medium">
            {{ tablePickerLabel }}
          </div>
          <div
            class="flex flex-col gap-1"
            @mouseleave="clearTablePickerSelection"
          >
            <div v-for="row in TABLE_PICKER_ROWS" :key="row" class="flex gap-1">
              <button
                v-for="col in TABLE_PICKER_COLS"
                :key="`${row}-${col}`"
                type="button"
                class="size-5 rounded-[2px] border transition-colors"
                :class="
                  col <= tablePickerSelection.cols &&
                  row <= tablePickerSelection.rows
                    ? 'border-accent bg-accent/30'
                    : 'border-border bg-background hover:bg-muted'
                "
                @mouseenter="updateTablePickerSelection(row, col)"
                @focus="updateTablePickerSelection(row, col)"
                @click="insertTableFromPicker(row, col)"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <DropdownMenu v-if="editor?.isActive('table')">
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="icon-sm">
            <IconTable />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel class="text-xs">Table</DropdownMenuLabel>
          <DropdownMenuItem
            @click="editor?.chain().focus().addRowBefore().run()"
          >
            Add row above
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().addRowAfter().run()"
          >
            Add row below
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().addColumnBefore().run()"
          >
            Add column left
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().addColumnAfter().run()"
          >
            Add column right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="editor?.chain().focus().deleteRow().run()">
            Delete row
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().deleteColumn().run()"
          >
            Delete column
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().deleteTable().run()"
          >
            Delete table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div v-if="editor?.isActive('codeBlock')" class="min-w-36">
        <Select
          :model-value="currentCodeLanguage"
          @update:model-value="setCodeLanguage"
        >
          <SelectTrigger class="h-8 w-full">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem
              v-for="language in CODE_BLOCK_LANGUAGES"
              :key="language"
              :value="language"
            >
              {{ language }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        v-if="editor?.isActive('image')"
        class="border-border/70 bg-muted/30 flex items-center gap-1 rounded-md border px-1 py-0.5"
      >
        <Button
          variant="ghost"
          size="sm"
          @click="applyImageAttrs({ align: 'left' })"
        >
          Left
        </Button>
        <Button
          variant="ghost"
          size="sm"
          @click="applyImageAttrs({ align: 'center' })"
        >
          Center
        </Button>
        <Button
          variant="ghost"
          size="sm"
          @click="applyImageAttrs({ align: 'right' })"
        >
          Right
        </Button>
        <Select
          :model-value="String(editor.getAttributes('image').width || '100%')"
          @update:model-value="applyImageAttrs({ width: $event })"
        >
          <SelectTrigger class="h-8 w-20">
            <SelectValue placeholder="Width" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="50%">50%</SelectItem>
            <SelectItem value="75%">75%</SelectItem>
            <SelectItem value="100%">100%</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator orientation="vertical" class="mx-0.5 h-6" />

      <Button
        variant="outline"
        size="icon-sm"
        :disabled="!editor?.can().undo()"
        @click="editor?.chain().focus().undo().run()"
      >
        <IconRotateCcw />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        :disabled="!editor?.can().redo()"
        @click="editor?.chain().focus().redo().run()"
      >
        <IconRefreshCw />
      </Button>
    </div>
  </BubbleMenu>

  <DragHandle
    v-if="editor && !isReadOnly"
    :editor="editor"
    :on-node-change="handleDragHandleNodeChange"
  >
    <Button
      variant="outline"
      size="icon-sm"
      class="mr-2 size-6"
      @click.stop="selectNodeFromDragHandle"
    >
      <IconGripVertical />
    </Button>
  </DragHandle>

  <TextEditorCommandPanel
    :open="Boolean(slashPanelState)"
    :x="slashPanelPosition.x"
    :y="slashPanelPosition.y"
    :items="slashPanelState?.items ?? []"
    :selected-index="slashPanelState?.selectedIndex ?? 0"
    label="Slash Commands"
    @select="selectSlashCommand"
    @hover="hoverSlashCommand"
  />

  <TextEditorLinkDialog
    v-model:open="isLinkDialogOpen"
    :initial-href="linkDialogHref"
    @submit="applyLinkFromDialog"
    @remove="removeLinkFromDialog"
  />

  <TextEditorImageDialog
    v-model:open="isImageDialogOpen"
    @insert="insertImageFromDialog"
  />
</template>

<style lang="scss">
.tiptap {
  min-height: 100%;
  font-synthesis: style;

  em,
  i {
    font-style: italic;
  }

  :first-child {
    margin-top: 0;
  }

  ul,
  ol {
    margin: 1.25rem 0.8rem;
    padding: 0 1rem;

    li p {
      margin-top: 0.25rem;
      margin-bottom: 0.25rem;
    }
  }

  [data-type="taskList"] {
    list-style: none;
    margin: 1.25rem 0;
    margin-left: 0;
    padding: 0;

    > li {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      margin: 0.25rem 0;

      > label {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: 1rem;
        height: 1rem;
        margin-top: 0.15rem;
        user-select: none;
        cursor: pointer;

        input[type="checkbox"] {
          width: 1rem;
          height: 1rem;
          margin: 0;
          opacity: 0;
          position: absolute;
          inset: 0;
          cursor: pointer;
          outline: none;
          z-index: 1;
        }

        > span {
          width: 1rem;
          height: 1rem;
          border: 1px solid var(--input);
          border-radius: 4px;
          background-color: var(--background);
          color: var(--primary-foreground);
          box-shadow: inset 0 0 0 0 var(--primary);
          transition:
            background-color 0.15s ease,
            border-color 0.15s ease,
            box-shadow 0.15s ease,
            color 0.15s ease;

          &::after {
            content: "";
            display: block;
            width: 0.3rem;
            height: 0.58rem;
            border-right: 2px solid currentColor;
            border-bottom: 2px solid currentColor;
            transform: translate(0.28rem, 0.1rem) rotate(45deg) scale(0);
            transform-origin: center;
            transition: transform 0.12s ease-in-out;
          }
        }

        input[type="checkbox"]:focus-visible + span {
          border-color: var(--ring);
          box-shadow: 0 0 0 3px
            color-mix(in oklab, var(--ring) 35%, transparent);
        }

        input[type="checkbox"]:checked + span {
          border-color: var(--primary);
          background-color: var(--primary);
        }

        input[type="checkbox"]:checked + span::after {
          transform: translate(0.28rem, 0.1rem) rotate(45deg) scale(1);
        }

        input[type="checkbox"]:disabled + span {
          opacity: 0.5;
        }

        input[type="checkbox"]:disabled {
          cursor: not-allowed;
        }
      }

      > div {
        flex: 1 1 auto;
        min-width: 0;
      }

      &[data-checked="true"] > div {
        color: var(--muted-foreground);
        text-decoration: line-through;
        text-decoration-thickness: 1px;
      }

      p {
        margin-top: 0.125rem;
        margin-bottom: 0.125rem;
      }
    }

    li ul,
    li ol {
      margin-top: 0.4rem;
      margin-bottom: 0.2rem;
    }
  }

  [data-type="details"] {
    display: flex;
    gap: 0.25rem;
    margin: 1.25rem 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.5rem;

    summary {
      font-weight: 600;
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
        background-color: var(--muted);
      }

      &::before {
        content: "\25B6";
      }
    }

    &.is-open > button::before {
      transform: rotate(90deg);
    }
  }

  .tableWrapper {
    margin: 1rem 0;
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    margin: 0;
    overflow: hidden;
    table-layout: fixed;
    width: 100%;
  }

  th,
  td {
    border: 1px solid var(--border);
    box-sizing: border-box;
    min-width: 1em;
    padding: 0.5rem 0.625rem;
    position: relative;
    vertical-align: top;
  }

  th {
    background: color-mix(in oklab, var(--muted) 80%, transparent);
    font-weight: 600;
    text-align: left;
  }

  th p,
  td p {
    margin: 0;
  }

  .selectedCell::after {
    background: color-mix(in oklab, var(--accent) 24%, transparent);
    content: "";
    inset: 0;
    pointer-events: none;
    position: absolute;
    z-index: 1;
  }

  .column-resize-handle {
    background: var(--ring);
    bottom: -2px;
    pointer-events: none;
    position: absolute;
    right: -2px;
    top: 0;
    width: 4px;
  }

  pre {
    background: color-mix(in oklab, var(--muted) 70%, transparent);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--foreground);
    font-family:
      var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco,
      Consolas, "Liberation Mono", "Courier New", monospace;
    margin: 1rem 0;
    overflow-x: auto;
    padding: 0.75rem 0.9rem;
  }

  code {
    background: color-mix(in oklab, var(--muted) 70%, transparent);
    border-radius: 0.25rem;
    font-size: 0.85em;
    padding: 0.1rem 0.35rem;
  }

  pre code {
    background: transparent;
    padding: 0;
  }

  .editor-image-node {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin: 1rem 0;
    max-width: 100%;
  }

  &[contenteditable="false"] {
    opacity: 0.7;
  }

  .collaboration-carets__caret {
    border-left: 1px solid #0d0d0d;
    border-right: 1px solid #0d0d0d;
    margin-left: -1px;
    margin-right: -1px;
    pointer-events: none;
    position: relative;
    word-break: normal;
  }

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

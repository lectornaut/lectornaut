<script lang="ts" setup>
import { type ColorOption } from "@/components/editors/text/components/TextEditorColorPicker.vue"
import { EmojiReplacer } from "@/components/editors/text/extensions/emojiReplacer"
import { RichImage } from "@/components/editors/text/extensions/richImage"
import {
  createSlashCommandExtension,
  type SlashCommandItem,
  type SlashCommandPanelState,
} from "@/components/editors/text/extensions/slashCommand"
import { useTiptapCollab } from "@/composables/useTiptapCollab"
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

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    modelValue?: string
    readOnly?: boolean
    collaborationDoc?: YDoc | null
    collaborationAwareness?: Awareness | null
    /**
     * A server-relayed agent edit to apply to the live collaborative document
     * (the editor's modelValue watcher is bypassed while collaborating, so
     * external content must come through this dedicated channel). Bumping
     * `seq` triggers a `setContent`; only the elected applier receives it.
     */
    externalContent?: { seq: number; content: string } | null
  }>(),
  {
    modelValue: "",
    readOnly: false,
    collaborationDoc: null,
    collaborationAwareness: null,
    externalContent: null,
  }
)

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
}>()

const EDITOR_COLORS = accents.filter(
  (accent) => accent.id !== "base" && accent.id !== "custom"
)

const TEXT_COLORS: ColorOption[] = EDITOR_COLORS.map((accent) => ({
  id: accent.id,
  name: accent.name,
  value: `var(--color-${accent.id}-500)`,
}))

const HIGHLIGHT_COLORS: ColorOption[] = EDITOR_COLORS.map((accent) => ({
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

const tiptapCollab =
  props.collaborationDoc && props.collaborationAwareness
    ? useTiptapCollab(props.collaborationDoc, props.collaborationAwareness)
    : null

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
    showErrorToast(
      t("components.textEditor.invalidUrl"),
      t("components.textEditor.invalidUrlDescription")
    )
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
    title: t("components.textEditor.slash.heading1Title"),
    description: t("components.textEditor.slash.heading1Description"),
    group: t("components.textEditor.slash.headingsGroup"),
    keywords: ["h1", "title"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleHeading({ level: 1 }).run()
    },
  },
  {
    id: "heading-2",
    title: t("components.textEditor.slash.heading2Title"),
    description: t("components.textEditor.slash.heading2Description"),
    group: t("components.textEditor.slash.headingsGroup"),
    keywords: ["h2", "subtitle"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleHeading({ level: 2 }).run()
    },
  },
  {
    id: "heading-3",
    title: t("components.textEditor.slash.heading3Title"),
    description: t("components.textEditor.slash.heading3Description"),
    group: t("components.textEditor.slash.headingsGroup"),
    keywords: ["h3"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleHeading({ level: 3 }).run()
    },
  },
  {
    id: "bullet-list",
    title: t("components.textEditor.slash.bulletListTitle"),
    description: t("components.textEditor.slash.bulletListDescription"),
    group: t("components.textEditor.slash.listsGroup"),
    keywords: ["list", "ul"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleBulletList().run()
    },
  },
  {
    id: "ordered-list",
    title: t("components.textEditor.slash.orderedListTitle"),
    description: t("components.textEditor.slash.orderedListDescription"),
    group: t("components.textEditor.slash.listsGroup"),
    keywords: ["list", "ol", "numbered"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleOrderedList().run()
    },
  },
  {
    id: "task-list",
    title: t("components.textEditor.slash.taskListTitle"),
    description: t("components.textEditor.slash.taskListDescription"),
    group: t("components.textEditor.slash.listsGroup"),
    keywords: ["todo", "checklist", "task"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleTaskList().run()
    },
  },
  {
    id: "blockquote",
    title: t("components.textEditor.slash.blockquoteTitle"),
    description: t("components.textEditor.slash.blockquoteDescription"),
    group: t("components.textEditor.slash.blocksGroup"),
    keywords: ["quote"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleBlockquote().run()
    },
  },
  {
    id: "code-block",
    title: t("components.textEditor.slash.codeBlockTitle"),
    description: t("components.textEditor.slash.codeBlockDescription"),
    group: t("components.textEditor.slash.blocksGroup"),
    keywords: ["code", "snippet"],
    run: (activeEditor) => {
      activeEditor.chain().focus().toggleCodeBlock().run()
    },
  },
  {
    id: "insert-image-url",
    title: t("components.textEditor.slash.imageTitle"),
    description: t("components.textEditor.slash.imageDescription"),
    group: t("components.textEditor.slash.insertGroup"),
    keywords: ["image", "url", "media", "embed"],
    run: () => {
      openImageDialog()
    },
  },
  {
    id: "insert-table",
    title: t("components.textEditor.slash.tableTitle"),
    description: t("components.textEditor.slash.tableDescription"),
    group: t("components.textEditor.slash.insertGroup"),
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
    title: t("components.textEditor.slash.highlightTitle"),
    description: t("components.textEditor.slash.highlightDescription"),
    group: t("components.textEditor.slash.formattingGroup"),
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
    title: t("components.textEditor.slash.textColorTitle"),
    description: t("components.textEditor.slash.textColorDescription"),
    group: t("components.textEditor.slash.formattingGroup"),
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
    placeholder: t("components.textEditor.typeForCommands"),
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

if (tiptapCollab) {
  extensions.push(...(tiptapCollab.extensions as (typeof extensions)[number][]))
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

    // When collaboration is active, Yjs owns the document state — skip
    // external modelValue writes to avoid clobbering collaborative edits
    if (props.collaborationDoc) {
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

// Apply a server-relayed agent edit (write docs). The modelValue watcher
// above is deliberately inert while collaborating ("Yjs owns the document
// state"), so agent edits arrive through this dedicated channel and are
// written into the shared doc via setContent — the Collaboration binding then
// syncs them to Yjs, out to other peers, and into the snapshot.
watch(
  () => props.externalContent?.seq,
  () => {
    const currentEditor = editor.value
    const external = props.externalContent
    if (!currentEditor || !external || !props.collaborationDoc) {
      return
    }
    try {
      currentEditor.commands.setContent(parseModelValue(external.content), {
        emitUpdate: true,
      })
      migrateMathStrings(currentEditor)
    } catch (error) {
      console.error("[TextEditor] Failed to apply external content:", error)
    }
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
    return t("components.textEditor.tableSelectLabel")
  }

  return t("components.textEditor.tablePickerLabel", { cols, rows })
})

const currentBlockLabel = computed(() => {
  const activeEditor = editor.value
  if (!activeEditor) {
    return t("components.textEditor.blockText")
  }

  if (activeEditor.isActive("heading", { level: 1 })) {
    return t("components.textEditor.blockH1")
  }

  if (activeEditor.isActive("heading", { level: 2 })) {
    return t("components.textEditor.blockH2")
  }

  if (activeEditor.isActive("heading", { level: 3 })) {
    return t("components.textEditor.blockH3")
  }

  if (activeEditor.isActive("blockquote")) {
    return t("components.textEditor.blockQuote")
  }

  if (activeEditor.isActive("codeBlock")) {
    return t("components.textEditor.blockCode")
  }

  return t("components.textEditor.blockText")
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
            <Button variant="outline" size="icon">
              <IconInfo />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {{
              t("components.textEditor.stats", {
                characters: editorStats.characters,
                words: editorStats.words,
                minutes: editorStats.readingMinutes,
              })
            }}
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
            class="bg-sidebar-primary h-1opacity-25 group-hover:opacity-75"
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
      class="bg-background/50 flex items-center gap-1 overflow-x-auto border p-1 shadow-xl backdrop-blur-lg"
    >
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" class="h-8 px-2.5 text-xs">
            {{ currentBlockLabel }}
            <IconChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-auto">
          <DropdownMenuItem
            @click="editor?.chain().focus().setParagraph().run()"
          >
            {{ t("components.textEditor.blockText") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
          >
            <IconHeading1 />
            {{ t("components.textEditor.heading1") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
          >
            <IconHeading2 />
            {{ t("components.textEditor.heading2") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
          >
            <IconHeading3 />
            {{ t("components.textEditor.heading3") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleBlockquote().run()"
          >
            <IconQuote />
            {{ t("components.textEditor.blockquote") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().toggleCodeBlock().run()"
          >
            <IconCode />
            {{ t("components.textEditor.codeBlock") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" />

      <Toggle
        variant="outline"
        :pressed="editor?.isActive('bold')"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        <IconBold />
      </Toggle>
      <Toggle
        variant="outline"
        :pressed="editor?.isActive('italic')"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        <IconItalic />
      </Toggle>
      <Toggle
        variant="outline"
        :pressed="editor?.isActive('underline')"
        @click="editor?.chain().focus().toggleUnderline().run()"
      >
        <IconUnderline />
      </Toggle>
      <Toggle
        variant="outline"
        :pressed="editor?.isActive('strike')"
        @click="editor?.chain().focus().toggleStrike().run()"
      >
        <IconStrikethrough />
      </Toggle>
      <Toggle
        variant="outline"
        :pressed="editor?.isActive('code')"
        @click="editor?.chain().focus().toggleCode().run()"
      >
        <IconBraces />
      </Toggle>

      <Separator orientation="vertical" />

      <Toggle
        variant="outline"
        :pressed="editor?.isActive('bulletList')"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        <IconList />
      </Toggle>
      <Toggle
        variant="outline"
        :pressed="editor?.isActive('orderedList')"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        <IconListOrdered />
      </Toggle>
      <Toggle
        variant="outline"
        :pressed="editor?.isActive('taskList')"
        @click="editor?.chain().focus().toggleTaskList().run()"
      >
        <IconListChecks />
      </Toggle>

      <Separator orientation="vertical" />

      <TextEditorColorPicker
        :colors="TEXT_COLORS"
        :active-color="
          (editor?.getAttributes('textStyle').color as string | undefined) ??
          null
        "
        :title="t('components.textEditor.textColorTitle')"
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
        :title="t('components.textEditor.highlightTitle')"
        @select="editor?.chain().focus().setHighlight({ color: $event }).run()"
        @clear="editor?.chain().focus().unsetHighlight().run()"
      >
        <template #trigger>
          <IconHighlighter />
        </template>
      </TextEditorColorPicker>

      <Button variant="outline" size="icon" @click="openLinkDialog">
        <IconLink />
      </Button>
      <Button
        v-if="editor?.isActive('link')"
        variant="outline"
        size="icon"
        @click="
          editor?.chain().focus().extendMarkRange('link').unsetLink().run()
        "
      >
        <IconUnlink />
      </Button>

      <Button variant="outline" size="icon" @click="openImageDialog">
        <IconImage />
      </Button>

      <Popover
        v-model:open="isTablePickerOpen"
        @update:open="!$event && clearTablePickerSelection()"
      >
        <PopoverTrigger as-child>
          <Button variant="outline" size="icon">
            <IconTable />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-2">
          <div class="text-muted-foreground mb-2 text-xs font-medium">
            {{ tablePickerLabel }}
          </div>
          <div
            class="flex flex-col gap-1"
            @mouseleave="clearTablePickerSelection"
          >
            <div v-for="row in TABLE_PICKER_ROWS" :key="row" class="flex gap-1">
              <Button
                v-for="col in TABLE_PICKER_COLS"
                :key="`${row}-${col}`"
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
          <Button variant="outline" size="icon">
            <IconTable />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-auto">
          <DropdownMenuLabel class="text-xs">{{
            t("components.textEditor.tableTitle")
          }}</DropdownMenuLabel>
          <DropdownMenuItem
            @click="editor?.chain().focus().addRowBefore().run()"
          >
            {{ t("components.textEditor.tableAddRowAbove") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().addRowAfter().run()"
          >
            {{ t("components.textEditor.tableAddRowBelow") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().addColumnBefore().run()"
          >
            {{ t("components.textEditor.tableAddColumnLeft") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().addColumnAfter().run()"
          >
            {{ t("components.textEditor.tableAddColumnRight") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="editor?.chain().focus().deleteRow().run()">
            {{ t("components.textEditor.tableDeleteRow") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().deleteColumn().run()"
          >
            {{ t("components.textEditor.tableDeleteColumn") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="editor?.chain().focus().deleteTable().run()"
          >
            {{ t("components.textEditor.tableDeleteTable") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div v-if="editor?.isActive('codeBlock')" class="min-w-36">
        <Select
          :model-value="currentCodeLanguage"
          @update:model-value="setCodeLanguage"
        >
          <SelectTrigger class="h-8 w-full">
            <SelectValue :placeholder="t('components.textEditor.language')" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="auto">{{
                t("components.textEditor.auto")
              }}</SelectItem>
              <SelectItem
                v-for="language in CODE_BLOCK_LANGUAGES"
                :key="language"
                :value="language"
              >
                {{ language }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div
        v-if="editor?.isActive('image')"
        class="border-border/70 bg-muted/30 flex items-center gap-1 border px-1 py-0.5"
      >
        <Button variant="ghost" @click="applyImageAttrs({ align: 'left' })">
          {{ t("components.textEditor.alignLeftButton") }}
        </Button>
        <Button variant="ghost" @click="applyImageAttrs({ align: 'center' })">
          {{ t("components.textEditor.alignCenterButton") }}
        </Button>
        <Button variant="ghost" @click="applyImageAttrs({ align: 'right' })">
          {{ t("components.textEditor.alignRightButton") }}
        </Button>
        <Select
          :model-value="String(editor.getAttributes('image').width || '100%')"
          @update:model-value="applyImageAttrs({ width: $event })"
        >
          <SelectTrigger class="h-8 w-20">
            <SelectValue :placeholder="t('components.textEditor.widthLabel')" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="50%">50%</SelectItem>
              <SelectItem value="75%">75%</SelectItem>
              <SelectItem value="100%">100%</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <Separator orientation="vertical" />

      <Button
        variant="outline"
        size="icon"
        :disabled="!editor?.can().undo()"
        @click="editor?.chain().focus().undo().run()"
      >
        <IconRotateCcw />
      </Button>
      <Button
        variant="outline"
        size="icon"
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
      size="icon"
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
    :label="t('components.textEditor.slashCommands')"
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

<style scoped>
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
          border: 1px solid var(--color-input);
          border-radius: 4px;
          background-color: var(--color-background);
          color: var(--color-primary-foreground);
          box-shadow: inset 0 0 0 0 var(--color-primary);
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
          border-color: var(--color-ring);
          box-shadow: 0 0 0 3px
            color-mix(in oklab, var(--color-ring) 35%, transparent);
        }

        input[type="checkbox"]:checked + span {
          border-color: var(--color-primary);
          background-color: var(--color-primary);
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
        color: var(--color-muted-foreground);
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
    border: 1px solid var(--color-border);
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
        background-color: var(--color-muted);
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
    border: 1px solid var(--color-border);
    box-sizing: border-box;
    min-width: 1em;
    padding: 0.5rem 0.625rem;
    position: relative;
    vertical-align: top;
  }

  th {
    background: color-mix(in oklab, var(--color-muted) 80%, transparent);
    font-weight: 600;
    text-align: left;
  }

  th p,
  td p {
    margin: 0;
  }

  .selectedCell::after {
    background: color-mix(in oklab, var(--color-accent) 24%, transparent);
    content: "";
    inset: 0;
    pointer-events: none;
    position: absolute;
    z-index: 1;
  }

  .column-resize-handle {
    background: var(--color-ring);
    bottom: -2px;
    pointer-events: none;
    position: absolute;
    right: -2px;
    top: 0;
    width: 4px;
  }

  pre {
    background: color-mix(in oklab, var(--color-muted) 70%, transparent);
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    margin: 1rem 0;
    overflow-x: auto;
    padding: 0.75rem 0.9rem;
  }

  code {
    background: color-mix(in oklab, var(--color-muted) 70%, transparent);
    border-radius: 0.25rem;
    font-size: 0.85em;
    padding: 0.1rem 0.35rem;
  }

  pre code {
    background: transparent;
    padding: 0;
  }

  .editor-image-node {
    border: 1px solid var(--color-border);
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

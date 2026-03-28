<script lang="ts" setup>
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import { javascript } from "@codemirror/lang-javascript"
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language"
import { lintKeymap } from "@codemirror/lint"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { Compartment, EditorState, type Extension } from "@codemirror/state"
import {
  placeholder as cmPlaceholder,
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"

// Supported language types (only installed packages)
export type SupportedLanguage =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "text"

// Props interface for better documentation
export interface CodeEditorProps {
  modelValue?: string
  readOnly?: boolean
  placeholder?: string
  extensions?: Extension[]
  language?: SupportedLanguage
  lineWrapping?: boolean
  tabSize?: number
  indentGuides?: boolean
}

const props = withDefaults(defineProps<CodeEditorProps>(), {
  modelValue: "",
  readOnly: false,
  placeholder: "Start document",
  extensions: () => [],
  language: "typescript",
  lineWrapping: false,
  tabSize: 2,
  indentGuides: false,
})

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
  (e: "ready", view: EditorView): void
  (e: "focus"): void
  (e: "blur"): void
}>()

// Use shallowRef for non-reactive EditorView reference
const editorContainer = ref<HTMLDivElement | null>(null)
const view = shallowRef<EditorView | null>(null)
const isReady = ref(false)

// Compartments for reconfigurable extensions
const editableCompartment = new Compartment()
const readOnlyCompartment = new Compartment()
const placeholderCompartment = new Compartment()
const extensionsCompartment = new Compartment()
const languageCompartment = new Compartment()
const lineWrappingCompartment = new Compartment()
const tabSizeCompartment = new Compartment()

// Adaptive debouncing constants
const MIN_DEBOUNCE_MS = 50
const MAX_DEBOUNCE_MS = 300
const DEBOUNCE_SIZE_THRESHOLD = 50000 // Characters

let modelEmitTimer: ReturnType<typeof setTimeout> | null = null
let pendingModelValue: string | null = null
let isUnmounting = false

/**
 * Calculate adaptive debounce delay based on document size
 */
const getAdaptiveDebounceMs = (docLength: number): number => {
  if (docLength < DEBOUNCE_SIZE_THRESHOLD) {
    return MIN_DEBOUNCE_MS
  }
  // Linear scaling between thresholds
  const scale = Math.min(docLength / (DEBOUNCE_SIZE_THRESHOLD * 4), 1)
  return Math.round(
    MIN_DEBOUNCE_MS + (MAX_DEBOUNCE_MS - MIN_DEBOUNCE_MS) * scale
  )
}

const flushModelEmit = () => {
  if (pendingModelValue === null || isUnmounting) {
    return
  }

  const value = pendingModelValue
  pendingModelValue = null
  emit("update:modelValue", value)
}

const scheduleModelEmit = (value: string) => {
  pendingModelValue = value

  if (modelEmitTimer !== null) {
    clearTimeout(modelEmitTimer)
  }

  const debounceMs = getAdaptiveDebounceMs(value.length)
  modelEmitTimer = setTimeout(() => {
    modelEmitTimer = null
    flushModelEmit()
  }, debounceMs)
}

/**
 * Get language extension based on language prop
 */
const getLanguageExtension = (lang: SupportedLanguage): Extension => {
  switch (lang) {
    case "javascript":
      return javascript()
    case "typescript":
      return javascript({ typescript: true })
    case "jsx":
      return javascript({ jsx: true })
    case "tsx":
      return javascript({ jsx: true, typescript: true })
    case "text":
    default:
      return []
  }
}

/**
 * Get indent guides extension
 */
const getIndentGuidesExtension = (): Extension => {
  return EditorView.theme({
    ".cm-line": {
      backgroundImage:
        "repeating-linear-gradient(to right, transparent, transparent calc(var(--indent-marker-width) - 1px), var(--color-border) calc(var(--indent-marker-width) - 1px), var(--color-border) var(--indent-marker-width))",
      backgroundSize: "var(--indent-marker-width) 100%",
      backgroundPosition: "left top",
    },
    "&": {
      "--indent-marker-width": "2ch",
    },
  })
}

/**
 * Editor theme styles - using object to avoid deep type instantiation
 */
const themeSpec = {
  "&": {
    background: "var(--color-background)",
    color: "var(--color-foreground)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
  },
  ".cm-content": {
    caretColor: "var(--color-foreground)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-primary)",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    background: "color-mix(in srgb, var(--color-primary) 24%, transparent)",
  },
  ".cm-gutters": {
    background: "var(--color-card)",
    color: "var(--color-muted-foreground)",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-activeLineGutter": {
    background: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
    color: "var(--color-foreground)",
  },
  ".cm-activeLine": {
    background: "color-mix(in srgb, var(--color-accent) 35%, transparent)",
  },
  ".cm-panels": {
    background: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    borderTop: "1px solid var(--color-border)",
  },
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.375rem",
    padding: "0.5rem",
  },
  ".cm-panel.cm-search br": {
    flexBasis: "100%",
    height: "0",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label":
    {
      margin: "0",
    },
  ".cm-panel.cm-search .cm-textfield": {
    flex: "1 1 12rem",
    height: "2.25rem",
    minWidth: "10rem",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-input)",
    background: "color-mix(in srgb, var(--color-background) 92%, transparent)",
    color: "var(--color-foreground)",
    padding: "0 0.75rem",
    fontFamily: "var(--font-sans)",
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
    outline: "none",
    transition: "border-color 120ms ease, box-shadow 120ms ease",
  },
  ".cm-panel.cm-search .cm-textfield::placeholder": {
    color: "var(--color-muted-foreground)",
  },
  ".cm-panel.cm-search .cm-textfield:focus": {
    borderColor: "var(--color-ring)",
    boxShadow:
      "0 0 0 3px color-mix(in srgb, var(--color-ring) 35%, transparent)",
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
    color: "var(--color-muted-foreground)",
    whiteSpace: "nowrap",
    fontFamily: "var(--font-sans)",
    fontSize: "0.75rem",
    lineHeight: "1",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    width: "0.875rem",
    height: "0.875rem",
    margin: "0",
    accentColor: "var(--color-primary)",
  },
  ".cm-panel.cm-search .cm-button": {
    textTransform: "capitalize",
    height: "2.25rem",
    borderRadius: "var(--radius)",
    border: "1px solid var(--color-border)",
    background: "var(--color-background)",
    color: "var(--color-foreground)",
    padding: "0 0.75rem",
    fontFamily: "var(--font-sans)",
    fontSize: "0.8125rem",
    fontWeight: "500",
    lineHeight: "1",
    cursor: "pointer",
    transition:
      "background-color 120ms ease, border-color 120ms ease, color 120ms ease",
  },
  ".cm-panel.cm-search .cm-button:hover": {
    background: "var(--color-accent)",
    color: "var(--color-accent-foreground)",
  },
  ".cm-panel.cm-search .cm-button:focus-visible": {
    outline: "none",
    borderColor: "var(--color-ring)",
    boxShadow:
      "0 0 0 3px color-mix(in srgb, var(--color-ring) 35%, transparent)",
  },
  ".cm-panel.cm-search [name=close]": {
    position: "static",
    marginLeft: "auto",
    width: "2rem",
    height: "2rem",
    borderRadius: "var(--radius)",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--color-muted-foreground)",
    fontFamily: "var(--font-sans)",
    fontSize: "1rem",
    lineHeight: "1",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition:
      "background-color 120ms ease, border-color 120ms ease, color 120ms ease",
  },
  ".cm-panel.cm-search [name=close]:hover": {
    background: "var(--color-accent)",
    color: "var(--color-accent-foreground)",
  },
  ".cm-panel.cm-search [name=close]:focus-visible": {
    outline: "none",
    borderColor: "var(--color-ring)",
    boxShadow:
      "0 0 0 3px color-mix(in srgb, var(--color-ring) 35%, transparent)",
  },
  ".cm-searchMatch": {
    background: "color-mix(in srgb, var(--color-ring) 25%, transparent)",
    outline: "1px solid var(--color-ring)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    background: "color-mix(in srgb, var(--color-primary) 30%, transparent)",
  },
  ".cm-tooltip": {
    background: "var(--color-popover)",
    color: "var(--color-popover-foreground)",
    border: "1px solid var(--color-border)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "color-mix(in srgb, var(--color-accent) 35%, transparent)",
    color: "var(--color-foreground)",
  },
  ".cm-ySelectionInfo": {
    opacity: "1",
    fontFamily: "var(--font-sans)",
    fontWeight: "600",
    borderRadius: "2px 2px 2px 0",
    padding: "2px 4px",
  },
  ".cm-ySelectionCaretDot": {
    opacity: "0",
  },
}

const editorTheme = EditorView.theme(themeSpec)

/**
 * Create update listener with error handling
 */
const createUpdateListener = () =>
  EditorView.updateListener.of((update) => {
    try {
      if (update.docChanged && !isUnmounting) {
        scheduleModelEmit(update.state.doc.toString())
      }
    } catch (error) {
      console.error("[CodeEditor] Error in update listener:", error)
    }
  })

/**
 * Create focus/blur event handlers
 */
const createFocusHandlers = (): Extension => {
  return EditorView.domEventHandlers({
    focus: () => {
      emit("focus")
    },
    blur: () => {
      emit("blur")
    },
  })
}

/**
 * Deep comparison for extensions array
 */
let extensionsCache: Extension[] = []
const areExtensionsEqual = (a: Extension[], b: Extension[]): boolean => {
  if (a.length !== b.length) return false
  return a.every((ext, i) => ext === b[i])
}

/**
 * Initialize the editor view
 */
const initializeEditor = () => {
  if (!editorContainer.value) {
    console.warn("[CodeEditor] Container element not found")
    return
  }

  try {
    const editorView = new EditorView({
      doc: props.modelValue ?? "",
      parent: editorContainer.value,
      extensions: [
        // Editable/ReadOnly state
        editableCompartment.of(EditorView.editable.of(!props.readOnly)),
        readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly)),

        // Placeholder text
        placeholderCompartment.of(cmPlaceholder(props.placeholder)),

        // Line wrapping
        lineWrappingCompartment.of(
          props.lineWrapping ? EditorView.lineWrapping : []
        ),

        // Tab size / indent unit
        tabSizeCompartment.of([
          EditorState.tabSize.of(props.tabSize),
          indentUnit.of(" ".repeat(props.tabSize)),
        ]),

        // A line number gutter
        lineNumbers(),

        // A gutter with code folding markers
        foldGutter(),

        // Replace non-printable characters with placeholders
        highlightSpecialChars(),

        // The undo history
        history(),

        // Replace native cursor/selection with our own
        drawSelection(),

        // Show a drop cursor when dragging over the editor
        dropCursor(),

        // Allow multiple cursors/selections
        EditorState.allowMultipleSelections.of(true),

        // Re-indent lines when typing specific input
        indentOnInput(),

        // Highlight syntax with a default style
        syntaxHighlighting(defaultHighlightStyle),

        // Language extension (lazy loaded)
        languageCompartment.of(getLanguageExtension(props.language)),

        // Highlight matching brackets near cursor
        bracketMatching(),

        // Automatically close brackets
        closeBrackets(),

        // Load the autocompletion system
        autocompletion(),

        // Allow alt-drag to select rectangular regions
        rectangularSelection(),

        // Change the cursor to a crosshair when holding alt
        crosshairCursor(),

        // Style the current line specially
        highlightActiveLine(),

        // Style the gutter for current line specially
        highlightActiveLineGutter(),

        // Highlight text that matches the selected text
        highlightSelectionMatches(),

        // Indent guides
        ...(props.indentGuides ? [getIndentGuidesExtension()] : []),

        // Emit updates
        createUpdateListener(),

        // Focus/blur event handlers
        createFocusHandlers(),

        // External extensions (ex: collaborative editing)
        extensionsCompartment.of(props.extensions ?? []),

        keymap.of([
          // Closed-brackets aware backspace
          ...closeBracketsKeymap,
          // A large set of basic bindings
          ...defaultKeymap,
          // Search-related keys
          ...searchKeymap,
          // Redo/undo keys
          ...historyKeymap,
          // Code folding bindings
          ...foldKeymap,
          // Autocompletion keys
          ...completionKeymap,
          // Keys related to the linter system
          ...lintKeymap,
          // Indent with tab
          indentWithTab,
        ]),

        // Theme
        editorTheme,
      ],
    })

    view.value = editorView
    isReady.value = true
    extensionsCache = props.extensions ?? []

    // Emit ready event with the view instance
    emit("ready", editorView)
  } catch (error) {
    console.error("[CodeEditor] Failed to initialize editor:", error)
  }
}

onMounted(() => {
  initializeEditor()
})

// Watch for modelValue changes (skip when collaborative extensions manage the doc)
watch(
  () => props.modelValue,
  (value) => {
    if (!view.value) return
    if (props.extensions.length > 0) return
    try {
      const current = view.value.state.doc.toString()
      if ((value ?? "") === current) return
      view.value.dispatch({
        changes: { from: 0, to: current.length, insert: value ?? "" },
      })
    } catch (error) {
      console.error("[CodeEditor] Error updating model value:", error)
    }
  }
)

// Watch for readOnly changes
watch(
  () => props.readOnly,
  (value) => {
    if (!view.value) return
    try {
      view.value.dispatch({
        effects: [
          editableCompartment.reconfigure(EditorView.editable.of(!value)),
          readOnlyCompartment.reconfigure(EditorState.readOnly.of(value)),
        ],
      })
    } catch (error) {
      console.error("[CodeEditor] Error updating readOnly:", error)
    }
  }
)

// Watch for placeholder changes
watch(
  () => props.placeholder,
  (value) => {
    if (!view.value) return
    try {
      view.value.dispatch({
        effects: placeholderCompartment.reconfigure(cmPlaceholder(value ?? "")),
      })
    } catch (error) {
      console.error("[CodeEditor] Error updating placeholder:", error)
    }
  }
)

// Watch for language changes
watch(
  () => props.language,
  (value) => {
    if (!view.value) return
    try {
      view.value.dispatch({
        effects: languageCompartment.reconfigure(
          getLanguageExtension(value ?? "typescript")
        ),
      })
    } catch (error) {
      console.error("[CodeEditor] Error updating language:", error)
    }
  }
)

// Watch for lineWrapping changes
watch(
  () => props.lineWrapping,
  (value) => {
    if (!view.value) return
    try {
      view.value.dispatch({
        effects: lineWrappingCompartment.reconfigure(
          value ? EditorView.lineWrapping : []
        ),
      })
    } catch (error) {
      console.error("[CodeEditor] Error updating lineWrapping:", error)
    }
  }
)

// Watch for tabSize changes
watch(
  () => props.tabSize,
  (value) => {
    if (!view.value) return
    try {
      view.value.dispatch({
        effects: tabSizeCompartment.reconfigure([
          EditorState.tabSize.of(value),
          indentUnit.of(" ".repeat(value)),
        ]),
      })
    } catch (error) {
      console.error("[CodeEditor] Error updating tabSize:", error)
    }
  }
)

// Watch for extensions changes with deep comparison
watch(
  () => props.extensions,
  (value) => {
    if (!view.value) return
    const newExtensions = value ?? []

    // Skip if extensions haven't actually changed
    if (areExtensionsEqual(extensionsCache, newExtensions)) {
      return
    }

    try {
      view.value.dispatch({
        effects: extensionsCompartment.reconfigure(newExtensions),
      })
      extensionsCache = newExtensions
    } catch (error) {
      console.error("[CodeEditor] Error updating extensions:", error)
    }
  }
)

// Cleanup on unmount
onBeforeUnmount(() => {
  if (modelEmitTimer !== null) {
    clearTimeout(modelEmitTimer)
    modelEmitTimer = null
  }

  // Flush any pending model updates before destroying
  if (pendingModelValue !== null) {
    emit("update:modelValue", pendingModelValue)
  }
  pendingModelValue = null

  isUnmounting = true

  if (view.value) {
    try {
      view.value.destroy()
    } catch (error) {
      console.error("[CodeEditor] Error destroying editor:", error)
    }
    view.value = null
  }
})

// Exposed methods for parent components
/**
 * Focus the editor
 */
const focus = () => {
  view.value?.focus()
}

/**
 * Blur the editor
 */
const blur = () => {
  view.value?.contentDOM.blur()
}

/**
 * Get the current selection range
 */
const getSelection = () => {
  if (!view.value) return null
  const { from, to } = view.value.state.selection.main
  return { from, to }
}

/**
 * Set the selection range
 */
const setSelection = (from: number, to?: number) => {
  if (!view.value) return
  view.value.dispatch({
    selection: { anchor: from, head: to ?? from },
  })
}

/**
 * Scroll to a specific position
 */
const scrollToPosition = (pos: number) => {
  if (!view.value) return
  view.value.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  })
}

/**
 * Scroll to a specific line
 */
const scrollToLine = (line: number) => {
  if (!view.value) return
  try {
    const lineInfo = view.value.state.doc.line(line)
    scrollToPosition(lineInfo.from)
  } catch (error) {
    console.error("[CodeEditor] Error scrolling to line:", error)
  }
}

/**
 * Get the current line count
 */
const getLineCount = () => {
  return view.value?.state.doc.lines ?? 0
}

/**
 * Get content at a specific line
 */
const getLineContent = (line: number) => {
  if (!view.value) return null
  try {
    return view.value.state.doc.line(line).text
  } catch {
    return null
  }
}

/**
 * Insert text at the current cursor position
 */
const insertText = (text: string) => {
  if (!view.value) return
  const { from } = view.value.state.selection.main
  view.value.dispatch({
    changes: { from, insert: text },
  })
}

/**
 * Replace the current selection with text
 */
const replaceSelection = (text: string) => {
  if (!view.value) return
  view.value.dispatch(view.value.state.replaceSelection(text))
}

/**
 * Get the EditorView instance
 */
const getView = () => view.value

/**
 * Get the EditorState instance
 */
const getState = () => view.value?.state ?? null

defineExpose({
  // View access
  getView,
  getState,
  isReady,

  // Focus management
  focus,
  blur,

  // Selection
  getSelection,
  setSelection,

  // Navigation
  scrollToPosition,
  scrollToLine,

  // Document info
  getLineCount,
  getLineContent,

  // Text manipulation
  insertText,
  replaceSelection,
})
</script>

<template>
  <div ref="editorContainer" class="code-editor"></div>
</template>

<style scoped>
.code-editor {
  display: flex;
  width: 100%;
  height: 100%;
}

.code-editor :deep(.cm-editor) {
  width: 100%;
  height: 100%;
}

.code-editor :deep(.cm-scroller) {
  height: 100%;
}
</style>

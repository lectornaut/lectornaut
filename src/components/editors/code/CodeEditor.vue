<script lang="ts" setup>
import {
  buildShikiSurfaceTheme,
  shikiConfig,
  shikiHighlightPlugin,
} from "@/components/editors/code/shikiHighlightPlugin"
import {
  activeCodeThemeName,
  detectLanguageFromFileName,
  ensureTheme,
} from "@/components/editors/text/shiki"
import {
  CODE_FONT_FAMILY,
  CODE_FONT_WEIGHT,
  useCodeFontSize,
} from "@/composables/useCodeFont"
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
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
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

// Props interface for better documentation
export interface CodeEditorProps {
  modelValue?: string
  readOnly?: boolean
  placeholder?: string
  extensions?: Extension[]
  /** File name; its extension drives language detection when `language` is unset. */
  fileName?: string
  /** Explicit Shiki language id override. When omitted, derived from `fileName`. */
  language?: string
  lineWrapping?: boolean
  tabSize?: number
  indentGuides?: boolean
}

const props = withDefaults(defineProps<CodeEditorProps>(), {
  modelValue: "",
  readOnly: false,
  placeholder: "Start document",
  extensions: () => [],
  fileName: "",
  language: undefined,
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
const surfaceCompartment = new Compartment()
const shikiConfigCompartment = new Compartment()
const fontSizeCompartment = new Compartment()

// Code font size (px) from the user's persisted Appearance setting
const codeFontSize = useCodeFontSize()

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
 * Force the model to reflect the LIVE document right now, cancelling any
 * pending debounced emit. Called before a save so the last keystrokes typed
 * within the debounce window aren't dropped from the persisted content.
 */
const flush = () => {
  if (modelEmitTimer !== null) {
    clearTimeout(modelEmitTimer)
    modelEmitTimer = null
  }
  pendingModelValue = null
  const live = view.value?.state.doc.toString()
  if (live !== undefined && live !== (props.modelValue ?? "")) {
    emit("update:modelValue", live)
  }
}

/** Effective Shiki language id: explicit `language` prop wins, else detected
 *  from the file extension via the shared registry. */
const effectiveLanguage = computed<string>(
  () => props.language ?? detectLanguageFromFileName(props.fileName)
)

/**
 * CodeMirror grammar for editing affordances only — indentation, bracket
 * matching, code folding. Token *colors* come from the Shiki plugin (which
 * covers every language); this just enriches editing for the handful of
 * languages we ship a CodeMirror grammar for. Others fall back to plain-text
 * editing behaviour while still being fully highlighted by Shiki.
 */
const getCmEditingExtension = (lang: string): Extension => {
  switch (lang) {
    case "javascript":
      return javascript()
    case "typescript":
      return javascript({ typescript: true })
    case "jsx":
      return javascript({ jsx: true })
    case "tsx":
      return javascript({ jsx: true, typescript: true })
    case "css":
      return css()
    case "html":
      return html()
    case "json":
      return json()
    case "markdown":
      return markdown()
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
  // NB: the editor surface (& / gutters bg + fg) is owned by the
  // surfaceCompartment so the active Shiki theme can take it over without a
  // shorthand-vs-longhand conflict. Everything below is chrome (app-themed).
  ".cm-scroller": {
    fontFamily: CODE_FONT_FAMILY,
  },
  ".cm-content": {
    caretColor: "var(--color-foreground)",
    fontWeight: String(CODE_FONT_WEIGHT),
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
    // bg owned by the surfaceCompartment surface (matches the editor bg)
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

        // Editing grammar (folding/indent/bracket-match) for the languages we
        // ship a CodeMirror grammar for; colors come from the Shiki plugin.
        languageCompartment.of(getCmEditingExtension(effectiveLanguage.value)),

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

        // Code font size (reactive to the user's Appearance setting)
        fontSizeCompartment.of(
          EditorView.theme({ "&": { fontSize: `${codeFontSize.value}px` } })
        ),

        // Editor surface (bg/fg/gutter) from the active Shiki theme. Placed
        // after `editorTheme` so its surface bg/fg wins. `preloadActiveCodeTheme`
        // (called at app bootstrap before mount) ensures the highlighter has
        // the active theme loaded by the time we get here, so `buildShikiSurfaceTheme`
        // resolves synchronously and the editor's first paint is already on
        // the right surface. The app-token fallback only kicks in on an
        // unrelated mount path where the preload was skipped or failed —
        // `applyShikiTheme()` in `onMounted` swaps it in once the load completes.
        surfaceCompartment.of(
          buildShikiSurfaceTheme(activeCodeThemeName.value) ??
            EditorView.theme({
              "&": {
                backgroundColor: "var(--color-background)",
                color: "var(--color-foreground)",
              },
            })
        ),

        // Token colors: pure-Shiki highlighting applied as decorations — the
        // same tokenizer the Tiptap code blocks and AppMarkdown use, so colors
        // match across all three surfaces. `shikiConfig` carries the active
        // theme + language; the plugin loads them lazily and re-tokenizes when
        // either changes.
        shikiConfigCompartment.of(
          shikiConfig.of({
            theme: activeCodeThemeName.value,
            language: effectiveLanguage.value,
          })
        ),
        shikiHighlightPlugin,
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

/**
 * Load the active Shiki editor theme and swap it into CodeMirror: the surface
 * (bg/fg/gutter) via its compartment, and the theme name into `shikiConfig` so
 * the highlight plugin re-tokenizes with it. Re-run whenever the theme or
 * light/dark mode changes.
 */
const applyShikiTheme = async () => {
  const name = activeCodeThemeName.value
  await ensureTheme(name)
  if (!view.value) return
  const surface = buildShikiSurfaceTheme(name)
  view.value.dispatch({
    effects: [
      ...(surface ? [surfaceCompartment.reconfigure(surface)] : []),
      shikiConfigCompartment.reconfigure(
        shikiConfig.of({ theme: name, language: effectiveLanguage.value })
      ),
    ],
  })
}

onMounted(() => {
  initializeEditor()
  void applyShikiTheme()
})

// Watch for modelValue changes (skip when collaborative extensions manage the
// doc). Gate on `extensionsCache` (what the view actually has installed), NOT
// `props.extensions` (what it's *about* to have): on a file switch both
// `modelValue` and `extensions` change in the same tick, this watcher fires
// before the extensions watcher reconfigures the compartment, so `props` would
// already show the new (empty) extensions while the OLD yCollab is still bound
// to the OLD Y.Text — writing the new file's content here would be echoed into
// the previous file's Y.Text and persisted as that file's snapshot.
watch(
  () => props.modelValue,
  (value) => {
    if (!view.value) return
    if (extensionsCache.length > 0) return
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

// Watch for language changes (file switch or explicit override): update both
// the editing grammar and the Shiki tokenizer's language.
watch(effectiveLanguage, (lang) => {
  if (!view.value) return
  try {
    view.value.dispatch({
      effects: [
        languageCompartment.reconfigure(getCmEditingExtension(lang)),
        shikiConfigCompartment.reconfigure(
          shikiConfig.of({ theme: activeCodeThemeName.value, language: lang })
        ),
      ],
    })
  } catch (error) {
    console.error("[CodeEditor] Error updating language:", error)
  }
})

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
      // Reconcile the doc to `modelValue` in the SAME transaction that swaps
      // the binding. yCollab's `ySync` plugin syncs the editor from *future*
      // Y.Text deltas only — it never reconciles the existing doc when it
      // (re)binds, assuming the doc already matches its Y.Text. On a collab
      // session swap (file switch) the freshly-bound plugin would otherwise
      // keep the previous file's text, since the `modelValue` watcher is
      // guarded off while collab extensions are present. By this flush
      // `modelValue` already holds the new session's text, so we push it in.
      // The plugin is constructed (not update()-ed) by this transaction, so it
      // won't echo the reset back into the new Y.Text.
      const current = view.value.state.doc.toString()
      const desired = props.modelValue ?? ""
      view.value.dispatch({
        changes:
          current === desired
            ? undefined
            : { from: 0, to: current.length, insert: desired },
        effects: extensionsCompartment.reconfigure(newExtensions),
      })
      extensionsCache = newExtensions
    } catch (error) {
      console.error("[CodeEditor] Error updating extensions:", error)
    }
  }
)

// Re-apply the Shiki theme when the editor theme (or light/dark) changes
watch(activeCodeThemeName, () => {
  void applyShikiTheme()
})

// Re-apply code font size when the Appearance setting changes
watch(codeFontSize, (size) => {
  if (!view.value) return
  try {
    view.value.dispatch({
      effects: fontSizeCompartment.reconfigure(
        EditorView.theme({ "&": { fontSize: `${size}px` } })
      ),
    })
  } catch (error) {
    console.error("[CodeEditor] Error updating font size:", error)
  }
})

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

  // Persistence
  flush,

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

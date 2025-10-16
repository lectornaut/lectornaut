<template>
  <div ref="editorContainer"></div>
</template>

<script setup lang="ts">
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
  syntaxHighlighting,
} from "@codemirror/language"
import { lintKeymap } from "@codemirror/lint"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { Compartment, EditorState } from "@codemirror/state"
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  placeholder as editorPlaceholder,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"

const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    language?: "javascript" | "json"
    readOnly?: boolean
  }>(),
  {
    modelValue: "",
    placeholder: "Start document",
    language: "javascript",
    readOnly: false,
  }
)

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
  (e: "blur"): void
}>()

const editorContainer = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

const placeholderCompartment = new Compartment()
const languageCompartment = new Compartment()
const editableCompartment = new Compartment()

const getLanguageExtension = (lang: "javascript" | "json") => {
  if (lang === "json") {
    return javascript({ json: true })
  }

  return javascript({ jsx: true, typescript: true })
}

const createExtensions = () => [
  placeholderCompartment.of(editorPlaceholder(props.placeholder)),
  lineNumbers(),
  foldGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle),
  languageCompartment.of(getLanguageExtension(props.language)),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
  ]),
  editableCompartment.of(EditorView.editable.of(!props.readOnly)),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const value = update.state.doc.toString()
      if (value !== props.modelValue) {
        emit("update:modelValue", value)
      }
    }
  }),
  EditorView.domEventHandlers({
    blur: () => emit("blur"),
  }),
  EditorView.theme({
    "&": {
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--size)",
    },
    ".cm-content": {
      caretColor: "var(--foreground)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--primary)",
    },
    ".cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in srgb, var(--primary) 24%, transparent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--card)",
      color: "var(--muted-foreground)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
      color: "var(--foreground)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--accent) 35%, transparent)",
    },
    ".cm-panels": {
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      borderTop: "1px solid var(--border)",
    },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, var(--ring) 25%, transparent)",
      outline: "1px solid var(--ring)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      border: "1px solid var(--border)",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: "color-mix(in srgb, var(--accent) 35%, transparent)",
        color: "var(--foreground)",
      },
    },
  }),
]

onMounted(() => {
  if (!editorContainer.value) return

  view = new EditorView({
    doc: props.modelValue ?? "",
    parent: editorContainer.value,
    extensions: createExtensions(),
  })
})

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const currentValue = view.state.doc.toString()
    const nextValue = value ?? ""
    if (nextValue !== currentValue) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: nextValue },
      })
    }
  }
)

watch(
  () => props.placeholder,
  (value) => {
    if (!view) return
    view.dispatch({
      effects: placeholderCompartment.reconfigure(editorPlaceholder(value)),
    })
  }
)

watch(
  () => props.language,
  (language) => {
    if (!view) return
    view.dispatch({
      effects: languageCompartment.reconfigure(getLanguageExtension(language)),
    })
  }
)

watch(
  () => props.readOnly,
  (isReadOnly) => {
    if (!view) return
    view.dispatch({
      effects: editableCompartment.reconfigure(
        EditorView.editable.of(!isReadOnly)
      ),
    })
  }
)

onBeforeUnmount(() => {
  if (view) {
    view.destroy()
    view = null
  }
})
</script>

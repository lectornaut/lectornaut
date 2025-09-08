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
import { EditorState } from "@codemirror/state"
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from "@codemirror/view"

const editorContainer = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

onMounted(() => {
  if (editorContainer.value) {
    view = new EditorView({
      doc: "",
      parent: editorContainer.value,
      extensions: [
        // Placeholder text
        placeholder("Start document"),
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
        // JavaScript syntax highlighting
        javascript({ jsx: true, typescript: true }),
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
            backgroundColor:
              "color-mix(in srgb, var(--primary) 24%, transparent)",
          },
          ".cm-gutters": {
            backgroundColor: "var(--card)",
            color: "var(--muted-foreground)",
            borderRight: "1px solid var(--border)",
          },
          ".cm-activeLineGutter": {
            backgroundColor:
              "color-mix(in srgb, var(--accent) 40%, transparent)",
            color: "var(--foreground)",
          },
          ".cm-activeLine": {
            backgroundColor:
              "color-mix(in srgb, var(--accent) 35%, transparent)",
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
              backgroundColor:
                "color-mix(in srgb, var(--accent) 35%, transparent)",
              color: "var(--foreground)",
            },
          },
        }),
      ],
    })
  }
})

onBeforeUnmount(() => {
  if (view) {
    view.destroy()
    view = null
  }
})
</script>

<template>
  <div class="space-y-2">
    <div v-if="$slots.run" class="flex justify-end">
      <slot
        name="run"
        :value="localValue"
        :validation="validationMessages"
        :focus="focus"
        :reset="reset"
        :run="run"
      />
    </div>
    <div ref="editorContainer" :style="editorStyle"></div>
    <div v-if="validationMessages.length" class="space-y-1 text-xs">
      <div
        v-for="(validation, index) in validationMessages"
        :key="index"
        :class="validationClass(validation.severity)"
      >
        {{ validation.message }}
      </div>
    </div>
  </div>
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
import { linter, lintKeymap } from "@codemirror/lint"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { Compartment, EditorState, type Extension } from "@codemirror/state"
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
  placeholder as placeholderExtension,
  rectangularSelection,
} from "@codemirror/view"

type ValidationSeverity = "error" | "warning" | "info"

export type CodeEditorValidationSeverity = ValidationSeverity

export interface CodeEditorValidationMessage {
  message: string
  severity?: ValidationSeverity
}

type ValidationResult =
  | string
  | CodeEditorValidationMessage
  | Array<string | CodeEditorValidationMessage>
  | null
  | undefined

export type CodeEditorValidator = (value: string) => ValidationResult

interface Props {
  modelValue?: string
  language?: string
  readOnly?: boolean
  placeholder?: string
  height?: string | number
  validators?: CodeEditorValidator | CodeEditorValidator[]
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: "",
  language: "typescript",
  readOnly: false,
  placeholder: "Start document",
})

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
  (e: "validation", value: CodeEditorValidationMessage[]): void
}>()

const editorContainer = ref<HTMLDivElement | null>(null)
const localValue = ref(props.modelValue)
const validationMessages = ref<CodeEditorValidationMessage[]>([])

const placeholderCompartment = new Compartment()
const languageCompartment = new Compartment()
const readOnlyCompartment = new Compartment()
const lintCompartment = new Compartment()

let view: EditorView | null = null

const validators = computed<CodeEditorValidator[]>(() => {
  const source = props.validators
  if (!source) return []
  const list = Array.isArray(source) ? source : [source]
  return list.filter(
    (fn): fn is CodeEditorValidator => typeof fn === "function"
  )
})

const normalizedHeight = computed(() => {
  const { height } = props
  if (height === undefined || height === null || height === "") {
    return ""
  }
  return typeof height === "number" ? `${height}px` : height
})

const editorStyle = computed(() =>
  normalizedHeight.value ? { height: normalizedHeight.value } : undefined
)

const severityClasses: Record<ValidationSeverity, string> = {
  error: "text-destructive",
  warning: "text-amber-500",
  info: "text-muted-foreground",
}

const validationClass = (severity: ValidationSeverity = "error") =>
  severityClasses[severity] ?? severityClasses.error

function resolveLanguageExtension(language: string | undefined): Extension {
  switch (language) {
    case "javascript":
      return javascript({ jsx: true })
    case "jsx":
      return javascript({ jsx: true })
    case "tsx":
      return javascript({ jsx: true, typescript: true })
    case "typescript":
      return javascript({ jsx: true, typescript: true })
    default:
      return javascript({ jsx: true, typescript: true })
  }
}

function normalizeMessage(
  message: string | CodeEditorValidationMessage
): CodeEditorValidationMessage | null {
  if (typeof message === "string") {
    const trimmed = message.trim()
    return trimmed ? { message: trimmed, severity: "error" } : null
  }

  const trimmed = message.message?.trim()
  if (!trimmed) {
    return null
  }

  return {
    message: trimmed,
    severity: message.severity ?? "error",
  }
}

function applyValidators(value: string): CodeEditorValidationMessage[] {
  if (!validators.value.length) {
    return []
  }

  return validators.value.flatMap((validator) => {
    const result = validator(value)
    if (!result) {
      return []
    }

    const entries = Array.isArray(result) ? result : [result]
    return entries
      .map(normalizeMessage)
      .filter((item): item is CodeEditorValidationMessage => item !== null)
  })
}

function runValidation(value: string) {
  const messages = applyValidators(value)
  validationMessages.value = messages
  emit("validation", messages)
  return messages
}

function createLintExtension(): Extension {
  if (!validators.value.length) {
    return [] as unknown as Extension
  }

  return linter((lintView) =>
    applyValidators(lintView.state.doc.toString()).map((message) => ({
      from: 0,
      to: lintView.state.doc.length,
      severity: message.severity ?? "error",
      message: message.message,
    }))
  )
}

function setEditorValue(value: string) {
  localValue.value = value
  if (!view) {
    return
  }

  const currentValue = view.state.doc.toString()
  if (currentValue === value) {
    return
  }

  const cursorPosition = Math.min(value.length, view.state.selection.main.head)

  view.dispatch({
    changes: { from: 0, to: currentValue.length, insert: value },
    selection: { anchor: cursorPosition },
  })
}

const focus = () => {
  view?.focus()
}

const reset = (value = "") => {
  setEditorValue(value)
  emit("update:modelValue", value)
  runValidation(value)
}

const run = (value?: string) => runValidation(value ?? localValue.value)

defineExpose({ focus, reset, run })

watch(
  () => props.modelValue,
  (value) => {
    const next = value ?? ""
    if (next === localValue.value) {
      return
    }

    setEditorValue(next)
    runValidation(next)
  }
)

watch(
  () => props.placeholder,
  (value) => {
    if (!view) {
      return
    }

    view.dispatch({
      effects: placeholderCompartment.reconfigure(
        placeholderExtension(value ?? "")
      ),
    })
  }
)

watch(
  () => props.readOnly,
  (value) => {
    if (!view) {
      return
    }

    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorView.editable.of(!value)),
    })
  }
)

watch(
  () => props.language,
  (value) => {
    if (!view) {
      return
    }

    view.dispatch({
      effects: languageCompartment.reconfigure(resolveLanguageExtension(value)),
    })
  }
)

watch(validators, () => {
  if (!view) {
    return
  }

  view.dispatch({
    effects: lintCompartment.reconfigure(createLintExtension()),
  })
  runValidation(view.state.doc.toString())
})

onMounted(() => {
  if (!editorContainer.value) {
    return
  }

  view = new EditorView({
    doc: localValue.value,
    parent: editorContainer.value,
    extensions: [
      placeholderCompartment.of(placeholderExtension(props.placeholder ?? "")),
      readOnlyCompartment.of(EditorView.editable.of(!props.readOnly)),
      languageCompartment.of(resolveLanguageExtension(props.language)),
      lintCompartment.of(createLintExtension()),
      lineNumbers(),
      foldGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle),
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
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return
        }

        const value = update.state.doc.toString()
        localValue.value = value
        emit("update:modelValue", value)
        runValidation(value)
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
          backgroundColor:
            "color-mix(in srgb, var(--primary) 24%, transparent)",
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
            backgroundColor:
              "color-mix(in srgb, var(--accent) 35%, transparent)",
            color: "var(--foreground)",
          },
        },
      }),
    ],
  })

  runValidation(localValue.value)
})

onBeforeUnmount(() => {
  if (view) {
    view.destroy()
    view = null
  }
})
</script>

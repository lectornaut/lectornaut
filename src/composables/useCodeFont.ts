/**
 * Shared code typography tokens for every editor surface (CodeEditor /
 * CodeMirror, TextEditor / Tiptap code blocks, AppMarkdown / Shiki) so they
 * stay in lockstep: the app mono stack, a fixed weight, and the user's
 * persisted font-size preference.
 */
import { defaultEditorFontSize, editorFontSizes } from "@/helpers/defaults"
import { editorFontSize } from "@/modules/theme"
import { computed, type ComputedRef } from "vue"

/** Weight used for code everywhere; shared by every code surface. */
export const CODE_FONT_WEIGHT = 500

/** App monospace stack (CSS var), applied by the CodeMirror surface. The
 *  markstream Shiki blocks point `--markstream-code-font-family` at the same
 *  `--font-mono` in CSS, so every code surface shares one font. */
export const CODE_FONT_FAMILY = "var(--font-mono)"

/** Resolve a font-size preset id to its px value (falls back to the default). */
export const resolveCodeFontSize = (id: string): number =>
  (
    editorFontSizes.find((entry) => entry.id === id) ??
    editorFontSizes.find((entry) => entry.id === defaultEditorFontSize)
  )?.size ?? 13

/** Reactive code font size (px) from the user's persisted Appearance setting. */
export const useCodeFontSize = (): ComputedRef<number> =>
  computed(() => resolveCodeFontSize(editorFontSize.value))

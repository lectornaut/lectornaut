/**
 * Tiptap code-block extension that highlights via Shiki, using the same
 * persisted editor theme as AppMarkdown's Shiki code blocks. Highlighting is
 * applied as ProseMirror decorations (inline color/font-style) over the live,
 * still-editable text — the editable counterpart to those read-only Shiki
 * surfaces.
 *
 * Shiki is async (highlighter + grammar load) whereas the decoration pass is
 * sync, so blocks render unstyled for a tick until the plugin `view` has loaded
 * the needed theme/language, then a forced refresh re-decorates. Theme switches
 * (editor-theme setting or light/dark) flow through the same refresh.
 */
import { tokenStyleToCss } from "@/components/editors/shared/shikiTokenStyle"
import TextEditorCodeBlock from "@/components/editors/text/components/TextEditorCodeBlock.vue"
import {
  activeCodeThemeName,
  ensureHighlighter,
  ensureLanguage,
  ensureTheme,
  getHighlighter,
  PLAINTEXT_LANGUAGE,
  startCodeThemeColorSync,
} from "@/components/editors/text/shiki"
import { findChildren } from "@tiptap/core"
import CodeBlock from "@tiptap/extension-code-block"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { VueNodeViewRenderer } from "@tiptap/vue-3"
import type { BundledLanguage } from "shiki"
import { watch, type WatchStopHandle } from "vue"

const shikiPluginKey = new PluginKey<DecorationSet>("codeBlockShiki")

const buildDecorations = (
  doc: ProseMirrorNode,
  nodeName: string
): DecorationSet => {
  const highlighter = getHighlighter()
  if (!highlighter) return DecorationSet.empty

  const theme = activeCodeThemeName.value
  if (!highlighter.getLoadedThemes().includes(theme)) return DecorationSet.empty

  const decorations: Decoration[] = []

  findChildren(doc, (node) => node.type.name === nodeName).forEach(
    ({ node, pos }) => {
      const language =
        typeof node.attrs.language === "string" ? node.attrs.language : ""

      // No language (auto/plaintext) → no token decorations; Shiki can't
      // auto-detect, and the surface foreground (set in the NodeView) already
      // colors the text. Also skip until the grammar is actually loaded.
      if (!language || language === PLAINTEXT_LANGUAGE) return
      if (!highlighter.getLoadedLanguages().includes(language)) return

      let lines
      try {
        lines = highlighter.codeToTokens(node.textContent, {
          lang: language as BundledLanguage,
          theme,
        }).tokens
      } catch {
        return
      }

      // `token.offset` is the char index into the same string we tokenized
      // (node.textContent), and ProseMirror counts one position per UTF-16
      // unit too — so `pos + 1 + offset` maps a token onto its doc range.
      const codeStart = pos + 1
      for (const line of lines) {
        for (const token of line) {
          if (!token.content) continue
          const from = codeStart + token.offset
          const to = from + token.content.length
          const style = tokenStyleToCss(token.color, token.fontStyle ?? 0)
          if (style) decorations.push(Decoration.inline(from, to, { style }))
        }
      }
    }
  )

  return DecorationSet.create(doc, decorations)
}

const forceRefresh = (view: EditorView): void => {
  if (view.isDestroyed) return
  view.dispatch(view.state.tr.setMeta(shikiPluginKey, { force: true }))
}

// Load the active theme + every language used in the doc, then refresh if
// anything newly loaded (ensure* resolve false when already present, so this is
// a no-op on ordinary edits).
const ensureResources = async (
  view: EditorView,
  nodeName: string
): Promise<void> => {
  const languages = new Set<string>()
  view.state.doc.descendants((node) => {
    if (
      node.type.name === nodeName &&
      typeof node.attrs.language === "string"
    ) {
      languages.add(node.attrs.language)
    }
  })

  const results = await Promise.all([
    ensureTheme(activeCodeThemeName.value),
    ...[...languages].map((language) => ensureLanguage(language)),
  ])

  if (results.some(Boolean)) forceRefresh(view)
}

export const CodeBlockShiki = CodeBlock.extend({
  addStorage() {
    return { stopThemeWatch: null as WatchStopHandle | null }
  },

  // Node view kept on the extension itself (not a second `.extend()` in
  // TextEditor.vue): re-extending re-runs addProseMirrorPlugins via the parent
  // chain, which would add this keyed plugin twice → ProseMirror RangeError.
  addNodeView() {
    // The `*.vue` import resolves to a generic component type that doesn't
    // structurally satisfy `Component<NodeViewProps>` from a .ts file; the
    // component does take `nodeViewProps`, so narrow to the expected param.
    return VueNodeViewRenderer(
      TextEditorCodeBlock as Parameters<typeof VueNodeViewRenderer>[0]
    )
  },

  addProseMirrorPlugins() {
    const nodeName = this.name

    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: shikiPluginKey,
        state: {
          init: (_config, { doc }) => buildDecorations(doc, nodeName),
          apply(tr, decorationSet, _oldState, newState) {
            if (tr.docChanged || tr.getMeta(shikiPluginKey)?.force) {
              return buildDecorations(newState.doc, nodeName)
            }
            return decorationSet.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return shikiPluginKey.getState(state)
          },
        },
        view: (view) => {
          void ensureHighlighter().then(() => ensureResources(view, nodeName))
          return {
            update: (updatedView, prevState) => {
              if (updatedView.state.doc !== prevState.doc) {
                void ensureResources(updatedView, nodeName)
              }
            },
          }
        },
      }),
    ]
  },

  onCreate() {
    startCodeThemeColorSync()
    const editor = this.editor
    // Re-decorate when the active theme changes (editor-theme setting or the
    // light/dark mode it pairs with — `activeCodeThemeName` tracks both).
    this.storage.stopThemeWatch = watch(activeCodeThemeName, async (name) => {
      await ensureTheme(name)
      forceRefresh(editor.view)
    })
  },

  onDestroy() {
    this.storage.stopThemeWatch?.()
  },
})

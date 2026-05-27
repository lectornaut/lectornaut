/**
 * Pure-Shiki syntax highlighting for CodeMirror.
 *
 * Every code surface in the app now tokenizes through Shiki — the read-only
 * read-only markdown blocks (AppMarkdown), the editable Tiptap code blocks
 * (`extensions/codeBlockShiki.ts`), and this CodeMirror editor — so token
 * colors match exactly across all three. Highlighting is applied as CodeMirror
 * `Decoration.mark` ranges carrying the same inline style Tiptap emits (shared
 * `tokenStyleToCss`), driven by the same persisted `editorTheme`.
 *
 * Shiki is async (highlighter + grammar/theme load) and `codeToTokens` is the
 * heavy step, so the work is split:
 *   • tokenize the WHOLE doc → a cached token model. Runs only on edits and on
 *     theme/language changes (and once the async loader signals ready).
 *   • build the visible `DecorationSet` from that cache, scoped to
 *     `view.visibleRanges`. Runs additionally on scroll — cheap, no re-tokenize.
 */
import { tokenStyleToCss } from "@/components/editors/shared/shikiTokenStyle"
import {
  ensureHighlighter,
  ensureLanguage,
  ensureTheme,
  getHighlighter,
  PLAINTEXT_LANGUAGE,
} from "@/components/editors/text/shiki"
import {
  Facet,
  RangeSetBuilder,
  StateEffect,
  type Extension,
} from "@codemirror/state"
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import type { BundledLanguage } from "shiki"

/** Active theme + language the plugin tokenizes against. CodeEditor supplies
 *  this through a compartment and reconfigures it on theme / file changes. */
export interface ShikiConfig {
  /** Shiki theme name (the resolved light/dark variant of `editorTheme`). */
  theme: string
  /** Shiki bundled grammar id, or `plaintext` for no highlighting. */
  language: string
}

export const shikiConfig = Facet.define<ShikiConfig, ShikiConfig>({
  combine: (values) => values[0] ?? { theme: "", language: PLAINTEXT_LANGUAGE },
})

/** Dispatched once the async highlighter/theme/grammar load completes, so the
 *  plugin re-tokenizes a doc that first rendered before Shiki was ready. */
const shikiRefreshEffect = StateEffect.define<null>()

interface CachedToken {
  from: number
  to: number
  style: string
}

class ShikiHighlightPlugin {
  decorations: DecorationSet
  private tokens: CachedToken[] = []
  // Reuse one Decoration per distinct style string (a token color repeats
  // thousands of times in a file) so the RangeSet dedupes by reference.
  private readonly markCache = new Map<string, Decoration>()

  constructor(view: EditorView) {
    this.tokens = this.tokenize(view)
    this.decorations = this.buildVisibleDecorations(view)
    void this.ensureResources(view)
  }

  update(update: ViewUpdate): void {
    const configChanged =
      update.startState.facet(shikiConfig) !== update.state.facet(shikiConfig)
    const refreshed = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(shikiRefreshEffect))
    )

    if (update.docChanged || configChanged) {
      void this.ensureResources(update.view)
    }
    if (update.docChanged || configChanged || refreshed) {
      this.tokens = this.tokenize(update.view)
    }
    if (
      update.docChanged ||
      configChanged ||
      refreshed ||
      update.viewportChanged
    ) {
      this.decorations = this.buildVisibleDecorations(update.view)
    }
  }

  /** Re-tokenize the whole document. Empty until the highlighter has the
   *  active theme + grammar loaded (the loader triggers a refresh). */
  private tokenize(view: EditorView): CachedToken[] {
    const { theme, language } = view.state.facet(shikiConfig)
    const highlighter = getHighlighter()
    if (
      !highlighter ||
      !theme ||
      !language ||
      language === PLAINTEXT_LANGUAGE ||
      !highlighter.getLoadedThemes().includes(theme) ||
      !highlighter.getLoadedLanguages().includes(language)
    ) {
      return []
    }

    let lines
    try {
      lines = highlighter.codeToTokens(view.state.doc.toString(), {
        lang: language as BundledLanguage,
        theme,
      }).tokens
    } catch {
      return []
    }

    const tokens: CachedToken[] = []
    for (const line of lines) {
      for (const token of line) {
        if (!token.content) continue
        const style = tokenStyleToCss(token.color, token.fontStyle ?? 0)
        if (!style) continue
        // `token.offset` is the absolute char index into the tokenized string
        // (the whole doc); CodeMirror counts one position per UTF-16 unit too,
        // so the offsets map straight onto document positions.
        tokens.push({
          from: token.offset,
          to: token.offset + token.content.length,
          style,
        })
      }
    }
    return tokens
  }

  /** Build a DecorationSet from the cached tokens, scoped to what's on screen.
   *  Tokens are document-ordered and non-overlapping, so a single pass with a
   *  visible-range cursor keeps the RangeSetBuilder's required sort order. */
  private buildVisibleDecorations(view: EditorView): DecorationSet {
    if (!this.tokens.length) return Decoration.none

    const builder = new RangeSetBuilder<Decoration>()
    const ranges = view.visibleRanges
    const docLength = view.state.doc.length
    let rangeIndex = 0

    for (const token of this.tokens) {
      if (token.from >= docLength) break
      while (
        rangeIndex < ranges.length &&
        token.from >= ranges[rangeIndex]!.to
      ) {
        rangeIndex++
      }
      if (rangeIndex >= ranges.length) break
      if (token.to <= ranges[rangeIndex]!.from) continue

      const to = Math.min(token.to, docLength)
      if (to <= token.from) continue
      builder.add(token.from, to, this.mark(token.style))
    }

    return builder.finish()
  }

  private mark(style: string): Decoration {
    let decoration = this.markCache.get(style)
    if (!decoration) {
      decoration = Decoration.mark({ attributes: { style } })
      this.markCache.set(style, decoration)
    }
    return decoration
  }

  /** Lazy-load the active theme + grammar; refresh once anything newly loads
   *  (ensure* resolve false when already present, so this no-ops on edits). */
  private async ensureResources(view: EditorView): Promise<void> {
    const { theme, language } = view.state.facet(shikiConfig)
    await ensureHighlighter()
    const [themeLoaded, languageLoaded] = await Promise.all([
      ensureTheme(theme),
      ensureLanguage(language),
    ])
    if ((themeLoaded || languageLoaded) && view.dom.isConnected) {
      view.dispatch({ effects: shikiRefreshEffect.of(null) })
    }
  }
}

export const shikiHighlightPlugin = ViewPlugin.fromClass(ShikiHighlightPlugin, {
  decorations: (plugin) => plugin.decorations,
})

/**
 * Editor surface (background + foreground + gutter bg) from a loaded Shiki
 * theme, so the CodeMirror canvas matches the AppMarkdown / Tiptap code surfaces.
 * Returns null until the highlighter has the theme loaded (callers re-run once
 * it is). Token colors come from `shikiHighlightPlugin`, not from here.
 */
export const buildShikiSurfaceTheme = (themeName: string): Extension | null => {
  const highlighter = getHighlighter()
  if (!highlighter || !highlighter.getLoadedThemes().includes(themeName)) {
    return null
  }

  const theme = highlighter.getTheme(themeName)
  const fg = theme.fg || "inherit"
  const bg = theme.bg || "inherit"

  return EditorView.theme(
    {
      "&": { backgroundColor: bg, color: fg },
      ".cm-gutters": { backgroundColor: bg },
    },
    { dark: theme.type === "dark" }
  )
}

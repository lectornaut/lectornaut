/**
 * Shared Shiki runtime + language metadata for the editable code surfaces
 * (CodeMirror and Tiptap). Mirrors the theming AppMarkdown.vue uses for its
 * Shiki code blocks: the user's persisted
 * `editorTheme` resolves to a light/dark Shiki theme pair, and the active
 * variant is chosen by the resolved color mode. Themes and grammars load lazily
 * (on demand) so startup isn't burdened with all ~36 themes / 300+ languages.
 */
import { editorThemes } from "@/helpers/defaults"
import { state as colorMode, editorTheme } from "@/modules/theme"
import {
  bundledLanguages,
  bundledLanguagesInfo,
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
} from "shiki"
import { computed, ref, watch } from "vue"

/** Shiki's id for "no specific language" — renders without token highlighting. */
export const PLAINTEXT_LANGUAGE = "plaintext"

export interface CodeLanguageOption {
  /** Shiki bundled grammar id (also what's stored on a Tiptap code block). */
  id: string
  /** Human-readable display name, for the language picker. */
  name: string
}

/**
 * Every language Shiki bundles, sorted by display name — the full set the
 * Tiptap code-block picker offers. Sourced straight from Shiki
 * (`bundledLanguagesInfo`), so there is no curated list to maintain and every
 * surface gets Shiki's complete language support.
 */
export const CODE_LANGUAGES: readonly CodeLanguageOption[] =
  bundledLanguagesInfo
    .map((lang) => ({ id: lang.id, name: lang.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

// id + every alias → canonical bundled id, built from Shiki's own metadata, so
// a stored value or a file extension resolves to a grammar id without a
// hand-maintained map.
const LANGUAGE_ID_BY_TOKEN = new Map<string, string>()
for (const lang of bundledLanguagesInfo) {
  LANGUAGE_ID_BY_TOKEN.set(lang.id, lang.id)
  for (const alias of lang.aliases ?? []) {
    LANGUAGE_ID_BY_TOKEN.set(alias, lang.id)
  }
}

/** Canonical bundled id for an id/alias, else plaintext if Shiki can't place it. */
export const normalizeLanguageId = (
  value: string | null | undefined
): string =>
  value
    ? (LANGUAGE_ID_BY_TOKEN.get(value) ?? PLAINTEXT_LANGUAGE)
    : PLAINTEXT_LANGUAGE

/**
 * Detect a Shiki language from a file name's extension by matching it against
 * Shiki's own ids + aliases (`py`→python, `rs`→rust, `kt`→kotlin, …). There's
 * no curated extension map, so a few multi-extension cases (`.cc`, `.hpp`,
 * `.htm`) fall back to plaintext.
 */
export const detectLanguageFromFileName = (fileName: string): string => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? ""
  return ext
    ? (LANGUAGE_ID_BY_TOKEN.get(ext) ?? PLAINTEXT_LANGUAGE)
    : PLAINTEXT_LANGUAGE
}

const ALL_THEME_NAMES: string[] = [
  ...new Set(editorThemes.flatMap((theme) => [theme.light, theme.dark])),
]

/**
 * Active Shiki theme name: the persisted editor theme's light/dark variant,
 * selected by the resolved color mode — the same pairing AppMarkdown applies.
 */
export const activeCodeThemeName = computed(() => {
  const pair =
    editorThemes.find((theme) => theme.id === editorTheme.value) ??
    editorThemes[0]
  return colorMode.value === "dark" ? pair.dark : pair.light
})

let highlighterInstance: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null

export const ensureHighlighter = (): Promise<Highlighter> => {
  highlighterPromise ??= createHighlighter({ themes: [], langs: [] }).then(
    (instance) => {
      highlighterInstance = instance
      return instance
    }
  )
  return highlighterPromise
}

/** The resolved highlighter, or null until the async load completes. The
 *  decoration pass is synchronous, so it reads this and skips (re-running once
 *  the loader signals ready) when it isn't available yet. */
export const getHighlighter = (): Highlighter | null => highlighterInstance

const loadedThemes = new Set<string>()
const loadedLanguages = new Set<string>()

/** Load a theme grammar if needed. Resolves to true only when it *newly*
 *  loaded, so callers can avoid redundant re-highlight passes. */
export const ensureTheme = async (theme: string): Promise<boolean> => {
  const instance = await ensureHighlighter()
  if (loadedThemes.has(theme) || instance.getLoadedThemes().includes(theme)) {
    return false
  }
  if (!ALL_THEME_NAMES.includes(theme)) return false
  try {
    await instance.loadTheme(theme as BundledTheme)
    loadedThemes.add(theme)
    return true
  } catch {
    return false
  }
}

/** Load a language grammar if needed. Resolves true only on a *new* load. */
export const ensureLanguage = async (language: string): Promise<boolean> => {
  if (!language || language === PLAINTEXT_LANGUAGE) return false
  const instance = await ensureHighlighter()
  if (
    loadedLanguages.has(language) ||
    instance.getLoadedLanguages().includes(language)
  ) {
    return false
  }
  if (!(language in bundledLanguages)) return false
  try {
    await instance.loadLanguage(language as BundledLanguage)
    loadedLanguages.add(language)
    return true
  } catch {
    return false
  }
}

/** Background + foreground of the active theme, for the code-block surface
 *  ("full match" with the markdown blocks). Updated whenever the active theme
 *  changes; the NodeView reads it reactively. */
export const activeCodeThemeColors = ref<{ bg: string; fg: string }>({
  bg: "",
  fg: "",
})

/** Load `name` and populate `activeCodeThemeColors` from it. Shared between the
 *  one-shot startup preload (main.ts, before any editor mounts) and the
 *  watcher below (re-runs on every theme/light-dark switch). */
const syncCodeThemeColors = async (name: string): Promise<void> => {
  await ensureTheme(name)
  const instance = getHighlighter()
  if (!instance) return
  try {
    const theme = instance.getTheme(name)
    activeCodeThemeColors.value = { bg: theme.bg ?? "", fg: theme.fg ?? "" }
  } catch {
    /* theme unavailable — keep previous colors */
  }
}

/** Block app mount until the active editor theme is loaded and
 *  `activeCodeThemeColors` is populated, so the first frame the Tiptap /
 *  CodeMirror / markstream surfaces render is already on the Shiki theme
 *  surface. Without this, all three flash a fallback surface (prose muted /
 *  app background / library muted) for the tick the async highlighter takes
 *  to load the theme. Idempotent — safe to await more than once. */
export const preloadActiveCodeTheme = (): Promise<void> =>
  syncCodeThemeColors(activeCodeThemeName.value)

let colorSyncStarted = false
export const startCodeThemeColorSync = (): void => {
  if (colorSyncStarted) return
  colorSyncStarted = true
  watch(activeCodeThemeName, (name) => void syncCodeThemeColors(name), {
    immediate: true,
  })
}

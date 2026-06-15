<script lang="ts" setup>
/**
 * AppMarkdown — single entry point for every markdown surface in the
 * app. Wraps `markstream-vue` with the shared config (theme tracking,
 * code-block highlighting, html policy, animation behaviour) so each
 * consumer only picks a `surface` + supplies `content`/`final`.
 *
 * Surfaces share a `data-custom-id` attribute that global rules in
 * `@/styles/index.css` ("markstream-vue surface overrides") key off to
 * apply per-surface `--ms-*` typography overrides. They live there, not
 * in a scoped block here, because they target markstream's library-
 * rendered DOM — which a component's `[data-v-*]` scope can't reach.
 *
 * Streaming vs history is driven entirely off `final`:
 *   • final=false (chat tail mid-stream) → smooth pacing on,
 *     typewriter cursor off, fade off (would flicker against
 *     280ms pacing windows).
 *   • final=true (chat history + every other surface) → fade on for a
 *     polished entry, no pacing, no cursor.
 */
import {
  activeCodeThemeColors,
  startCodeThemeColorSync,
} from "@/components/editors/text/shiki"
import { useCodeFontSize } from "@/composables/useCodeFont"
import { editorThemes } from "@/helpers/defaults"
import { editorTheme, state as resolvedTheme } from "@/modules/theme"
import MarkdownRender from "markstream-vue"
// Registers every markstream custom-component override exactly once
// (ES-module singleton) — see the module for why this isn't inline here.
// markstream + KaTeX base CSS now live in `@/styles/index.css` (layered),
// loaded at app startup, instead of being imported from this component.
import "@/components/app/markdown/registerMarkdownOverrides"

export type AppMarkdownSurface = "chat" | "changelog-sheet" | "changelog-page"

const props = withDefaults(
  defineProps<{
    surface: AppMarkdownSurface
    content: string
    final?: boolean
  }>(),
  { final: true }
)

const isDark = computed(() => resolvedTheme.value === "dark")

// `final=false` only happens on the chat streaming tail (other surfaces
// default to true). Driving the streaming-vs-history prop set off a
// single boolean keeps the toggle atomic — Vue swaps all three props in
// the same patch when `final` flips. (The typewriter cursor used to ride
// this boolean too; it's now hard-off — see `:typewriter` in the template.)
const streaming = computed(() => !props.final)

const customHtmlTags = computed(() =>
  props.surface === "chat" ? ["thinking"] : undefined
)

// Virtualization caps how many nodes render live. The streaming chat tail
// (final=false) uses 0 — incremental/typewriter mode — so freshly streamed
// text is never hidden behind a windowing measurement pass. Every other
// case falls back to the library default (320) so a single very long doc
// (e.g. a huge code/JSON dump) windows instead of mounting every node at
// once. Finalized chat history passes the default too, but the deferral
// switch below turns the windowing path off for chat regardless, so the
// cap is effectively inert there.
const maxLiveNodes = computed(() =>
  props.surface === "chat" && !props.final ? 0 : undefined
)

// Viewport-based node deferral (library default ON) unmounts nodes that
// aren't near the viewport and re-runs that pass on every container resize
// (internal ResizeObserver). Fine for static prose — but the chat surface
// renders interactive `<thinking>` disclosures (BotThinkingBlock). When one
// expands, the container grows, the observer re-runs the windowing pass, and
// a SIBLING disclosure gets judged off-viewport and culled — it visibly
// disappears. Turning deferral off for chat keeps every node mounted, so
// expanding one block can never hide another. Other surfaces keep the
// default: their content is static, so deferral is a pure scrollback win.
const deferNodesUntilVisible = computed(() =>
  props.surface === "chat" ? false : undefined
)

// HTML policy by content provenance: LLM output is `safe` (blocks
// active/embed/form tags); author-written changelog content is
// `trusted` so we can use `<Kbd >`, `<details>`, `<sup>`, `<video>`.
const htmlPolicy = computed<"safe" | "trusted">(() =>
  props.surface === "chat" ? "safe" : "trusted"
)

// Mermaid: keep strict mode everywhere (prevents click-handler abuse).
// Chat gets the bare minimum to stay compact inside narrow bubbles.
// Changelog (especially the landing page) opens up zoom/pan/export
// controls so users can actually read complex architecture diagrams.
const mermaidProps = computed(() => {
  if (props.surface === "chat") return { isStrict: true }
  if (props.surface === "changelog-sheet") {
    return { isStrict: true, showCopyButton: true }
  }
  return {
    isStrict: true,
    enableMermaidInteractions: true,
    enableWheelZoom: true,
    showZoomControls: true,
    showCopyButton: true,
    showExportButton: true,
    showFullscreenButton: true,
  }
})

// Editor (code-block) syntax theme. The user picks a Shiki family in
// Appearance settings (persisted in user scope); we resolve it to its
// light + dark variant and hand BOTH to markstream, which switches between
// them via `:is-dark` — the same mechanism every surface already uses for
// the theme pair. An unknown/legacy id (e.g. a removed family synced from
// another device) falls back to the first entry ("Default" =
// light-plus/dark-plus), preserving the pre-setting behaviour.
const codeBlockThemes = computed(
  () =>
    editorThemes.find((theme) => theme.id === editorTheme.value) ??
    editorThemes[0]
)

// Preload EVERY selectable variant into markstream's Shiki runtime
// (a cached singleton highlighter — one-time cost, not per block). The
// library only reliably swaps between *preregistered* themes; without this
// list, changing the editor-theme setting asks the highlighter to apply a
// theme it never loaded, so the block silently keeps the previous one. Listing all
// variants guarantees the active light/dark pair is already registered when
// markstream calls setTheme on a switch.
const codeBlockThemeNames = editorThemes.flatMap((theme) => [
  theme.light,
  theme.dark,
])

// Code blocks get a header strip with a copy button — same on every
// surface. The library handles the DOM; we just turn it on. Every other
// header action defaults to ON in markstream, so the ones we don't want
// (expand, font-size steppers, HTML preview) must be explicitly opted out.
const codeBlockProps = {
  showHeader: true,
  showCopyButton: true,
  showExpandButton: false,
  showFontSizeButtons: false,
  showPreviewButton: false,
} as const

// Code blocks render through markstream's Shiki node (MarkdownCodeBlockNode,
// wired in registerMarkdownOverrides) — driven by the same Shiki themes the
// CodeMirror and Tiptap surfaces use, so all three match. Display-only: the
// node emits static highlighted HTML, with no editor runtime.
//
// Font family + weight and the tall-payload height cap live in CSS (the
// "markstream-vue surface overrides" block in @/styles/index.css). Font SIZE
// rides in as the `--vscode-editor-font-size` custom property — set via the
// `:style` fallthrough on `<MarkdownRender>` so it lands on `.markstream-vue`
// and cascades down to `.code-block-content`. A `!important` rule in that
// same overrides block then forces it onto `.code-block-content`, because the
// library hard-binds an inline `style="font-size: 14px"` from a local ref
// with no prop to override it — making its own `font-size:
// var(--vscode-editor-font-size)` CSS rule dead code. `!important` beats the
// unimportant inline style.
const codeBlockFontSize = useCodeFontSize()

const codeBlockFontVars = computed(() => ({
  "--vscode-editor-font-size": `${codeBlockFontSize.value}px`,
}))

// Match the outer `.code-block-container` to the ACTIVE Shiki theme's own
// background/foreground. markstream paints the Shiki `<pre>` with the theme
// background but leaves the surrounding container on the library default
// (`--code-bg: hsl(var(--ms-muted))`); the scroll viewport between them is
// transparent, so a macOS overscroll rubber-band exposes that muted strip
// "beneath" the themed code. Overriding `--code-bg`/`--code-fg` on the root
// (inline beats the library's `.markstream-vue` rule, then cascades to the
// container) collapses container, viewport and `<pre>` to one color, so the
// bounce is seamless. Same colors the Tiptap surface adopts in
// TextEditorCodeBlock.vue — a "full match" across every code surface.
//
// The watcher that fills `activeCodeThemeColors` is started here (idempotent)
// because its only other caller is the Tiptap code-block extension, which never
// mounts on the chat / changelog surfaces. Colors are empty until the theme
// loads, so the first tick falls back to the library default.
startCodeThemeColorSync()
const codeBlockColorVars = computed(() => {
  const { bg, fg } = activeCodeThemeColors.value
  return {
    ...(bg ? { "--code-bg": bg } : {}),
    ...(fg ? { "--code-fg": fg } : {}),
  }
})

// Smooth-streaming pacing: only meaningful when streaming. Floor/ceiling
// keep the visible cadence within the band the human eye reads
// comfortably; targetLatencyMs is the buffer the pacer aims to hold
// against bursty server chunks.
const smoothStreamingOptions = {
  minCharsPerSecond: 60,
  maxCharsPerSecond: 240,
  targetLatencyMs: 250,
} as const

// Link previews in chat would be noisy (every bot reply often has
// multiple URLs); changelog pages benefit from full-URL hover. Off
// for the sheet to match its compact density.
const showTooltips = computed(() => props.surface === "changelog-page")

// Surfaces parse/render timing and virtualization stats to the console.
// Free in production (tree-shaken via `import.meta.env.DEV`), useful
// the next time streaming feels janky.
const isDev = import.meta.env.DEV
</script>

<template>
  <MarkdownRender
    :custom-id="surface"
    :content="content"
    :final="final"
    :is-dark="isDark"
    :html-policy="htmlPolicy"
    :code-block-light-theme="codeBlockThemes.light"
    :code-block-dark-theme="codeBlockThemes.dark"
    :themes="codeBlockThemeNames"
    :code-block-props="codeBlockProps"
    :style="[codeBlockFontVars, codeBlockColorVars]"
    :mermaid-props="mermaidProps"
    :custom-html-tags="customHtmlTags"
    :smooth-streaming="streaming ? 'auto' : false"
    :smooth-streaming-options="smoothStreamingOptions"
    :fade="!streaming"
    :typewriter="false"
    :max-live-nodes="maxLiveNodes"
    :defer-nodes-until-visible="deferNodesUntilVisible"
    :show-tooltips="showTooltips"
    :debug-performance="isDev"
  />
</template>

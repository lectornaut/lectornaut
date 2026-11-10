<script lang="ts" setup>
import "@/styles/markdown.css" // markstream + KaTeX ship with this chunk, not the entry CSS
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
 *   • final=true → no pacing, no cursor. Chat history also renders in ONE
 *     synchronous pass with no fade: the `chat` preset's idle-scheduled
 *     render batches, multiplied across every bubble, made a session switch
 *     paint empty bubbles that filled in over many frames. Fade stays on
 *     only for the changelog surfaces.
 */
import {
  activeCodeThemeColors,
  startCodeThemeColorSync,
} from "@/components/editors/text/shiki"
import {
  CODE_FONT_FAMILY,
  CODE_FONT_WEIGHT,
  useCodeFontSize,
} from "@/composables/useCodeFont"
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

// Renderer preset, per the docs: `chat` for AI/SSE output, `docs` for rich
// long-form content. A preset only fills in defaults — every prop passed
// explicitly below still wins. `chat` brings incremental rendering
// (`maxLiveNodes: 0`, so streamed text is never hidden behind a windowing
// pass), smaller/faster render batches, and no tooltips; `docs` keeps
// virtualization so a very long changelog windows instead of mounting every
// node at once. The mode is fixed per surface, never switched on `final` —
// the docs warn that `docs` changes layout strategy mid-message; streaming
// vs history is handled by the pacing/fade props instead.
const mode = computed(() => (props.surface === "chat" ? "chat" : "docs"))

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

// The pair markstream loads into its Shiki runtime (a cached singleton
// highlighter — one-time cost, not per block). markstream 2 types `themes`
// as `[dark, light]` and loads exactly what it is handed, so the active pair
// is registered on every switch. v1 needed the opposite: it only swapped
// between *preregistered* themes, so we listed every selectable variant or
// the block silently kept the previous one. That preload list is gone —
// don't reintroduce it, v2 rejects anything but a two-element tuple.
const codeBlockThemePair = computed<[dark: string, light: string]>(() => [
  codeBlockThemes.value.dark,
  codeBlockThemes.value.light,
])

// Code blocks get a header strip with a copy button — same on every
// surface. Every other header action defaults to ON in markstream, so the
// ones we don't want (expand, font-size steppers, HTML preview) must be
// explicitly opted out. `theme` is the documented v2 way to hand the
// renderer its light/dark pair (the top-level `code-block-*-theme` props
// feed CodeBlockNode's deprecated `lightTheme`/`darkTheme`).
const codeBlockProps = computed(() => ({
  showHeader: true,
  showCopyButton: true,
  showExpandButton: false,
  showFontSizeButtons: false,
  showPreviewButton: false,
  theme: {
    light: codeBlockThemes.value.light,
    dark: codeBlockThemes.value.dark,
  },
}))

// Code blocks render through markstream's built-in code_block node (the
// lazy, viewport-deferred CodeBlockNode backed by the `stream-diffs` peer),
// driven by the same Shiki themes the CodeMirror and Tiptap surfaces use, so
// all three match. Typography goes through `code-block-options` — the
// documented v2 surface — because the highlighted output is drawn by
// stream-diffs inside a shadow root, out of reach of page CSS. Weight has no
// dedicated option, so it rides in through `unsafeCSS` (injected into that
// shadow root); bold Shiki tokens carry their own weight and stay bold.
const codeBlockFontSize = useCodeFontSize()

const codeBlockOptions = computed(() => ({
  fontSize: codeBlockFontSize.value,
  fontFamily: CODE_FONT_FAMILY,
  unsafeCSS: `pre { font-weight: ${CODE_FONT_WEIGHT}; }`,
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
// Blocks only — INLINE code deliberately stays on prose colors (see the
// `--inline-code-*` overrides in @/styles/index.css): a full Shiki-theme
// surface on an inline chip reads as a mini code block mid-sentence.
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
// for the sheet to match its compact density — explicit because the
// sheet's `docs` preset would otherwise turn them on.
const showTooltips = computed(() => props.surface === "changelog-page")
</script>

<template>
  <MarkdownRender
    :custom-id="surface"
    :mode="mode"
    :content="content"
    :final="final"
    :is-dark="isDark"
    :html-policy="htmlPolicy"
    :themes="codeBlockThemePair"
    :code-block-props="codeBlockProps"
    :code-block-options="codeBlockOptions"
    :style="codeBlockColorVars"
    :mermaid-props="mermaidProps"
    :custom-html-tags="customHtmlTags"
    :smooth-streaming="streaming ? 'auto' : false"
    :smooth-streaming-options="smoothStreamingOptions"
    :fade="surface !== 'chat'"
    :batch-rendering="surface === 'chat' ? streaming : undefined"
    :defer-nodes-until-visible="deferNodesUntilVisible"
    :show-tooltips="showTooltips"
  />
</template>

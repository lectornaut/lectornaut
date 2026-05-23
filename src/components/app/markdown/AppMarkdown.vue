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
 *     typewriter cursor visible, fade off (would flicker against
 *     280ms pacing windows).
 *   • final=true (chat history + every other surface) → fade on for a
 *     polished entry, no pacing, no cursor.
 */
import { state as resolvedTheme } from "@/modules/theme"
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
// single boolean keeps the toggle atomic — Vue swaps all four props in
// the same patch when `final` flips.
const streaming = computed(() => !props.final)

const customHtmlTags = computed(() =>
  props.surface === "chat" ? ["thinking"] : undefined
)

// Virtualization caps how many nodes render live. The streaming chat tail
// (final=false) uses 0 — disabled — so freshly streamed text is never
// hidden behind a measurement pass. Finalized chat history (and every
// other surface) fall back to the library default, so a single very long
// message (e.g. a huge code/JSON dump) windows instead of mounting every
// node at once.
const maxLiveNodes = computed(() =>
  props.surface === "chat" && !props.final ? 0 : undefined
)

// HTML policy by content provenance: LLM output is `safe` (blocks
// active/embed/form tags); author-written changelog content is
// `trusted` so we can use `<kbd>`, `<details>`, `<sup>`, `<video>`.
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

// Code blocks get a header strip with a copy button — same on every
// surface. The library handles the DOM; we just turn it on.
const codeBlockProps = { showHeader: true, showCopyButton: true } as const

// markstream renders code blocks through its Monaco runtime
// (stream-monaco) — the same editor engine VS Code uses. Every surface
// here is display-only, so force read-only: no editing affordance, just
// highlighted output. MAX_HEIGHT caps tall payloads (e.g. long tool-call
// JSON) so one block can't dominate a chat bubble — Monaco scrolls
// internally past the cap.
const codeBlockMonacoOptions = { readOnly: true, MAX_HEIGHT: 320 } as const

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
    code-block-light-theme="light-plus"
    code-block-dark-theme="dark-plus"
    :code-block-props="codeBlockProps"
    :code-block-monaco-options="codeBlockMonacoOptions"
    :mermaid-props="mermaidProps"
    :custom-html-tags="customHtmlTags"
    :smooth-streaming="streaming ? 'auto' : false"
    :smooth-streaming-options="smoothStreamingOptions"
    :fade="!streaming"
    :typewriter="streaming"
    :max-live-nodes="maxLiveNodes"
    :show-tooltips="showTooltips"
    :debug-performance="isDev"
  />
</template>

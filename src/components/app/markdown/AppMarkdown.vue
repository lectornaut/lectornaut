<script lang="ts" setup>
/**
 * AppMarkdown — single entry point for every markdown surface in the
 * app. Wraps `markstream-vue` with the shared config (theme tracking,
 * code-block highlighting, html policy, animation behaviour) so each
 * consumer only picks a `surface` + supplies `content`/`final`.
 *
 * Surfaces share a `data-custom-id` attribute that the global `<style>`
 * block below uses to apply per-surface `--ms-*` typography overrides
 * without needing `:deep()` at every call site.
 *
 * Streaming vs history is driven entirely off `final`:
 *   • final=false (chat tail mid-stream) → smooth pacing on,
 *     typewriter cursor visible, fade off (would flicker against
 *     280ms pacing windows).
 *   • final=true (chat history + every other surface) → fade on for a
 *     polished entry, no pacing, no cursor.
 */
import { state as resolvedTheme } from "@/modules/theme"
import MarkdownRender, { setCustomComponents } from "markstream-vue"
import { markRaw } from "vue"
import BotThinkingBlock from "@/components/app/bot/BotThinkingBlock.vue"
import SafeLink from "@/components/app/markdown/SafeLink.vue"
import AppMarkdownImage from "@/components/app/markdown/AppMarkdownImage.vue"
import AppMarkdownHeading from "@/components/app/markdown/AppMarkdownHeading.vue"
import "markstream-vue/index.css"
import "katex/dist/katex.min.css"

export type AppMarkdownSurface = "chat" | "changelog-sheet" | "changelog-page"

const props = withDefaults(
  defineProps<{
    surface: AppMarkdownSurface
    content: string
    final?: boolean
  }>(),
  { final: true }
)

// Per-customId override maps. `setCustomComponents` *replaces* the map
// for that id (it doesn't merge), so every override for a surface must
// land in a single call. Re-registering during HMR is what we want —
// the new map wins.
//
//   chat            → thinking (CoT disclosure), SafeLink (target=_blank
//                     + RouterLink), AppMarkdownImage (lazy + placeholder)
//   changelog-sheet → SafeLink (author content can still cite externals)
//   changelog-page  → SafeLink + AppMarkdownHeading (anchor permalinks)
setCustomComponents("chat", {
  thinking: markRaw(BotThinkingBlock),
  link: markRaw(SafeLink),
  image: markRaw(AppMarkdownImage),
})
setCustomComponents("changelog-sheet", {
  link: markRaw(SafeLink),
})
setCustomComponents("changelog-page", {
  link: markRaw(SafeLink),
  heading: markRaw(AppMarkdownHeading),
})

const isDark = computed(() => resolvedTheme.value === "dark")

// `final=false` only happens on the chat streaming tail (other surfaces
// default to true). Driving the streaming-vs-history prop set off a
// single boolean keeps the toggle atomic — Vue swaps all four props in
// the same patch when `final` flips.
const streaming = computed(() => !props.final)

const customHtmlTags = computed(() =>
  props.surface === "chat" ? ["thinking"] : undefined
)

// Chat bubbles are short and stream; virtualizing them hides incoming
// text behind a measurement pass. Other surfaces use the default 320.
const maxLiveNodes = computed(() => (props.surface === "chat" ? 0 : undefined))

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
    code-block-light-theme="vitesse-light"
    code-block-dark-theme="vitesse-dark"
    :code-block-props="codeBlockProps"
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

<style>
/* Unscoped on purpose: `[data-custom-id]` is the scoping boundary, so
 * rules only match markstream wrappers that carry the matching surface.
 * Keeps every consumer free of `:deep()` plumbing. */

/* ── Shared chat-density variables (chat bubble + changelog sheet) ─── */
.markstream-vue[data-custom-id="chat"],
.markstream-vue[data-custom-id="changelog-sheet"] {
  /* Body: 1.65 leading hits the sweet spot for short prose — looser
   * than 1.5 (cramped at small sizes) but tighter than the library's
   * 1.75 default (wastes vertical space inside a bubble). */
  --ms-text-body: 1em;
  --ms-leading-body: 1.65;
  --ms-flow-paragraph-y: 0.85em;

  /* Headings: stronger size *and* weight contrast so a quick scan
   * reveals structure. h4–h6 stay at body size and lean on weight
   * alone to avoid headings smaller than the prose under them. */
  --ms-text-h1: 1.5em;
  --ms-text-h2: 1.3em;
  --ms-text-h3: 1.15em;
  --ms-text-h4: 1.05em;
  --ms-text-h5: 1em;
  --ms-text-h6: 1em;
  --ms-weight-h1: 700;
  --ms-weight-h2: 650;
  --ms-weight-h3: 600;
  --ms-weight-h4: 600;
  --ms-leading-h1: 1.25;
  --ms-leading-h2: 1.3;
  --ms-leading-h3: 1.4;

  /* More breathing room *above* headings (section break), tighter
   * *below* (group heading with the content it titles). */
  --ms-flow-heading-1-mt: 1em;
  --ms-flow-heading-1-mb: 0.4em;
  --ms-flow-heading-2-mt: 0.9em;
  --ms-flow-heading-2-mb: 0.35em;
  --ms-flow-heading-3-mt: 0.8em;
  --ms-flow-heading-3-mb: 0.3em;
  --ms-flow-heading-4-mt: 0.7em;
  --ms-flow-heading-4-mb: 0.25em;
  --ms-flow-heading-5-mt: 0.6em;
  --ms-flow-heading-5-mb: 0.2em;
  --ms-flow-heading-6-mt: 0.6em;
  --ms-flow-heading-6-mb: 0.2em;

  /* Lists / quotes / code / tables / hr — same 0.75–1em rhythm so
   * adjacent block types read as one continuous flow. */
  --ms-flow-list-y: 0.75em;
  --ms-flow-list-item-y: 0.3em;
  --ms-flow-list-indent: 1.4em;
  --ms-flow-blockquote-y: 0.85em;
  --ms-flow-blockquote-indent: 1em;
  --ms-flow-codeblock-y: 0.85em;
  --ms-flow-table-y: 0.85em;
  --ms-flow-hr-y: 1em;
}

/* ── Changelog page (landing layout, larger body) ─────────────────── */
.markstream-vue[data-custom-id="changelog-page"] {
  --ms-text-body: 1em;
  --ms-leading-body: 1.6;
  --ms-flow-paragraph-y: 1rem;
  --ms-text-h3: 1.1em;
  --ms-text-h4: 1em;
  --ms-flow-heading-3-mt: 1.5rem;
  --ms-flow-heading-3-mb: 0.5rem;
  --ms-flow-heading-4-mt: 1rem;
  --ms-flow-heading-4-mb: 0.25rem;
}

/* ── Universal first/last-child margin reset ──────────────────────── */
.markstream-vue[data-custom-id="chat"] *:first-child,
.markstream-vue[data-custom-id="changelog-sheet"] *:first-child,
.markstream-vue[data-custom-id="changelog-page"] *:first-child {
  margin-top: 0;
}
.markstream-vue[data-custom-id="chat"] *:last-child,
.markstream-vue[data-custom-id="changelog-sheet"] *:last-child,
.markstream-vue[data-custom-id="changelog-page"] *:last-child {
  margin-bottom: 0;
}

/* ── Typography polish (chat + sheet, where bubbles are narrow) ───── */
.markstream-vue[data-custom-id="chat"] .paragraph-node,
.markstream-vue[data-custom-id="changelog-sheet"] .paragraph-node {
  text-wrap: pretty;
}
.markstream-vue[data-custom-id="chat"] .heading-node,
.markstream-vue[data-custom-id="changelog-sheet"] .heading-node {
  text-wrap: balance;
  letter-spacing: -0.01em;
}

/* Inline code at 0.875em — at small bubble sizes the library default
 * 0.8125em rendered noticeably smaller than surrounding prose. */
.markstream-vue[data-custom-id="chat"] .inline-code,
.markstream-vue[data-custom-id="changelog-sheet"] .inline-code {
  font-size: 0.875em;
}

/* List items render their own paragraph wrapper which picks up the
 * global paragraph margin and doubles spacing inside tight lists. */
.markstream-vue[data-custom-id="chat"] .list-item .paragraph-node,
.markstream-vue[data-custom-id="changelog-sheet"] .list-item .paragraph-node,
.markstream-vue[data-custom-id="changelog-page"] .list-item .paragraph-node {
  margin-top: 0;
  margin-bottom: 0;
}
</style>

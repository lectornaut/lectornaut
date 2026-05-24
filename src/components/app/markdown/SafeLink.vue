<script lang="ts" setup>
/**
 * SafeLink — custom `link` renderer for every markstream surface.
 * Routes internal URLs through `<RouterLink>` (no full page reload, no
 * loss of in-flight state) and forces external URLs into a new tab
 * with `rel="noopener noreferrer"` so the destination can't navigate
 * the opener window.
 *
 * Links resolve to one of three render modes against
 * `window.location.origin`:
 *   • router   — same-origin app paths (`/foo`, same-origin absolute,
 *                bare relative) → `<RouterLink>`.
 *   • external — cross-origin http(s) (incl. protocol-relative `//host`)
 *                → new tab with `rel="noopener noreferrer"`.
 *   • plain    — in-page anchors (`#section`), non-http(s) schemes
 *                (`mailto:`, `tel:`, …), empty, or unparseable → native
 *                `<a>` with no `target`. This is what makes `#section`
 *                actually scroll (a `<RouterLink to="#section">` would
 *                treat the hash as a route and not scroll) and lets
 *                `mailto:`/`tel:` open the OS handler without a blank tab.
 *
 * Important for chat: the model can write any URL it wants and a
 * default `<a href="...">` opens in the same tab, replacing the app.
 * SafeLink turns that into a contained UX.
 */
import type { LinkNodeProps } from "markstream-vue"

const props = defineProps<LinkNodeProps>()

const href = computed(() => props.node.href ?? "")

const linkMode = computed<"router" | "external" | "plain">(() => {
  const h = href.value
  // In-page anchors and empty hrefs: native <a> so the browser does its
  // built-in scroll-to-id (RouterLink would treat "#x" as a route).
  if (!h || h.startsWith("#")) return "plain"
  // Root-relative app paths route through the SPA — but not protocol-
  // relative "//host" URLs, which are cross-origin.
  if (h.startsWith("/") && !h.startsWith("//")) return "router"
  try {
    const url = new URL(h, window.location.origin)
    // Non-http(s) schemes (mailto:, tel:, …) go to the OS via a plain <a>.
    if (url.protocol !== "http:" && url.protocol !== "https:") return "plain"
    return url.origin === window.location.origin ? "router" : "external"
  } catch {
    return "plain"
  }
})

const title = computed(() => props.node.title || props.node.href)
</script>

<template>
  <RouterLink
    v-if="linkMode === 'router'"
    :to="href"
    :title="title"
    class="text-destructive hover:text-destructive! break-all hover:underline"
  >
    <slot>{{ node.text }}</slot>
  </RouterLink>
  <a
    v-else-if="linkMode === 'external'"
    :href="href"
    :title="title"
    target="_blank"
    rel="noopener noreferrer"
    class="text-destructive hover:text-destructive! break-all hover:underline"
  >
    <slot>{{ node.text }}</slot>
  </a>
  <a
    v-else
    :href="href"
    :title="title"
    class="text-destructive hover:text-destructive! break-all hover:underline"
  >
    <slot>{{ node.text }}</slot>
  </a>
</template>

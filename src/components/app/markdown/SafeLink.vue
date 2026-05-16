<script lang="ts" setup>
/**
 * SafeLink — custom `link` renderer for every markstream surface.
 * Routes internal URLs through `<RouterLink>` (no full page reload, no
 * loss of in-flight state) and forces external URLs into a new tab
 * with `rel="noopener noreferrer"` so the destination can't navigate
 * the opener window.
 *
 * Internal vs external is computed from `node.href` against
 * `window.location.origin`. Relative paths, root-relative paths
 * (`/foo`), and hash-only links (`#section`) all read as internal.
 * Anything with an explicit cross-origin URL is external.
 *
 * Important for chat: the model can write any URL it wants and a
 * default `<a href="...">` opens in the same tab, replacing the app.
 * SafeLink turns that into a contained UX.
 */
import type { LinkNodeProps } from "markstream-vue"

const props = defineProps<LinkNodeProps>()

const isExternal = computed(() => {
  const href = props.node.href
  if (!href) return false
  if (href.startsWith("#") || href.startsWith("/")) return false
  try {
    const url = new URL(href, window.location.origin)
    return url.origin !== window.location.origin
  } catch {
    return false
  }
})

const title = computed(() => props.node.title || props.node.href)
</script>

<template>
  <RouterLink v-if="!isExternal" :to="node.href" :title="title">
    <slot>{{ node.text }}</slot>
  </RouterLink>
  <a
    v-else
    :href="node.href"
    :title="title"
    target="_blank"
    rel="noopener noreferrer"
  >
    <slot>{{ node.text }}</slot>
  </a>
</template>

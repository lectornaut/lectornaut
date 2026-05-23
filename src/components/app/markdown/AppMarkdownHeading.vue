<script lang="ts" setup>
/**
 * AppMarkdownHeading — `heading` override for the changelog landing
 * page. Adds a stable `id` derived from the heading text and a
 * `#permalink` anchor that fades in on hover, so individual changelog
 * entries are linkable. Used only against the `changelog-page`
 * customId — chat headings stay un-anchored.
 *
 * The slug is computed from the heading's plain `text` (not rendered
 * HTML), so inline markup like `## **What's new**` still produces
 * `whats-new` rather than something tag-tainted.
 */
const props = defineProps<{
  node: {
    level: number
    text: string
  }
}>()

const slug = computed(() => {
  const base = props.node.text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
  // A heading that's entirely emoji/punctuation (e.g. `## 🎉`) slugifies
  // to "" — an empty id is a dead permalink target, so fall back to a
  // stable label. (Duplicate-text headings are intentionally NOT
  // auto-suffixed: a render-scoped counter would yield unstable ids
  // across re-renders/navigation, which is worse than a rare collision.)
  return base || "section"
})

const tag = computed(() => `h${props.node.level}`)
</script>

<template>
  <component :is="tag" :id="slug" class="markdown-heading-anchor group">
    <slot />
    <a
      :href="`#${slug}`"
      class="markdown-heading-anchor-link"
      aria-label="Permalink"
    >
      #
    </a>
  </component>
</template>

<style scoped>
.markdown-heading-anchor-link {
  margin-left: 0.4em;
  opacity: 0;
  text-decoration: none;
  font-weight: 400;
  transition: opacity 120ms ease-out;
}
.markdown-heading-anchor:hover .markdown-heading-anchor-link,
.markdown-heading-anchor:focus-within .markdown-heading-anchor-link {
  opacity: 0.6;
}
.markdown-heading-anchor-link:hover {
  opacity: 1 !important;
}
</style>

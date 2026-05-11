<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { changelog } from "@/data/changelog"
import { IconArrowUpRight, IconBookOpen, IconMessageCircle } from "@/data/icons"
import { emitter } from "@/modules/mitt"
import MarkdownRender from "markstream-vue"
import "markstream-vue/index.css"

const isFullscreen = useIsFullscreen()
const isDark = usePreferredDark()

const openChangelog = ref(false)

const activeLog = ref(changelog[0]?.id)

emitter.on("Dialog.Changelog.Open", (id) => {
  openChangelog.value = !openChangelog.value
  activeLog.value = (id as string) ?? changelog[0]?.id
})
</script>

<template>
  <Sheet v-model:open="openChangelog">
    <SheetContent
      class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-xl border"
      :class="{ 'mt-12': isTauri && !isFullscreen }"
    >
      <SheetHeader>
        <SheetTitle>Changelog</SheetTitle>
      </SheetHeader>
      <OverlayScrollbarsWrapper>
        <div class="flex grow flex-col px-4">
          <Accordion
            collapsible
            type="multiple"
            :default-value="[activeLog ?? '']"
          >
            <AccordionItem
              v-for="log in changelog"
              :key="log.id"
              :value="log.id"
            >
              <AccordionTrigger>
                {{ useDateFormat(log.date, "MMM D · YYYY") }}
                ~
                {{ log.title }}
              </AccordionTrigger>
              <AccordionContent>
                <div
                  class="changelog-sheet-markdown text-secondary-foreground text-sm"
                >
                  <MarkdownRender
                    custom-id="changelog-sheet"
                    :is-dark="isDark"
                    :code-block-props="{
                      theme: { light: 'vitesse-light', dark: 'vitesse-dark' },
                    }"
                    :content="log.content"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </OverlayScrollbarsWrapper>
      <SheetFooter>
        <Button variant="secondary" class="justify-start">
          <IconMessageCircle />
          Get support
        </Button>
        <Button variant="secondary" class="justify-start">
          <IconBookOpen />
          Documentation
          <IconArrowUpRight />
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
/* markstream-vue injects a `.markstream-vue` wrapper that re-defines every
   `--ms-*` typography variable on itself, shadowing anything we set on the
   bubble parent. We push our overrides onto that wrapper directly via
   `:deep()` so they actually win the cascade — and we keep everything in
   `em` units so the bubble's `text-sm` stays the source of truth for
   sizing (the rhythm scales if the bubble's font-size ever changes). */
.changelog-sheet-markdown :deep(.markstream-vue) {
  /* ── Animations ───────────────────────────────────────────────────
     Disable every transition/animation in the markstream subtree.
     During streaming the per-token fade-in (`.text-node-stream-delta`,
     `.inline-code-stream-delta` — each ~0.28s) fires on every chunk,
     queuing dozens of concurrent compositor animations and burning
     ~5ms/token in style work for a fade most users never notice.
     The two `--*-fade-duration` vars are *not* set by the library's
     defaults (they fall through to a `.28s` literal in `var()`
     fallbacks), so we must zero them explicitly alongside the
     `--ms-duration-*` set. */
  --ms-duration-fast: 0s;
  --ms-duration-standard: 0s;
  --ms-duration-emphasis: 0s;
  --ms-duration-overlay: 0s;
  --ms-duration-stream: 0s;
  --ms-duration-slow: 0s;
  --stream-update-fade-duration: 0s;
  --fade-duration: 0s;

  /* ── Body ─────────────────────────────────────────────────────────
     1.65 leading hits the chat sweet spot — looser than 1.5 (which
     feels cramped at small sizes) but tighter than the library's 1.75
     default (which wastes vertical space inside a bubble). */
  --ms-text-body: 1em;
  --ms-leading-body: 1.65;
  --ms-flow-paragraph-y: 0.85em;

  /* ── Headings ─────────────────────────────────────────────────────
     Stronger size *and* weight contrast between levels so a quick scan
     reveals structure. h4–h6 stay at body size but lean on weight to
     avoid headings smaller than the prose under them. */
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

  /* More breathing room *above* headings (visual section break) and
     tighter *below* (group the heading with the content it titles). */
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

  /* ── Lists / quotes / code / tables / hr ──────────────────────────
     All anchored to the same 0.75–1em rhythm so a paragraph next to a
     list next to a quote reads as one continuous flow. */
  --ms-flow-list-y: 0.75em;
  --ms-flow-list-item-y: 0.3em;
  --ms-flow-list-indent: 1.4em;
  --ms-flow-blockquote-y: 0.85em;
  --ms-flow-blockquote-indent: 1em;
  --ms-flow-codeblock-y: 0.85em;
  --ms-flow-table-y: 0.85em;
  --ms-flow-hr-y: 1em;
}

/* Strip the leading/trailing margins so the first heading's `margin-top`
   and the last paragraph's `margin-bottom` don't blow past the bubble's
   padding. The library already sets `.paragraph-node { margin: 0 }` but
   `.heading-node` and other block nodes keep theirs — this universal
   reset covers all of them. */
.changelog-sheet-markdown :deep(.markstream-vue > *:first-child),
.changelog-sheet-markdown :deep(.markstream-vue *:first-child) {
  margin-top: 0;
}
.changelog-sheet-markdown :deep(.markstream-vue > *:last-child),
.changelog-sheet-markdown :deep(.markstream-vue *:last-child) {
  margin-bottom: 0;
}

/* `text-wrap: pretty` avoids orphaned single-word last lines in
   paragraphs; `balance` evens out short multi-line headings. Both are
   no-ops on browsers without support, so they're safe to apply
   unconditionally. */
.changelog-sheet-markdown :deep(.paragraph-node) {
  text-wrap: pretty;
}
.changelog-sheet-markdown :deep(.heading-node) {
  text-wrap: balance;
  letter-spacing: -0.01em;
}

/* Inline code gets bumped from the library default of 0.8125em to
   0.875em — at our small bubble size, 0.8125em rendered noticeably
   smaller than surrounding prose and was hard to read. */
.changelog-sheet-markdown :deep(.inline-code) {
  font-size: 0.875em;
}

/* List items render their own paragraph wrapper which gets the global
   paragraph margin. Inside a tight list, that doubles spacing. Drop
   inner-paragraph margins so list-item spacing comes solely from
   `--ms-flow-list-item-y`. (Note: the library already does this via
   `li .paragraph-node { margin: 0 }`, but we keep the rule in case the
   library's selector specificity shifts in a future release.) */
.changelog-sheet-markdown :deep(.list-item .paragraph-node) {
  margin-top: 0;
  margin-bottom: 0;
}

/* ── Performance ───────────────────────────────────────────────────
   Layout containment isolates each bubble's layout & paint work from
   its neighbours. When the streaming tail's height grows, the browser
   only re-lays-out *that* bubble's subtree — prior bubbles are skipped
   entirely. Without `contain`, every chunk invalidates the full chat
   column, so streaming gets jankier as history grows. */
.changelog-sheet-markdown {
  contain: layout style;
}

/* Belt-and-suspenders animation kill — universal selector with
   `!important` is heavy-handed but guarantees no library rule sneaks
   past the `--ms-duration-*` / `--*-fade-duration` overrides. Scoped
   tightly to the markstream subtree so unrelated app animations
   (sidebars, dialogs, the thinking dot) are unaffected. */
.changelog-sheet-markdown :deep(.markstream-vue),
.changelog-sheet-markdown :deep(.markstream-vue *),
.changelog-sheet-markdown :deep(.markstream-vue *::before),
.changelog-sheet-markdown :deep(.markstream-vue *::after) {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}
</style>

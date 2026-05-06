<script lang="ts" setup>
import { changelog } from "@/data/changelog"
import MarkdownRender from "markstream-vue"
import "markstream-vue/index.css"

definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "Changelog",
})

const { t } = useI18n()
const isDark = usePreferredDark()
</script>

<template>
  <div class="mx-auto my-32 grid max-w-6xl gap-10">
    <div class="space-y-6 text-center">
      <h2 class="font-display text-6xl font-bold">
        {{ t("pages.changelog.title") }}
      </h2>
      <p class="text-secondary-foreground">
        {{ t("pages.changelog.subtitle") }}
      </p>
    </div>
    <div v-for="entry in changelog" :key="entry.id" class="px-8 py-4">
      <div class="relative flex flex-col gap-4 md:flex-row">
        <div
          class="top-32 flex h-min w-64 shrink-0 items-center gap-4 md:sticky"
        >
          <Badge variant="secondary" class="text-xs">
            {{ entry.id }}
          </Badge>
          <span class="text-muted-foreground text-xs font-medium">
            {{ useDateFormat(entry.date, "D MMMM YYYY") }}
          </span>
        </div>
        <div class="flex flex-col">
          <h2
            class="text-foreground mb-4 text-lg leading-tight font-bold md:text-2xl"
          >
            {{ entry.title }}
          </h2>
          <div
            class="changelog-markdown text-muted-foreground text-sm md:text-base"
          >
            <MarkdownRender
              custom-id="changelog"
              :is-dark="isDark"
              :code-block-props="{
                theme: { light: 'vitesse-light', dark: 'vitesse-dark' },
              }"
              :content="entry.content"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* markstream-vue's `.markstream-vue` wrapper redefines every `--ms-*`
   typography variable on itself, shadowing anything we set on a parent.
   Push our overrides onto that wrapper directly via `:deep()` so they
   actually win the cascade — and keep them in `em` units so the
   container's `text-sm md:text-base` stays the source of truth. */
.changelog-markdown :deep(.markstream-vue) {
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

/* Strip leading/trailing margins so the first heading and last paragraph
   don't blow past the entry's own padding. */
.changelog-markdown :deep(.markstream-vue *:first-child) {
  margin-top: 0;
}
.changelog-markdown :deep(.markstream-vue *:last-child) {
  margin-bottom: 0;
}
</style>

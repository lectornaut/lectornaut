<script lang="ts" setup>
import { changelog } from "@/data/changelog"

definePage({
  meta: {
    layout: "landing",
  },
})

useHead({
  title: "Changelog",
})

const { t } = useI18n()
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
    <!-- Each entry is addressable by its version: /changelog#2.9.0. The
         router's scrollBehavior scrolls it into view (cold load and clicks
         alike); scroll-mt clears the landing nav so the title isn't hidden. -->
    <div
      v-for="entry in changelog"
      :id="entry.id"
      :key="entry.id"
      class="scroll-mt-32 px-8 py-4"
    >
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
            class="group text-foreground mb-4 text-lg leading-tight font-bold md:text-2xl"
          >
            {{ entry.title }}
            <RouterLink
              :to="{ hash: `#${entry.id}` }"
              :aria-label="
                t('pages.changelog.permalink', { version: entry.id })
              "
              class="text-muted-foreground hover:text-foreground ml-1 font-normal no-underline opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              #
            </RouterLink>
          </h2>
          <div
            class="changelog-markdown text-muted-foreground text-sm md:text-base"
          >
            <AppMarkdown surface="changelog-page" :content="entry.content" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

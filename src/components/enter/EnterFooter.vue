<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { legal, type LegalDocumentKey } from "@/data/legal"

const { t, locale } = useI18n()
const isFullscreen = useIsFullscreen()

// Lazy: keeps the markdown renderer out of the sign-in bundle until a
// sheet actually opens (SheetContent only mounts while open).
const LegalMarkdown = defineAsyncComponent(
  () => import("@/components/app/markdown/AppMarkdown.vue")
)

const docs: LegalDocumentKey[] = ["terms", "privacy"]

// UTC: a bare ISO date parses as UTC midnight, so a local zone west of
// UTC would otherwise show the previous day.
const formatUpdated = (iso: string) =>
  new Date(iso).toLocaleDateString(locale.value, {
    dateStyle: "long",
    timeZone: "UTC",
  })
</script>

<template>
  <span class="text-muted-foreground/50 mx-auto flex items-center gap-2">
    <template v-for="(doc, i) in docs" :key="doc">
      <span v-if="i > 0" aria-hidden="true">•</span>
      <Sheet>
        <SheetTrigger as-child>
          <Button variant="link" class="text-muted-foreground/50">
            {{ t(`enter.footer.${doc}`) }}
          </Button>
        </SheetTrigger>
        <SheetContent
          class="rounded-surface m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip border"
          :class="{ 'mt-12': isTauri && !isFullscreen }"
        >
          <SheetHeader>
            <SheetTitle>{{ t(`enter.footer.${doc}`) }}</SheetTitle>
            <SheetDescription>
              {{
                t("enter.footer.lastUpdated", {
                  date: formatUpdated(legal[doc].updated),
                })
              }}
            </SheetDescription>
          </SheetHeader>
          <ScrollContainer>
            <div class="text-secondary-foreground px-6 pb-6 text-sm">
              <LegalMarkdown
                surface="legal-sheet"
                :content="legal[doc].content"
              />
            </div>
          </ScrollContainer>
        </SheetContent>
      </Sheet>
    </template>
  </span>
</template>

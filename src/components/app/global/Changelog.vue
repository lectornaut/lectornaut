<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { changelog } from "@/data/changelog"
import { IconArrowUpRight, IconBookOpen, IconMessageCircle } from "@/data/icons"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()
const isFullscreen = useIsFullscreen()

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
      class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+(--spacing(2)))] h-auto! gap-0 overflow-clip rounded-2xl border"
      :class="{ 'mt-12': isTauri && !isFullscreen }"
    >
      <SheetHeader>
        <SheetTitle>{{ t("pages.changelog.title") }}</SheetTitle>
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
                  <AppMarkdown
                    surface="changelog-sheet"
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
          {{ t("components.support.getSupport") }}
        </Button>
        <Button variant="secondary" class="justify-start">
          <IconBookOpen />
          {{ t("components.support.documentation") }}
          <IconArrowUpRight />
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
/* Typography for the markstream subtree lives in `AppMarkdown.vue` and
 * keys off `[data-custom-id="changelog-sheet"]`. What stays here is
 * the wrapper's layout containment — isolates each entry's paint work
 * so an expanding accordion doesn't invalidate the full list. */
.changelog-sheet-markdown {
  contain: layout style;
}
</style>

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
        <div class="flex grow flex-col">
          <Accordion
            collapsible
            type="multiple"
            :default-value="[activeLog ?? '']"
            class="px-4"
          >
            <AccordionItem
              v-for="log in changelog"
              :key="log.id"
              :value="log.id"
            >
              <AccordionTrigger>
                {{ log.title }}
                <span class="text-muted-foreground ml-auto text-xs">
                  {{ useDateFormat(log.date, "MMM D · YYYY") }}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div class="changelog-sheet-markdown text-secondary-foreground">
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
/* Compact typography for the side-sheet surface — the accordion item is
   tight, so headings/lists need to stay close to the body text. Same
   `:deep()` strategy as the main changelog page (the `.markstream-vue`
   wrapper redefines `--ms-*` on itself). */
.changelog-sheet-markdown :deep(.markstream-vue) {
  --ms-text-body: 0.875em;
  --ms-leading-body: 1.5;
  --ms-flow-paragraph-y: 0.5rem;
  --ms-text-h3: 0.95em;
  --ms-text-h4: 0.875em;
  --ms-flow-heading-3-mt: 0.75rem;
  --ms-flow-heading-3-mb: 0.25rem;
  --ms-flow-heading-4-mt: 0.5rem;
  --ms-flow-heading-4-mb: 0.25rem;
}
.changelog-sheet-markdown :deep(.markstream-vue *:first-child) {
  margin-top: 0;
}
.changelog-sheet-markdown :deep(.markstream-vue *:last-child) {
  margin-bottom: 0;
}
</style>

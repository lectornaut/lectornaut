<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { changelog } from "@/data/changelog"
import { IconArrowUpRight, IconBookOpen, IconMessageCircle } from "@/data/icons"
import { emitter } from "@/modules/mitt"

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
      class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+8px)] h-auto gap-0 rounded-md border"
      :class="{ 'mt-13': isTauri && !isFullscreen }"
    >
      <SheetHeader>
        <SheetTitle>Changelog</SheetTitle>
      </SheetHeader>
      <Separator />
      <OverlayScrollbarsWrapper>
        <div
          class="flex grow flex-col overflow-auto overscroll-none scroll-smooth"
        >
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
                <ul
                  class="marker:text-muted-foreground text-secondary-foreground list-inside list-disc"
                >
                  <li v-for="item in log.content" :key="item">{{ item }}</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </OverlayScrollbarsWrapper>
      <Separator />
      <SheetFooter>
        <Button class="justify-start" variant="secondary">
          <IconMessageCircle />
          Get support
        </Button>
        <Button class="justify-start" variant="secondary">
          <IconBookOpen />
          Documentation
          <IconArrowUpRight />
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

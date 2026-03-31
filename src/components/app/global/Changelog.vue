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
      class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+var(--spacing)*2)] h-auto gap-0 overflow-clip rounded border"
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

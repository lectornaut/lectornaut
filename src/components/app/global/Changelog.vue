<script setup lang="ts">
import { changelog } from "@/data/changelog"
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useDateFormat } from "@vueuse/core"

let unlisten: UnlistenFn | undefined

const isFullscreen = computedAsync(
  async () => (isTauri.value ? await getCurrentWindow().isFullscreen() : false),
  false
)

onMounted(async () => {
  if (isTauri.value) {
    unlisten = await getCurrentWindow().onResized(async () => {
      isFullscreen.value = await getCurrentWindow().isFullscreen()
    })
  }
})

onBeforeUnmount(() => {
  if (unlisten) {
    unlisten()
  }
})

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
        <div class="flex grow flex-col overflow-auto overscroll-none">
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
          <icon-lucide-message-circle />
          Get support
        </Button>
        <Button class="justify-start" variant="secondary">
          <icon-lucide-book-open />
          Documentation
          <icon-lucide-arrow-up-right />
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

<script setup lang="ts">
import { changelog } from "@/data/changelog"
import emitter from "@/modules/mitt"
import { useDateFormat } from "@vueuse/core"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"

const openChangelog = ref(false)

const activeLog = ref(changelog[0]?.id)

emitter.on("Dialog.Changelog.Open", (id) => {
  openChangelog.value = !openChangelog.value
  activeLog.value = (id as string) ?? changelog[0]?.id
})
</script>

<template>
  <Sheet v-model:open="openChangelog">
    <SheetContent class="m-3 h-auto gap-0 rounded-md border">
      <SheetHeader class="gap-4">
        <SheetTitle>Changelog</SheetTitle>
      </SheetHeader>
      <Separator />
      <OverlayScrollbarsComponent
        defer
        :options="{ scrollbars: { autoHide: 'scroll' } }"
      >
        <Accordion
          collapsible
          type="multiple"
          :default-value="[activeLog ?? '']"
          class="px-4"
        >
          <AccordionItem v-for="log in changelog" :key="log.id" :value="log.id">
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
      </OverlayScrollbarsComponent>
    </SheetContent>
  </Sheet>
</template>

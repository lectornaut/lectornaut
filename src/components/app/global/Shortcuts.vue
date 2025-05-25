<script setup lang="ts">
import {
  shortcuts,
  type Shortcut,
  type ShortcutCategory,
} from "@/helpers/shortcuts"
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import Fuse from "fuse.js"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"

const openShortcuts = ref(false)

emitter.on("Dialog.Shortcuts.Open", () => {
  openShortcuts.value = !openShortcuts.value
})

const search = ref("")

const fuseCategory = new Fuse(shortcuts, {
  keys: ["shortcuts.description", "shortcuts.tags"],
})

const fuseShortcut = new Fuse(
  shortcuts.flatMap((category) => category.shortcuts),
  {
    keys: ["description", "tags"],
  }
)

const filteredShortcuts = computed(() => {
  const isWeb = !isTauri.value
  const isDesktop = isTauri.value

  const filterShortcut = (shortcut: Shortcut) =>
    (isWeb ? !shortcut.hidden.includes("web") : true) &&
    (isDesktop ? !shortcut.hidden.includes("desktop") : true) &&
    !shortcut.hidden.includes("shortcuts")

  const filterCategory = (category: ShortcutCategory) =>
    (isWeb ? !category.hidden.includes("web") : true) &&
    (isDesktop ? !category.hidden.includes("desktop") : true) &&
    !category.hidden.includes("shortcuts")

  if (!search.value) {
    return shortcuts
      .filter(filterCategory)
      .map((category) => ({
        ...category,
        shortcuts: category.shortcuts.filter(filterShortcut),
      }))
      .filter((category) => category.shortcuts.length > 0)
  }

  const categoryResults = new Set(
    fuseCategory.search(search.value).map((result) => result.item)
  )
  const shortcutResults = new Set(
    fuseShortcut.search(search.value).map((result) => result.item)
  )

  return Array.from(categoryResults)
    .filter(filterCategory)
    .map((category) => ({
      ...category,
      shortcuts: category.shortcuts
        .filter((s) => shortcutResults.has(s))
        .filter(filterShortcut),
    }))
    .filter((category) => category.shortcuts.length > 0)
})
</script>

<template>
  <Sheet v-model:open="openShortcuts">
    <SheetContent class="m-3 h-auto gap-0 rounded-md border">
      <SheetHeader class="gap-4">
        <SheetTitle>Keyboard shortcuts</SheetTitle>
        <SheetDescription>
          <div class="relative w-full items-center">
            <span
              class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-2"
            >
              <icon-lucide-search class="text-muted-foreground" />
            </span>
            <Input
              v-model="search"
              type="text"
              placeholder="Search shortcuts..."
              class="pl-8 focus:border-inherit focus:ring-0"
            />
          </div>
        </SheetDescription>
      </SheetHeader>
      <Separator />
      <OverlayScrollbarsComponent
        defer
        :options="{ scrollbars: { autoHide: 'scroll' } }"
      >
        <Accordion
          collapsible
          type="multiple"
          :default-value="filteredShortcuts.map((category) => category.id)"
          class="px-4"
        >
          <AccordionItem
            v-for="category in filteredShortcuts"
            :key="category.id"
            :value="category.id"
          >
            <AccordionTrigger>
              {{ category.title }}
            </AccordionTrigger>
            <AccordionContent>
              <div
                v-for="(shortcut, shortcutIndex) in category.shortcuts"
                :key="shortcutIndex"
                class="flex items-center justify-between py-2"
              >
                <div class="text-muted-foreground flex items-center gap-2">
                  <template
                    v-for="(step, stepIndex) in shortcut.description"
                    :key="stepIndex"
                  >
                    <span>
                      {{ step }}
                    </span>
                    <span v-if="stepIndex < shortcut.description.length - 1">
                      ›
                    </span>
                  </template>
                </div>
                <span class="flex gap-8">
                  <div
                    v-for="keys in shortcut.keys"
                    :key="keys.toString()"
                    class="after:text-muted-foreground relative flex after:absolute after:top-1/2 after:-right-8 after:flex after:aspect-square after:min-h-8 after:-translate-y-1/2 after:scale-75 after:items-center after:justify-center after:rounded-full after:content-['or'] last-of-type:after:hidden"
                  >
                    <kbd v-for="key in keys" :key="key" class="shortcut-key">
                      {{ key }}
                    </kbd>
                  </div>
                </span>
              </div>
            </AccordionContent>
          </AccordionItem>
          <div v-if="filteredShortcuts.length === 0" class="">
            <p class="text-muted-foreground p-4 text-center">
              No shortcuts found.
            </p>
          </div>
        </Accordion>
      </OverlayScrollbarsComponent>
    </SheetContent>
  </Sheet>
</template>

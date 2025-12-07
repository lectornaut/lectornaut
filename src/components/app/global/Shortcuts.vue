<script lang="ts" setup>
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import {
  IconArrowUpRight,
  IconBookOpen,
  IconChevronRight,
  IconMessageCircle,
  IconSearch,
} from "@/data/icons"
import {
  shortcuts,
  type Shortcut,
  type ShortcutCategory,
} from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import Fuse from "fuse.js"

const isFullscreen = useIsFullscreen()

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
    <SheetContent
      class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+8px)] h-auto gap-0 rounded-md border"
      :class="{ 'mt-13': isTauri && !isFullscreen }"
    >
      <SheetHeader class="gap-4">
        <SheetTitle>Keyboard shortcuts</SheetTitle>
        <SheetDescription>
          <InputGroup>
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput v-model="search" placeholder="Search" />
          </InputGroup>
        </SheetDescription>
      </SheetHeader>
      <Separator />
      <OverlayScrollbarsWrapper>
        <div
          class="flex grow flex-col overflow-auto overscroll-none scroll-smooth"
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
                        <IconChevronRight />
                      </span>
                    </template>
                  </div>
                  <div>
                    <KbdGroup
                      v-for="keys in shortcut.keys"
                      :key="keys.toString()"
                    >
                      <Kbd v-for="key in keys" :key="key">
                        {{ key }}
                      </Kbd>
                    </KbdGroup>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
            <div v-if="filteredShortcuts.length === 0">
              <p class="text-muted-foreground p-4 text-center">
                No shortcuts found.
              </p>
            </div>
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

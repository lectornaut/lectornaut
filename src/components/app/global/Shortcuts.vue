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
  getFilteredShortcuts,
  getFlatShortcuts,
  type ShortcutCategory,
} from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"
import Fuse from "fuse.js"

const { t } = useI18n()
const isFullscreen = useIsFullscreen()

const openShortcuts = ref(false)

emitter.on("Dialog.Shortcuts.Open", () => {
  openShortcuts.value = !openShortcuts.value
})

const search = ref("")

const filterOptions = computed(() => ({
  context: "shortcuts" as const,
  isDesktop: isTauri.value,
}))

// Fuse instances recreated when platform changes
const fuseCategory = computed(
  () =>
    new Fuse(getFilteredShortcuts(filterOptions.value), {
      keys: ["shortcuts.description", "shortcuts.tags"],
    })
)

const fuseShortcut = computed(
  () =>
    new Fuse(getFlatShortcuts(filterOptions.value), {
      keys: ["description", "tags"],
    })
)

const filteredShortcuts = computed(() => {
  const baseShortcuts = getFilteredShortcuts(filterOptions.value)

  if (!search.value) {
    return baseShortcuts
  }

  const categoryResults = new Set(
    fuseCategory.value.search(search.value).map((result) => result.item)
  )
  const shortcutResults = new Set(
    fuseShortcut.value.search(search.value).map((result) => result.item)
  )

  return (Array.from(categoryResults) as ShortcutCategory[])
    .map((category) => ({
      ...category,
      shortcuts: category.shortcuts.filter((s) => shortcutResults.has(s)),
    }))
    .filter((category) => category.shortcuts.length > 0)
})
</script>

<template>
  <Sheet v-model:open="openShortcuts">
    <SheetContent
      class="m-2 mt-[calc(var(--spacing-titlebar-height,0px)+var(--spacing)*2)] h-auto gap-0 overflow-clip rounded-lg border"
      :class="{ 'mt-12': isTauri && !isFullscreen }"
    >
      <SheetHeader class="gap-4">
        <SheetTitle>{{ t("components.global.shortcuts.title") }}</SheetTitle>
        <SheetDescription>
          <InputGroup>
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput
              v-model="search"
              :placeholder="t('components.global.shortcuts.search')"
            />
          </InputGroup>
        </SheetDescription>
      </SheetHeader>
      <Separator />
      <OverlayScrollbarsWrapper>
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
              {{ t("components.global.shortcuts.noShortcuts") }}
            </p>
          </div>
        </Accordion>
      </OverlayScrollbarsWrapper>
      <SheetFooter class="bg-accent rounded-lg rounded-b-none border p-1.5">
        <Button class="justify-start" variant="secondary">
          <IconMessageCircle />
          {{ t("components.global.shortcuts.getSupport") }}
        </Button>
        <Button class="justify-start" variant="secondary">
          <IconBookOpen />
          {{ t("components.global.shortcuts.documentation") }}
          <IconArrowUpRight />
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

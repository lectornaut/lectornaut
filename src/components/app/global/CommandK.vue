<script setup lang="ts">
import {
  shortcuts,
  type Shortcut,
  type ShortcutCategory,
} from "@/helpers/shortcuts"
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"

const openCommand = ref(false)

emitter.on("Dialog.Command.Open", () => {
  openCommand.value = !openCommand.value
})

const filteredShortcuts = computed(() => {
  const isWeb = !isTauri.value
  const isDesktop = isTauri.value

  const filterShortcut = (shortcut: Shortcut) =>
    (isWeb ? !shortcut.hidden.includes("web") : true) &&
    (isDesktop ? !shortcut.hidden.includes("desktop") : true) &&
    !shortcut.hidden.includes("commands")

  const filterCategory = (category: ShortcutCategory) =>
    (isWeb ? !category.hidden.includes("web") : true) &&
    (isDesktop ? !category.hidden.includes("desktop") : true) &&
    !category.hidden.includes("commands")

  return shortcuts
    .filter(filterCategory)
    .map((category) => ({
      ...category,
      shortcuts: category.shortcuts.filter(filterShortcut),
    }))
    .filter((category) => category.shortcuts.length > 0)
})
</script>

<template>
  <div class="relative flex grow items-center">
    <Button
      id="tour-search-bar"
      variant="secondary"
      class="grow shadow-none"
      @click="openCommand = true"
    >
      <icon-lucide-search />
      <span>Search or command</span>
    </Button>
    <span
      class="pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center p-2"
    >
      <kbd class="shortcut-key">⌘</kbd>
      <kbd class="shortcut-key">K</kbd>
    </span>
    <CommandDialog v-model:open="openCommand">
      <DialogHeader class="sr-only">
        <DialogTitle> Search </DialogTitle>
        <DialogDescription> Type a command or search... </DialogDescription>
      </DialogHeader>
      <CommandInput
        placeholder="Type a command or search..."
        class="border-none p-0 focus:border-inherit focus:ring-0"
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <template
          v-for="(category, index) in filteredShortcuts"
          :key="category.id"
        >
          <CommandGroup :heading="category.title">
            <CommandItem
              v-for="shortcut in category.shortcuts"
              :key="shortcut.event"
              :value="shortcut.event + shortcut.parameters + shortcut.tags"
              @select="
                () => {
                  emitter.emit(shortcut.event, shortcut.parameters)
                  openCommand = false
                }
              "
            >
              <Component :is="shortcut.icon" />
              <Breadcrumb>
                <BreadcrumbList>
                  <template
                    v-for="(step, stepIndex) in shortcut.description"
                    :key="stepIndex"
                  >
                    <BreadcrumbItem>
                      <BreadcrumbPage>
                        {{ step }}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator
                      v-if="stepIndex < shortcut.description.length - 1"
                    />
                  </template>
                </BreadcrumbList>
              </Breadcrumb>
              <CommandShortcut v-if="shortcut.keys">
                <template v-for="keys in shortcut.keys" :key="keys.toString()">
                  <kbd v-for="key in keys" :key="key" class="shortcut-key">{{
                    key
                  }}</kbd>
                </template>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator v-if="index < filteredShortcuts.length - 1" />
        </template>
      </CommandList>
    </CommandDialog>
  </div>
</template>

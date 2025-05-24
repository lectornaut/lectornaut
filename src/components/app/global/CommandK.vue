<script setup lang="ts">
import { shortcuts } from "@/helpers/shortcuts"
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"

const openCommand = ref(false)

emitter.on("Dialog.Command.Open", () => {
  openCommand.value = !openCommand.value
})

const filteredShortcuts = computed(() =>
  shortcuts
    .filter((category) => {
      const webCondition = isTauri.value
        ? true
        : !category.hidden.includes("web")
      const desktopCondition = isTauri.value
        ? !category.hidden.includes("desktop")
        : true
      const hiddenCondition = !category.hidden.includes("commands")
      return webCondition && desktopCondition && hiddenCondition
    })
    .map((category) => ({
      ...category,
      shortcuts: category.shortcuts.filter(
        (shortcut) => !shortcut.hidden.includes("commands")
      ),
    }))
    .filter((category) => category.shortcuts.length > 0)
)
</script>

<template>
  <div class="relative flex grow items-center">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            id="tour-search-bar"
            variant="secondary"
            class="grow shadow-none"
            @click="openCommand = true"
          >
            <icon-lucide-search />
            <span class="truncate">Search or command...</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent> Search </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <span
      class="pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center gap-1 p-2"
    >
      <kbd class="shortcut-key"> ⌘ </kbd>
      <kbd class="shortcut-key"> K </kbd>
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
              <CommandShortcut v-if="shortcut.keys" class="flex gap-1">
                <template v-for="keys in shortcut.keys" :key="keys.toString()">
                  <kbd v-for="key in keys" :key="key" class="shortcut-key">
                    {{ key }}
                  </kbd>
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

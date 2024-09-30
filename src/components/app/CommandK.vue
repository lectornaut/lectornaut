<script setup lang="ts">
import { BreadcrumbItem } from "../ui/breadcrumb"
import { shortcuts } from "@/helpers/shortcuts"
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"

const openCommand = ref(false)

emitter.on("Dialog.Command.Open", () => {
  openCommand.value = !openCommand.value
})

const filteredShortcuts = computed(() =>
  shortcuts.filter((category) => {
    const webCondition = isTauri ? true : !category.hidden.includes("web")

    const tauriCondition = isTauri ? !category.hidden.includes("tauri") : true

    const hiddenCondition = !category.hidden.includes("shortcuts")

    return webCondition && tauriCondition && hiddenCondition
  })
)
</script>

<template>
  <div class="flex">
    <div class="relative items-center">
      <span
        class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-2"
      >
        <icon-lucide-search class="text-muted-foreground" />
      </span>
      <Button
        variant="ghost"
        class="w-72 justify-start bg-muted/75 pl-7 pr-16 font-normal text-muted-foreground"
        size="xs"
        @click="openCommand = true"
      >
        Search
      </Button>
      <span
        class="pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center gap-1 px-2"
      >
        <kbd
          class="pointer-events-none inline-flex h-4 min-w-4 items-center justify-center gap-1 rounded border px-1 font-mono text-xs text-muted-foreground"
        >
          <span class="text-sm">⌘</span>
        </kbd>
        <kbd
          class="pointer-events-none inline-flex h-4 min-w-4 items-center justify-center gap-1 rounded border px-1 font-mono text-xs text-muted-foreground"
        >
          <span>K</span>
        </kbd>
      </span>
    </div>
    <CommandDialog :open="openCommand" @update:open="openCommand = false">
      <DialogHeader class="sr-only">
        <DialogTitle> Search </DialogTitle>
        <DialogDescription> Type a command or search... </DialogDescription>
      </DialogHeader>
      <CommandInput
        placeholder="Type a command or search..."
        class="border-none focus:border-inherit focus:ring-0"
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup
          v-for="category in filteredShortcuts"
          :key="category.id"
          :heading="category.title"
        >
          <CommandItem
            v-for="shortcut in category.shortcuts"
            :key="shortcut.event"
            :value="shortcut.event"
            class="grow justify-start gap-3 truncate"
            @click="
              () => {
                openCommand = false
                emitter.emit(shortcut.event, shortcut.parameters)
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
                    <BreadcrumbPage>{{ step }}</BreadcrumbPage>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator
                    v-if="stepIndex < shortcut.description.length - 1"
                  />
                </template>
              </BreadcrumbList>
            </Breadcrumb>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
      </CommandList>
    </CommandDialog>
  </div>
</template>

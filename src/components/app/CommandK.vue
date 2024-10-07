<script lang="ts" setup>
import { shortcuts } from "@/helpers/shortcuts"
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useCurrentUser } from "vuefire"

const openCommand = ref(false)

emitter.on("Dialog.Command.Open", () => {
  openCommand.value = !openCommand.value
})

const filteredShortcuts = computed(() =>
  shortcuts.filter((category) => {
    const webCondition = isTauri.value ? true : !category.hidden.includes("web")

    const tauriCondition = isTauri.value
      ? !category.hidden.includes("tauri")
      : true

    const hiddenCondition = !category.hidden.includes("command")

    return webCondition && tauriCondition && hiddenCondition
  })
)

const user = useCurrentUser()
</script>

<template>
  <div>
    <div class="relative items-center">
      <span
        class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-2"
      >
        <icon-lucide-search class="text-muted-foreground" />
      </span>
      <Button
        variant="ghost"
        class="justify-start bg-muted/75 pl-7 pr-16 font-normal text-muted-foreground"
        size="xs"
        @click="openCommand = true"
      >
        Search
      </Button>
      <span
        class="pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center gap-1 px-2"
      >
        <kbd class="shortcut-key">
          <span class="scale-75">⌘</span>
        </kbd>
        <kbd class="shortcut-key">
          <span class="scale-75">K</span>
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
        <template
          v-for="(category, index) in filteredShortcuts"
          :key="category.id"
        >
          <CommandGroup :heading="category.title">
            <CommandItem
              v-for="shortcut in category.shortcuts"
              :key="shortcut.event"
              :value="shortcut.event + shortcut.parameters + shortcut.tags"
              class="grow justify-start gap-3 truncate"
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
                      <BreadcrumbPage>{{ step }}</BreadcrumbPage>
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
                    <span class="scale-75">
                      {{ key }}
                    </span>
                  </kbd>
                </template>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator v-if="index < filteredShortcuts.length - 1" />
        </template>
      </CommandList>
    </CommandDialog>
    <Settings v-if="user" />
    <ExitTrigger v-if="user" />
  </div>
</template>

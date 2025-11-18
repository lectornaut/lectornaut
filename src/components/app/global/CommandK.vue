<script lang="ts" setup>
import {
  shortcuts,
  type Shortcut,
  type ShortcutCategory,
} from "@/helpers/shortcuts"
import { isTauri } from "@/helpers/utilities"
import emitter from "@/modules/mitt"

defineProps<{
  iconDisplay?: "icon" | "text"
}>()

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
  <Dialog v-model:open="openCommand">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <DialogTrigger as-child>
            <Button
              id="tour-search-bar"
              variant="ghost"
              :size="iconDisplay === 'text' ? 'default' : 'icon'"
            >
              <icon-lucide-search />
              <span v-if="iconDisplay === 'text'" class="hidden md:flex"
                >Search</span
              >
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Commands
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <DialogContent class="bg-sidebar-accent p-1.5">
      <Command highlight-on-hover class="border">
        <CommandInput
          placeholder="Type a command or search"
          class="border-none p-0 focus:border-inherit focus:ring-0"
        />
        <CommandList class="group min-h-80">
          <CommandEmpty class="text-muted-foreground">
            No results found.
          </CommandEmpty>
          <template
            v-for="(category, index) in filteredShortcuts"
            :key="category.id"
          >
            <CommandGroup :heading="category.title">
              <CommandItem
                v-for="shortcut in category.shortcuts"
                :key="shortcut.event"
                :value="shortcut.event + shortcut.parameters + shortcut.tags"
                class="py-2"
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
                  <KbdGroup
                    v-for="keys in shortcut.keys"
                    :key="keys.toString()"
                  >
                    <Kbd v-for="key in keys" :key="key">
                      {{ key }}
                    </Kbd>
                  </KbdGroup>
                </CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator
              v-if="index < filteredShortcuts.length - 1"
              class="group-has-data-[slot=command-empty]:hidden group-has-[[data-slot=command-group][hidden]]:hidden"
            />
          </template>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
</template>

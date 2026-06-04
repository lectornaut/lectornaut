<script lang="ts" setup>
import { isTauri } from "@/composables/usePlatform"
import { getFilteredShortcuts } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()

const openCommand = ref(false)

emitter.on("Dialog.Command.Open", () => {
  openCommand.value = !openCommand.value
})

const filteredShortcuts = computed(() =>
  getFilteredShortcuts({
    context: "commands",
    isDesktop: isTauri.value,
  })
)
</script>

<template>
  <Dialog v-model:open="openCommand">
    <DialogContent class="bg-secondary p-1.75">
      <Command highlight-on-hover class="border">
        <CommandInput
          :placeholder="t('components.global.commandK.placeholder')"
          class="placeholder:text-muted-foreground border-none bg-transparent focus:border-inherit focus:ring-0"
        />
        <CommandList class="group min-h-80 w-full">
          <CommandEmpty>
            {{ t("components.global.commandK.noResults") }}
          </CommandEmpty>
          <template
            v-for="(category, index) in filteredShortcuts"
            :key="category.id"
          >
            <CommandGroup
              :heading="category.title"
              class="**:data-[slot=command-group-heading]:text-muted-foreground **:data-[slot=command-group-heading]:p-2 **:data-[slot=command-group-heading]:text-xs **:data-[slot=command-group-heading]:font-medium"
            >
              <CommandItem
                v-for="shortcut in category.shortcuts"
                :key="shortcut.event"
                :value="shortcut.event + shortcut.parameters + shortcut.tags"
                class="data-highlighted:bg-muted data-highlighted:text-foreground data-highlighted:**:[svg]:text-foreground"
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
                <CommandShortcut
                  v-if="shortcut.keys"
                  class="group-data-highlighted/command-item:text-foreground"
                >
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

<script lang="ts" setup>
import {
  useCommandPalette,
  type PaletteCommand,
} from "@/composables/useCommandPalette"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()

const openCommand = ref(false)
const query = ref("")

emitter.on("Dialog.Command.Open", () => {
  openCommand.value = !openCommand.value
})

const { groups } = useCommandPalette()

// Empty query → the curated highlight groups; typing → search everything.
const visibleGroups = computed(() =>
  query.value.trim()
    ? groups.value
    : groups.value.filter((group) => group.highlight)
)

// Reopen on the highlights view, never on a stale search.
watch(openCommand, (open) => {
  if (!open) query.value = ""
})

// Close first, run on the next tick: actions that move focus (tab rename,
// nested dialogs) must not race the closing dialog's focus restore.
const runCommand = (command: PaletteCommand) => {
  openCommand.value = false
  nextTick(() => command.run())
}
</script>

<template>
  <Dialog v-model:open="openCommand">
    <DialogContent class="bg-secondary min-w-lg p-1" :show-close-button="false">
      <Command highlight-on-hover class="border">
        <CommandKBridge v-model:query="query" />
        <CommandInput
          :placeholder="t('components.global.commandK.placeholder')"
          class="placeholder:text-muted-foreground border-none bg-transparent focus:border-inherit focus:ring-0"
        />
        <CommandList class="group min-h-80 w-full">
          <CommandEmpty>
            {{ t("components.global.commandK.noResults") }}
          </CommandEmpty>
          <template v-for="(group, index) in visibleGroups" :key="group.id">
            <CommandGroup
              :heading="group.heading"
              class="**:data-[slot=command-group-heading]:text-muted-foreground **:data-[slot=command-group-heading]:py-2 **:data-[slot=command-group-heading]:pl-2 **:data-[slot=command-group-heading]:text-xs **:data-[slot=command-group-heading]:font-medium"
            >
              <CommandItem
                v-for="command in group.commands"
                :key="command.id"
                :value="command.id"
                @select="() => runCommand(command)"
              >
                <AppAvatar
                  v-if="command.avatar"
                  class="size-4"
                  :src="command.avatar.src"
                  :name="command.avatar.name"
                />
                <Component :is="command.icon" v-else-if="command.icon" />
                <Breadcrumb>
                  <BreadcrumbList>
                    <template
                      v-for="(step, stepIndex) in command.label"
                      :key="stepIndex"
                    >
                      <BreadcrumbItem>
                        <BreadcrumbPage>
                          {{ step }}
                        </BreadcrumbPage>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator
                        v-if="stepIndex < command.label.length - 1"
                      />
                    </template>
                  </BreadcrumbList>
                </Breadcrumb>
                <!--
                  Search aliases: the Command filter matches the item's
                  textContent, so hidden text makes tags searchable without
                  showing (or announcing) them.
                -->
                <span v-if="command.keywords" class="hidden">
                  {{ command.keywords }}
                </span>
                <CommandShortcut
                  v-if="command.keys?.length"
                  class="group-data-highlighted/command-item:text-foreground"
                >
                  <KbdGroup>
                    <Kbd v-for="key in command.keys" :key="key">
                      {{ key }}
                    </Kbd>
                  </KbdGroup>
                </CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator
              v-if="index < visibleGroups.length - 1"
              class="group-has-data-[slot=command-empty]:hidden group-has-[[data-slot=command-group][hidden]]:hidden"
            />
          </template>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
</template>

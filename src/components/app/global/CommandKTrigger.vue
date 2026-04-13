<script lang="ts" setup>
import { IconSearch } from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { emitter } from "@/modules/mitt"

defineProps<{
  iconDisplay?: "icon" | "text"
}>()

const { t } = useI18n()

const openCommandDialog = () => {
  emitter.emit("Dialog.Command.Open")
}
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          id="tour-search-bar"
          variant="ghost"
          :size="iconDisplay === 'text' ? 'sm' : 'icon'"
          @click="openCommandDialog"
        >
          <IconSearch />
          <template v-if="iconDisplay === 'text'">
            {{ t("components.global.shortcuts.search") }}
          </template>
        </Button>
      </TooltipTrigger>
      <TooltipContent class="flex items-center gap-2 pr-2">
        {{ t("components.global.commandK.tooltip") }}
        <KbdGroup>
          <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

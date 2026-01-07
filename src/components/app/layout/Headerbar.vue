<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"

const { t } = useI18n()
const { isMobile } = useSidebar()
const isFullscreen = useIsFullscreen()

const iconDisplay = ref<"icon" | "text">("icon")
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <header
        class="min-h-titlebar-height bg-sidebar ml-titlebar-left max-w-titlebar-width pt-safe-top shadow-border relative z-40 flex w-full shrink-0 shadow-[0px_1px]"
      >
        <div
          data-tauri-drag-region
          class="grid size-full grid-cols-3 items-center gap-2 p-2"
        >
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-start gap-2 transition-all"
            :class="{ 'pl-20': isTauri && !isFullscreen }"
          >
            <SidebarTrigger v-if="isMobile" />
            <Logo class="size-8 p-2" />
            <Separator orientation="vertical" class="max-h-4 min-h-4" />
            <TasksNotifications :icon-display="iconDisplay" />
          </div>
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-center gap-2"
          >
            <CommandK :icon-display="iconDisplay" />
          </div>
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-end gap-2"
          >
            <AiAsk :icon-display="iconDisplay" />
          </div>
        </div>
      </header>
    </ContextMenuTrigger>
    <ContextMenuContent align="start" side="bottom">
      <ContextMenuLabel class="text-muted-foreground text-xs">
        {{ t("titlebar.appearance") }}
      </ContextMenuLabel>
      <ContextMenuRadioGroup v-model="iconDisplay">
        <ContextMenuRadioItem value="icon">
          {{ t("titlebar.iconsOnly") }}
        </ContextMenuRadioItem>
        <ContextMenuRadioItem value="text">
          {{ t("titlebar.iconsAndText") }}
        </ContextMenuRadioItem>
      </ContextMenuRadioGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>

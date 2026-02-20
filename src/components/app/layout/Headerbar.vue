<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { emitter } from "@/modules/mitt"
import { useLayoutStore } from "@/stores/layoutStore"
import { storeToRefs } from "pinia"

const { t } = useI18n()
const { isMobile } = useSidebar()
const isFullscreen = useIsFullscreen()
const layoutStore = useLayoutStore()
const { headerIconDisplay } = storeToRefs(layoutStore)

watch(isMobile, (val) => {
  if (val) {
    emitter.emit("Sidebar.Left.Collapse")
    emitter.emit("Sidebar.Right.Collapse")
  } else {
    emitter.emit("Sidebar.Left.Expand")
    emitter.emit("Sidebar.Right.Expand")
  }
})
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <header
        class="min-h-titlebar-height ml-titlebar-left max-w-titlebar-width pt-safe-top relative z-40 w-full shrink-0"
      >
        <div data-tauri-drag-region class="grid grid-cols-3 gap-2 p-2">
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-start gap-2 transition-all"
            :class="{ 'pl-20': isTauri && !isFullscreen }"
          >
            <Logo class="size-8 shrink-0 p-2" />
            <SidebarTrigger v-if="isMobile" class="size-8" />
            <Separator orientation="vertical" class="max-h-4 min-h-4" />
            <Notifications :icon-display="headerIconDisplay" />
          </div>
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-center gap-2 transition-all"
          >
            <WorkspaceSwitcher />
          </div>
          <div
            data-tauri-drag-region
            class="flex grow items-center justify-end gap-2 transition-all"
          >
            <CommandKTrigger :icon-display="headerIconDisplay" />
            <AiAsk :icon-display="headerIconDisplay" />
          </div>
        </div>
      </header>
    </ContextMenuTrigger>
    <ContextMenuContent align="start" side="bottom">
      <ContextMenuLabel class="text-muted-foreground text-xs">
        {{ t("titlebar.appearance") }}
      </ContextMenuLabel>
      <ContextMenuRadioGroup v-model="headerIconDisplay">
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

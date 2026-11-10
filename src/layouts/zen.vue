<script lang="ts" setup>
import { useMacOSWindowControls } from "@/composables/useMacOSWindowControls"
import { useMacOSTrafficLightsVisible } from "@/composables/usePlatform"
import { useMenuAwareHoverCard } from "@/composables/useMenuAwareHoverCard"
import { IconLeaf } from "@/data/icons"
import { SIDEBAR_MOBILE_BREAKPOINT } from "@/components/ui/sidebar/utils"
import { useMediaQuery } from "@vueuse/core"

const { t } = useI18n()
const macOSTrafficLightsVisible = useMacOSTrafficLightsVisible()
const isMobile = useMediaQuery(
  `(max-width: ${SIDEBAR_MOBILE_BREAKPOINT - 1}px)`
)
const windowControlsHeader = useTemplateRef<HTMLElement>("windowControlsHeader")
useMacOSWindowControls(windowControlsHeader)

// Zen renders no sidebar, so the trigger (and ⌘B) opens the preview instead.
const previewOpen = ref(false)
const preview = useMenuAwareHoverCard((v) => (previewOpen.value = v))
</script>

<template>
  <SidebarProvider
    :open="false"
    class="contents"
    @update:open="previewOpen = $event"
  >
    <div
      v-if="!isMobile"
      class="min-h-titlebar-height pt-safe-top fixed top-0 left-0 z-40"
    >
      <div
        ref="windowControlsHeader"
        data-tauri-drag-region="deep"
        class="flex items-center px-2 pt-2"
        :class="{ 'pl-macos-window-controls': macOSTrafficLightsVisible }"
      >
        <HoverCard
          :open="previewOpen"
          :open-delay="500"
          :close-delay="0"
          @update:open="preview.onUpdateOpen"
        >
          <HoverCardTrigger as-child>
            <SidebarTrigger v-motion-fade />
          </HoverCardTrigger>
          <HoverCardContent
            side="bottom"
            align="start"
            :side-offset="8"
            v-bind="preview.contentAttrs"
            class="flex h-[80svh] flex-col overflow-clip p-0"
          >
            <MainSidebar preview />
          </HoverCardContent>
        </HoverCard>
      </div>
    </div>
  </SidebarProvider>
  <RouterView />
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          :aria-label="t('ai.exitZenMode')"
          variant="ghost"
          size="icon-sm"
          class="fixed bottom-2 left-2"
          as-child
        >
          <RouterLink to="/home" :aria-label="t('ai.exitZenMode')">
            <IconLeaf />
          </RouterLink>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ t("ai.exitZenMode") }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

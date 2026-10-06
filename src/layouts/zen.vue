<script lang="ts" setup>
import { useMacOSTrafficLightsVisible } from "@/composables/usePlatform"
import { IconLeaf } from "@/data/icons"
import { useMediaQuery } from "@vueuse/core"

const { t } = useI18n()
const macOSTrafficLightsVisible = useMacOSTrafficLightsVisible()
const isMobile = useMediaQuery("(max-width: 768px)")

// Zen renders no sidebar, so the trigger (and ⌘B) opens the preview instead.
const previewOpen = ref(false)
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
        data-tauri-drag-region="deep"
        class="flex items-center px-2 pt-2"
        :class="{ 'pl-macos-window-controls': macOSTrafficLightsVisible }"
      >
        <HoverCard
          v-model:open="previewOpen"
          :open-delay="500"
          :close-delay="0"
        >
          <HoverCardTrigger as-child>
            <SidebarTrigger v-motion-fade />
          </HoverCardTrigger>
          <HoverCardContent
            side="bottom"
            align="start"
            :side-offset="8"
            class="h-[80svh] overflow-clip p-0"
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

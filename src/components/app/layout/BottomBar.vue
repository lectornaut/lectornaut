<script lang="ts" setup>
import { IconLeaf } from "@/data/icons"

const { t } = useI18n()
</script>

<template>
  <div
    data-tauri-drag-region="deep"
    class="no-scrollbar flex min-w-0 shrink-0 items-center justify-end gap-2 overflow-x-auto p-2"
  >
    <TooltipProvider>
      <div class="mr-auto flex min-w-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" class="shrink-0" as-child>
              <RouterLink to="/zen" :aria-label="t('ai.zenMode')">
                <IconLeaf />
              </RouterLink>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t("ai.zenMode") }}</TooltipContent>
        </Tooltip>
        <SyncIndicator />
        <KeyHints />
      </div>
      <AiBar />
    </TooltipProvider>
  </div>
</template>

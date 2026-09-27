<script lang="ts" setup>
import { IconDownload, IconRefreshCw } from "@/data/icons"
import {
  downloadAndInstallUpdate,
  lastCheckResult,
  restartToApplyUpdate,
  updateDownloadPercent,
  updateStage,
} from "@/modules/updater"

const { t } = useI18n()

const visible = computed(() => updateStage.value !== "idle")

const tooltip = computed(() => {
  if (updateStage.value === "downloading")
    return t("updater.downloadingProgress", {
      percent: updateDownloadPercent.value,
    })
  if (updateStage.value === "ready") return t("updater.restart")
  return t("updater.updateAvailable")
})

async function handleClick() {
  if (updateStage.value === "ready") {
    await restartToApplyUpdate()
    return
  }

  const update = lastCheckResult.value?.update
  if (!update) return

  try {
    await downloadAndInstallUpdate(update)
  } catch (error) {
    console.error("Error downloading update:", error)
  }
}
</script>

<template>
  <TooltipProvider v-if="visible">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          v-motion-fade
          size="icon-sm"
          :aria-label="tooltip"
          :disabled="updateStage === 'downloading'"
          @click="handleClick"
        >
          <Spinner v-if="updateStage === 'downloading'" />
          <IconRefreshCw v-else-if="updateStage === 'ready'" />
          <IconDownload v-else />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ tooltip }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

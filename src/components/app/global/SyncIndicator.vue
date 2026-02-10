<script setup lang="ts">
import { IconCloudAlert, IconCloudCheck, IconCloudSync } from "@/data/icons"
import { useCloudSyncQueueState } from "@/utils/firebase/firebase-optimistic"

defineProps<{
  iconDisplay: "icon" | "text"
}>()

const { t } = useI18n()
const isOnline = useOnline()
const { activeCount, hasError, isSyncing, lastErrorMessage } =
  useCloudSyncQueueState()

const syncState = computed(() => {
  if (!isOnline.value) return "offline"
  if (isSyncing.value) return "syncing"
  if (hasError.value) return "error"
  return "synced"
})

const syncLabel = computed(() => {
  if (syncState.value === "syncing" && activeCount.value > 0) {
    return `${t("layouts.app.statusBar.sync")} (${activeCount.value})`
  }
  return t("layouts.app.statusBar.sync")
})

const syncTooltip = computed(() => {
  if (syncState.value === "offline") {
    return t("layouts.app.status.offline")
  }

  if (syncState.value === "syncing") {
    if (activeCount.value > 1) {
      return `${t("layouts.app.status.syncing")} (${activeCount.value})`
    }
    return t("layouts.app.status.syncing")
  }

  if (syncState.value === "error") {
    return lastErrorMessage.value || "Cloud sync failed"
  }

  return t("layouts.app.status.synced")
})
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button variant="ghost" :size="iconDisplay === 'text' ? 'sm' : 'icon-sm'">
        <IconCloudAlert
          v-if="syncState === 'offline' || syncState === 'error'"
          :class="{ 'text-destructive': syncState === 'error' }"
        />
        <IconCloudSync v-else-if="syncState === 'syncing'" />
        <IconCloudCheck v-else />
        <template v-if="iconDisplay === 'text'">
          {{ syncLabel }}
        </template>
      </Button>
    </TooltipTrigger>
    <TooltipContent>{{ syncTooltip }}</TooltipContent>
  </Tooltip>
</template>

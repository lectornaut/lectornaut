<script setup lang="ts">
import { IconCloudAlert, IconCloudCheck, IconCloudSync } from "@/data/icons"
import { useCloudSyncQueueState } from "@/utils/firebase/firebase-optimistic"
import { useSyncEngineState } from "@/utils/firebase/firebase-sync-engine"

defineProps<{
  iconDisplay: "icon" | "text"
}>()

const { t } = useI18n()
const isOnline = useOnline()
const { activeCount, hasError, isSyncing, lastErrorMessage } =
  useCloudSyncQueueState()
const { pendingCount } = useSyncEngineState()

const syncCount = computed(() =>
  Math.max(activeCount.value, pendingCount.value)
)

const syncState = computed(() => {
  if (!isOnline.value) return "offline"
  if (isSyncing.value || pendingCount.value > 0) return "syncing"
  if (hasError.value) return "error"
  return "synced"
})

const syncLabel = computed(() => {
  if (syncState.value === "syncing" && syncCount.value > 0) {
    return `${t("layouts.app.statusBar.sync")} (${syncCount.value})`
  }
  return t("layouts.app.statusBar.sync")
})

const syncTooltip = computed(() => {
  if (syncState.value === "offline") {
    return t("layouts.app.status.offline")
  }

  if (syncState.value === "syncing") {
    if (syncCount.value > 1) {
      return `${t("layouts.app.status.syncing")} (${syncCount.value})`
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
      <Button variant="ghost" :size="iconDisplay === 'text' ? 'sm' : 'icon'">
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

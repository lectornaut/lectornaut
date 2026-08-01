<script setup lang="ts">
import {
  IconCloudAlert,
  IconCloudCheck,
  IconCloudSync,
  IconRefreshCcw,
} from "@/data/icons"
import { useCloudSyncQueueState } from "@/utils/firebase/firebase-optimistic"
import { useSyncEngineState } from "@/utils/firebase/firebase-sync-engine"

const { t } = useI18n()
const isOnline = useOnline()
const {
  activeCount,
  hasError,
  hasRetry,
  isSyncing,
  lastErrorAt,
  lastErrorMessage,
  lastSuccessAt,
  retryLastError,
} = useCloudSyncQueueState()
const { pendingCount } = useSyncEngineState()

const syncCount = computed(() =>
  Math.max(activeCount.value, pendingCount.value)
)

const lastSuccessTimeAgo = useTimeAgo(() => lastSuccessAt.value ?? Date.now())
const lastSuccessDate = useDateFormat(
  () => lastSuccessAt.value ?? Date.now(),
  "MMM D, YYYY · h:mm A"
)
const lastErrorTimeAgo = useTimeAgo(() => lastErrorAt.value ?? Date.now())
const lastErrorDate = useDateFormat(
  () => lastErrorAt.value ?? Date.now(),
  "MMM D, YYYY · h:mm A"
)

const syncState = computed(() => {
  if (!isOnline.value) return "offline"
  if (isSyncing.value || pendingCount.value > 0) return "syncing"
  if (hasError.value) return "error"
  return "synced"
})

const syncLabel = computed(() => {
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
    return lastErrorMessage.value || t("layouts.app.status.failed")
  }

  return t("layouts.app.status.synced")
})

const syncIcon = computed(() => {
  if (syncState.value === "offline" || syncState.value === "error") {
    return IconCloudAlert
  }

  if (syncState.value === "syncing") return IconCloudSync

  return IconCloudCheck
})

const syncIconClass = computed(() => {
  if (syncState.value === "error") return "text-destructive"
  if (syncState.value === "offline") return "text-muted-foreground"
  if (syncState.value === "synced") return "text-emerald-600"
  return "text-muted-foreground"
})

const syncBadgeClass = computed(() => {
  if (syncState.value === "error") return "bg-destructive/10 text-destructive"
  if (syncState.value === "offline") return "bg-muted text-muted-foreground"
  if (syncState.value === "synced") return "bg-emerald-500/10 text-emerald-600"
  return "bg-secondary text-secondary-foreground"
})

const syncTitle = computed(() => {
  if (syncState.value === "offline") {
    return t("layouts.app.status.hovercard.offlineTitle")
  }

  if (syncState.value === "syncing") {
    return t("layouts.app.status.hovercard.syncingTitle")
  }

  if (syncState.value === "error") {
    return t("layouts.app.status.hovercard.errorTitle")
  }

  return t("layouts.app.status.hovercard.syncedTitle")
})

const syncDescription = computed(() => {
  if (syncState.value === "offline") {
    return t("layouts.app.status.hovercard.offlineDescription")
  }

  if (syncState.value === "syncing") {
    return t("layouts.app.status.hovercard.syncingDescription")
  }

  if (syncState.value === "error") {
    return t("layouts.app.status.hovercard.errorDescription")
  }

  return t("layouts.app.status.hovercard.syncedDescription")
})

const errorMessage = computed(
  () => lastErrorMessage.value || t("layouts.app.status.failed")
)
</script>

<template>
  <TooltipProvider>
    <HoverCard :open-delay="150" :close-delay="0">
      <Tooltip>
        <TooltipTrigger as-child>
          <HoverCardTrigger as-child>
            <Component :is="syncIcon" :class="syncIconClass" />
          </HoverCardTrigger>
          <HoverCardContent side="bottom" class="flex w-60 flex-col gap-2 p-2">
            <Item class="group" size="xs">
              <ItemMedia
                variant="icon"
                class="size-8 rounded-md"
                :class="syncBadgeClass"
              >
                <Component :is="syncIcon" class="size-4" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{{ syncTitle }}</ItemTitle>
                <ItemDescription class="text-xs">
                  {{ syncDescription }}
                </ItemDescription>
              </ItemContent>
            </Item>

            <div
              v-if="
                syncCount > 0 ||
                lastSuccessAt ||
                (syncState === 'error' && lastErrorAt)
              "
              class="space-y-2 px-3 pb-1"
            >
              <div
                v-if="syncCount > 0"
                class="flex items-center justify-between gap-2 text-xs"
              >
                <span class="text-muted-foreground">{{
                  t("layouts.app.status.hovercard.pendingChanges")
                }}</span>
                <Badge variant="secondary" class="tabular-nums">
                  {{ syncCount }}
                </Badge>
              </div>

              <div
                v-if="lastSuccessAt"
                class="flex items-center justify-between gap-2 text-xs"
              >
                <span class="text-muted-foreground">{{
                  t("layouts.app.status.hovercard.lastSynced")
                }}</span>
                <Badge
                  as="time"
                  variant="secondary"
                  :title="lastSuccessDate"
                  :datetime="new Date(lastSuccessAt).toISOString()"
                >
                  {{ lastSuccessTimeAgo }}
                </Badge>
              </div>

              <div
                v-if="syncState === 'error' && lastErrorAt"
                class="flex items-center justify-between gap-2 text-xs"
              >
                <span class="text-muted-foreground">{{
                  t("layouts.app.status.hovercard.lastError")
                }}</span>
                <Badge
                  as="time"
                  variant="destructive"
                  :title="lastErrorDate"
                  :datetime="new Date(lastErrorAt).toISOString()"
                >
                  {{ lastErrorTimeAgo }}
                </Badge>
              </div>
            </div>

            <div
              v-if="syncState === 'error'"
              class="bg-destructive/10 rounded-md px-3 py-2"
            >
              <p class="text-destructive text-xs font-medium">
                {{ t("layouts.app.status.hovercard.errorDetails") }}
              </p>
              <p
                :title="errorMessage"
                class="text-muted-foreground line-clamp-3 text-xs leading-relaxed"
              >
                {{ errorMessage }}
              </p>

              <Button
                v-if="hasRetry"
                variant="secondary"
                size="xs"
                class="mt-2"
                @click="retryLastError"
              >
                <IconRefreshCcw />
                {{ t("actions.retry") }}
              </Button>
            </div>
          </HoverCardContent>
        </TooltipTrigger>
        <TooltipContent>{{ syncLabel }}</TooltipContent>
      </Tooltip>
    </HoverCard>
  </TooltipProvider>
</template>

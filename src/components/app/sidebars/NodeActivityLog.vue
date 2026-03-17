<script lang="ts" setup>
import { useNodeActivityLogs } from "@/composables/useNodeActivityLogs"
import {
  IconAlertTriangle,
  IconFilePlus,
  IconHistory,
  IconMinusSquare,
  IconPenLine,
  IconPencil,
  IconRefreshCcw,
  IconRotateCcw,
  IconSwitchHorizontal,
  IconTrash2,
  IconUpload,
} from "@/data/icons"
import type { ILogEntry } from "@/types/logs"
import { toRefs } from "vue"

const props = defineProps<{
  teamId: string | null
  workspaceId: string | null
  documentId: string | null
}>()

const { teamId, workspaceId, documentId } = toRefs(props)
const scrollableContainer = useTemplateRef<ComponentPublicInstance>(
  "scrollableContainer"
)

const { logs, loading, error, hasMore, canViewLogs, fetchLogs } =
  useNodeActivityLogs({
    teamId,
    workspaceId,
    documentId,
  })

const ACTION_LABELS = {
  "content.create": "Created",
  "content.rename": "Renamed",
  "content.move": "Moved",
  "content.update": "Edited",
  "content.archive": "Archived",
  "content.unarchive": "Restored",
  "content.delete": "Deleted",
  "content.attachment.create": "Uploaded attachment",
  "content.attachment.rename": "Renamed attachment",
  "content.attachment.update": "Replaced attachment",
  "content.attachment.delete": "Deleted attachment",
} as const

const ACTION_ICONS = {
  "content.create": IconFilePlus,
  "content.rename": IconPencil,
  "content.move": IconSwitchHorizontal,
  "content.update": IconPenLine,
  "content.archive": IconMinusSquare,
  "content.unarchive": IconRotateCcw,
  "content.delete": IconTrash2,
  "content.attachment.create": IconUpload,
  "content.attachment.rename": IconPencil,
  "content.attachment.update": IconRefreshCcw,
  "content.attachment.delete": IconTrash2,
} as const

const hasSelectedNode = computed(() =>
  Boolean(teamId.value && workspaceId.value && documentId.value)
)

const resolveTimestamp = (entry: ILogEntry) => entry.timestamp?.toDate?.()

const formatTimestamp = (entry: ILogEntry) => {
  const timestamp = resolveTimestamp(entry)
  return timestamp ? useTimeAgo(timestamp).value : "—"
}

const formatTimestampTitle = (entry: ILogEntry) => {
  const timestamp = resolveTimestamp(entry)
  return timestamp
    ? useDateFormat(timestamp, "MMM D, YYYY · h:mm A").value
    : undefined
}

const formatTimestampDateTime = (entry: ILogEntry) => {
  const timestamp = entry.timestamp?.toDate?.()
  return timestamp ? timestamp.toISOString() : undefined
}

const formatActor = (entry: ILogEntry) =>
  entry.actor?.email || entry.actor?.userId || "Unknown"

const formatAction = (entry: ILogEntry) => {
  const label = ACTION_LABELS[entry.action as keyof typeof ACTION_LABELS]
  if (label) return label

  const raw = entry.action.includes(".")
    ? (entry.action.split(".").slice(-1)[0] ?? entry.action)
    : entry.action

  return raw
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

const getActionIcon = (entry: ILogEntry) =>
  ACTION_ICONS[entry.action as keyof typeof ACTION_ICONS] ?? IconHistory

const formatChangeSummary = (entry: ILogEntry) => {
  if (entry.action === "content.attachment.create") {
    return "uploaded an attachment"
  }
  if (entry.action === "content.attachment.rename") {
    return "renamed an attachment"
  }
  if (entry.action === "content.attachment.update") {
    return "replaced an attachment"
  }
  if (entry.action === "content.attachment.delete") {
    return "deleted an attachment"
  }

  const fields = entry.changes?.fields?.filter(Boolean) ?? []
  if (!fields.length) return null

  if (fields.length === 1) {
    const [field] = fields
    if (field === "content") {
      return "edited the document"
    }
    return `changed ${field}`
  }

  return `changed ${fields.length} fields`
}

const refreshLogs = () => fetchLogs(true)
const loadMore = () => fetchLogs(false)

useInfiniteScroll(
  () => scrollableContainer.value?.$el as HTMLElement,
  () => {
    loadMore()
  },
  {
    distance: 10,
    canLoadMore: () =>
      hasSelectedNode.value &&
      canViewLogs.value &&
      hasMore.value &&
      !loading.value,
  }
)
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <SidebarContent>
      <OverlayScrollbarsWrapper ref="scrollableContainer">
        <SidebarGroup>
          <SidebarGroupContent>
            <div
              v-if="!hasSelectedNode"
              class="text-muted-foreground p-2 text-xs"
            >
              Select a file or folder to view activity history.
            </div>

            <div
              v-else-if="!canViewLogs"
              class="text-muted-foreground p-2 text-xs"
            >
              You do not have permission to view activity history.
            </div>

            <div v-else-if="loading && logs.length === 0" class="p-2">
              <div
                class="text-muted-foreground flex items-center gap-2 text-xs"
              >
                <Spinner />
                Loading activity history...
              </div>
            </div>

            <div v-else-if="error" class="space-y-2 p-2">
              <div class="text-destructive flex items-start gap-2 text-xs">
                <IconAlertTriangle class="mt-0.5 size-3.5 shrink-0" />
                <span>{{ error }}</span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                class="w-full"
                @click="refreshLogs"
              >
                Retry
              </Button>
            </div>

            <div
              v-else-if="logs.length === 0"
              class="text-muted-foreground p-2 text-xs"
            >
              No history available for this item.
            </div>

            <template v-else>
              <Stepper
                orientation="vertical"
                :model-value="-1"
                class="flex flex-col gap-0"
              >
                <StepperItem
                  v-for="(entry, index) in logs"
                  :key="entry.id"
                  :step="index + 1"
                  class="flex items-start self-stretch"
                >
                  <div class="relative flex flex-col items-center self-stretch">
                    <StepperIndicator as-child>
                      <Button variant="outline" size="icon-sm">
                        <Component :is="getActionIcon(entry)" />
                      </Button>
                    </StepperIndicator>
                    <StepperSeparator
                      v-if="index < logs.length - 1"
                      orientation="vertical"
                      class="bg-border w-px grow"
                    />
                  </div>

                  <div class="flex grow flex-col gap-2 p-2">
                    <StepperTitle>
                      {{ formatActor(entry) }}
                    </StepperTitle>
                    <StepperDescription v-if="formatChangeSummary(entry)">
                      {{ formatChangeSummary(entry) }}
                    </StepperDescription>
                    <div class="flex items-start justify-between gap-2">
                      <p class="text-xs font-medium">
                        {{ formatAction(entry) }}
                      </p>
                      <time
                        class="text-muted-foreground shrink-0 text-xs"
                        :datetime="formatTimestampDateTime(entry)"
                        :title="formatTimestampTitle(entry)"
                      >
                        {{ formatTimestamp(entry) }}
                      </time>
                    </div>
                  </div>
                </StepperItem>
              </Stepper>

              <div v-if="loading" class="flex justify-center p-2">
                <Spinner />
              </div>
            </template>
          </SidebarGroupContent>
        </SidebarGroup>
      </OverlayScrollbarsWrapper>
    </SidebarContent>
  </Sidebar>
</template>

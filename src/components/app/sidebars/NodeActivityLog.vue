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
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { isAgentMembership, isUserMembership } from "@/types/membership"
import type { ILogEntry } from "@/types/logs"
import { storeToRefs } from "pinia"

type OverlayScrollbarsWrapperRef = ComponentPublicInstance<{
  getScrollElement: () => HTMLElement | undefined
}>

const props = defineProps<{
  teamId: string
  workspaceId: string
  documentId: string
}>()

// `useNodeActivityLogs` takes nullable refs because it serves other callers
// that can be "not yet ready". This component is gated by the inspector's
// v-if so the values are always non-null here — widen at the boundary.
const teamId = computed<string | null>(() => props.teamId)
const workspaceId = computed<string | null>(() => props.workspaceId)
const documentId = computed<string | null>(() => props.documentId)

const scrollableContainer = useTemplateRef<OverlayScrollbarsWrapperRef>(
  "scrollableContainer"
)

const { logs, loading, error, hasMore, canViewLogs, fetchLogs } =
  useNodeActivityLogs({
    teamId,
    workspaceId,
    documentId,
  })

const { currentUser, userProfile } = storeToRefs(useAuthStore())
const { teamMembers } = storeToRefs(useMembershipStore())

const teamMembersByUserId = computed(
  () =>
    new Map(
      teamMembers.value
        .filter(isUserMembership)
        .map((member) => [member.userId, member])
    )
)

const agentMembersById = computed(
  () =>
    new Map(
      teamMembers.value
        .filter(isAgentMembership)
        .map((member) => [member.agentId, member])
    )
)

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

interface ResolvedActor {
  name: string
  email: string | null
}

const resolveActor = (entry: ILogEntry): ResolvedActor => {
  // Agent member acting on a human's behalf — show the agent as the actor,
  // with the driving user's email as the secondary line.
  const agentId = entry.actor?.agentId
  if (agentId) {
    const agentName =
      entry.actor?.agentName ||
      agentMembersById.value.get(agentId)?.agent.name ||
      "Agent"
    const driverEmail = entry.actor?.userId
      ? (teamMembersByUserId.value.get(entry.actor.userId)?.user?.email ?? null)
      : null
    return { name: agentName, email: driverEmail }
  }

  const userId = entry.actor?.userId
  const fallbackEmail = entry.actor?.email ?? null

  if (!userId) {
    return { name: fallbackEmail ?? "Unknown", email: null }
  }

  let displayName: string | null = null
  let email = fallbackEmail

  if (currentUser.value?.uid === userId) {
    displayName =
      userProfile.value?.displayName || currentUser.value.displayName || null
    email = currentUser.value.email ?? email
  } else {
    const member = teamMembersByUserId.value.get(userId)
    if (member) {
      displayName = member.user?.displayName ?? null
      email = member.user?.email ?? email
    }
  }

  const name = displayName || email || userId
  return {
    name,
    email: email && email !== name ? email : null,
  }
}

const actorsByEntryId = computed(() => {
  const map = new Map<string, ResolvedActor>()
  for (const entry of logs.value) {
    map.set(entry.id, resolveActor(entry))
  }
  return map
})

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
  () => scrollableContainer.value?.getScrollElement(),
  () => {
    loadMore()
  },
  {
    distance: 10,
    canLoadMore: () => canViewLogs.value && hasMore.value && !loading.value,
  }
)
</script>

<template>
  <div class="flex size-full min-h-0 grow flex-col">
    <OverlayScrollbarsWrapper ref="scrollableContainer">
      <div class="space-y-3 p-2">
        <div v-if="!canViewLogs" class="text-muted-foreground text-xs">
          You do not have permission to view activity history.
        </div>

        <Empty v-else-if="loading && logs.length === 0" class="p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Spinner />
            </EmptyMedia>
            <EmptyTitle>Loading activity history...</EmptyTitle>
          </EmptyHeader>
        </Empty>

        <div v-else-if="error" class="space-y-2">
          <div class="text-destructive flex items-start gap-2 text-xs">
            <IconAlertTriangle />
            <span>{{ error }}</span>
          </div>
          <Button variant="secondary" class="w-full" @click="refreshLogs">
            Retry
          </Button>
        </div>

        <Empty
          v-else-if="logs.length === 0"
          class="rounded-xl border border-dashed p-6"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconHistory />
            </EmptyMedia>
            <EmptyTitle>No activity yet</EmptyTitle>
            <EmptyDescription>
              No history available for this item.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

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
                  <Button variant="outline" size="icon-xs">
                    <Component :is="getActionIcon(entry)" />
                  </Button>
                </StepperIndicator>
                <StepperSeparator
                  v-if="index < logs.length - 1"
                  orientation="vertical"
                  class="bg-border w-px grow"
                />
              </div>

              <div class="flex min-w-0 grow flex-col gap-2 p-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex min-w-0 flex-col">
                    <StepperTitle class="truncate">
                      {{ actorsByEntryId.get(entry.id)?.name }}
                    </StepperTitle>
                    <span
                      v-if="actorsByEntryId.get(entry.id)?.email"
                      class="text-muted-foreground truncate text-xs"
                    >
                      {{ actorsByEntryId.get(entry.id)?.email }}
                    </span>
                  </div>
                  <time
                    class="text-muted-foreground shrink-0 text-xs"
                    :datetime="formatTimestampDateTime(entry)"
                    :title="formatTimestampTitle(entry)"
                  >
                    {{ formatTimestamp(entry) }}
                  </time>
                </div>
                <p class="text-xs font-medium">
                  {{ formatAction(entry) }}
                </p>
                <StepperDescription v-if="formatChangeSummary(entry)">
                  {{ formatChangeSummary(entry) }}
                </StepperDescription>
              </div>
            </StepperItem>
          </Stepper>

          <div v-if="loading" class="flex justify-center">
            <Spinner />
          </div>
        </template>
      </div>
    </OverlayScrollbarsWrapper>
  </div>
</template>

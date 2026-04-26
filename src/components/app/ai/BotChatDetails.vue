<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import {
  IconArchive,
  IconCalendar,
  IconClock,
  IconGlobe,
  IconHash,
  IconHistory,
  IconLock,
  IconUserRound,
  IconUsers,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IBotSessionVisibility } from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { storeToRefs } from "pinia"
import { computed, inject } from "vue"

const botChat = inject(BotChatContextKey)
const { currentUser } = storeToRefs(useAuthStore())
const { teamMembers } = storeToRefs(useMembershipStore())

const sessionId = computed(() => botChat?.sessionId.value ?? null)
const activeSession = computed(() => botChat?.activeSession.value ?? null)
const activeVisibility = computed(
  () => botChat?.activeVisibility.value ?? "private"
)
const isActiveOwner = computed(() => botChat?.isActiveOwner.value ?? false)
const isActiveArchived = computed(
  () => botChat?.isActiveArchived.value ?? false
)
const localMessageCount = computed(() => botChat?.messages.value.length ?? 0)

const tsToDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate()
  return null
}

const formatAbsolute = (date: Date | null): string => {
  if (!date) return "—"
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

const visibilityIcon = (v: IBotSessionVisibility) => {
  if (v === "shared") return IconUsers
  if (v === "public") return IconGlobe
  return IconLock
}

const visibilityLabel = (v: IBotSessionVisibility): string => {
  if (v === "shared") return "Shared with team"
  if (v === "public") return "Public"
  return "Private"
}

/**
 * Resolve the owner's display name via the team-members map. The
 * membership doc carries a denormalized `user` snapshot so this is a
 * pure in-memory lookup — no extra Firestore read.
 *
 * Owner resolution states:
 *   - self     → "You"
 *   - resolved → displayName ?? email ?? "Team member"
 *   - former   → "Former member" (teamMembers loaded, owner missing)
 *   - unknown  → "Team member" (memberships still loading)
 *
 * Distinguishing former-member from still-loading uses a property of
 * teams: every team has at least one member (the creator-owner), so
 * `teamMembers.length === 0` reliably means "not yet loaded".
 */
const ownerMember = computed(() => {
  const uid = activeSession.value?.ownerUid
  if (!uid) return null
  return teamMembers.value.find((m) => m.userId === uid) ?? null
})

const isOwnerFormer = computed(() => {
  const session = activeSession.value
  if (!session) return false
  if (session.ownerUid === currentUser.value?.uid) return false
  if (teamMembers.value.length === 0) return false // memberships still loading
  return ownerMember.value === null
})

const ownerLabel = computed(() => {
  const session = activeSession.value
  if (!session) return ""
  if (session.ownerUid === currentUser.value?.uid) return "You"
  if (isOwnerFormer.value) return "Former member"
  const snapshot = ownerMember.value?.user
  return snapshot?.displayName?.trim() || snapshot?.email || "Team member"
})

const ownerPhotoURL = computed(() => ownerMember.value?.user?.photoURL ?? null)

const createdAt = computed(() => tsToDate(activeSession.value?.createdAt))
const updatedAt = computed(() => tsToDate(activeSession.value?.updatedAt))
const archivedAt = computed(() => tsToDate(activeSession.value?.archivedAt))

const messageCount = computed(() => {
  // Prefer server-derived count (covers history not yet fetched into the
  // local list); fall back to the local list for fresh new chats.
  return activeSession.value?.messageCount ?? localMessageCount.value
})

interface DetailRow {
  id: string
  label: string
  value: string
  icon: typeof IconClock
}

// Owner gets a richer custom row (avatar + name) rendered above the
// data-driven `dl`; everything else is straight label/value pairs.
const detailRows = computed<DetailRow[]>(() => {
  if (!activeSession.value) return []
  const rows: DetailRow[] = [
    {
      id: "created",
      label: "Created",
      value: formatAbsolute(createdAt.value),
      icon: IconCalendar,
    },
    {
      id: "updated",
      label: "Last activity",
      value: formatAbsolute(updatedAt.value),
      icon: IconClock,
    },
    {
      id: "messages",
      label: "Messages",
      value: String(messageCount.value),
      icon: IconHash,
    },
  ]
  if (archivedAt.value) {
    rows.push({
      id: "archived",
      label: "Archived",
      value: formatAbsolute(archivedAt.value),
      icon: IconArchive,
    })
  }
  return rows
})
</script>

<template>
  <SidebarContent>
    <OverlayScrollbarsWrapper>
      <SidebarGroup>
        <SidebarGroupContent class="space-y-3 p-2">
          <div
            v-if="!sessionId"
            class="text-muted-foreground flex flex-col items-center gap-2 py-6 text-center text-xs"
          >
            <IconHistory class="size-5 opacity-60" />
            <p>Start or open a chat to see its details.</p>
          </div>
          <template v-else>
            <div class="space-y-1">
              <p
                class="text-foreground line-clamp-2 text-base leading-tight font-medium"
              >
                {{ activeSession?.title || "Untitled chat" }}
              </p>
              <p
                v-if="activeSession?.preview"
                class="text-muted-foreground line-clamp-2 text-xs"
              >
                {{ activeSession.preview }}
              </p>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline" class="gap-1">
                <component :is="visibilityIcon(activeVisibility)" />
                {{ visibilityLabel(activeVisibility) }}
              </Badge>
              <Badge v-if="isActiveOwner" variant="secondary">Owner</Badge>
              <Badge v-else variant="secondary">Read-only</Badge>
              <Badge v-if="isActiveArchived" variant="outline" class="gap-1">
                <IconArchive />
                Archived
              </Badge>
            </div>

            <dl class="space-y-3 pt-1">
              <div class="flex items-start justify-between gap-2">
                <dt class="text-muted-foreground flex items-center gap-2">
                  <IconUserRound />
                  Owner
                </dt>
                <dd
                  class="flex min-w-0 items-center gap-2 text-right"
                  :class="{ 'text-muted-foreground italic': isOwnerFormer }"
                >
                  <Avatar
                    class="size-5 shrink-0"
                    :class="{ 'opacity-60': isOwnerFormer }"
                  >
                    <AvatarImage
                      v-if="ownerPhotoURL"
                      :src="ownerPhotoURL"
                      :alt="ownerLabel"
                      referrerpolicy="no-referrer"
                    />
                    <AvatarFallback class="text-[10px]">
                      <IconUserRound v-if="isOwnerFormer" class="size-3" />
                      <template v-else>{{ getInitials(ownerLabel) }}</template>
                    </AvatarFallback>
                  </Avatar>
                  <span class="truncate text-sm font-medium">
                    {{ ownerLabel }}
                  </span>
                </dd>
              </div>
              <div
                v-for="row in detailRows"
                :key="row.id"
                class="flex items-start justify-between gap-2"
              >
                <dt class="text-muted-foreground flex items-center gap-2">
                  <component :is="row.icon" />
                  {{ row.label }}
                </dt>
                <dd class="text-right text-sm font-medium">{{ row.value }}</dd>
              </div>
            </dl>
          </template>
        </SidebarGroupContent>
      </SidebarGroup>
    </OverlayScrollbarsWrapper>
  </SidebarContent>
</template>

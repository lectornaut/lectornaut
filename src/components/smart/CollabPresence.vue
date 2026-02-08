<script lang="ts" setup>
import { getInitials } from "@/helpers/utilities"
import type { Awareness } from "y-protocols/awareness"

interface PresenceUser {
  peerId: string
  userId: string
  name: string
  photoURL: string | null
  color: string
}

const props = withDefaults(
  defineProps<{
    awareness: Awareness | null
    maxVisible?: number
  }>(),
  {
    maxVisible: 5,
  }
)

const users = ref<PresenceUser[]>([])

const syncUsers = () => {
  if (!props.awareness) {
    users.value = []
    return
  }

  const nextUsers: PresenceUser[] = []

  props.awareness.getStates().forEach((rawState) => {
    const state = rawState as {
      peerId?: unknown
      user?: {
        userId?: unknown
        name?: unknown
        photoURL?: unknown
        color?: unknown
      }
    }

    if (!state?.user) {
      return
    }

    if (
      typeof state.peerId !== "string" ||
      typeof state.user.userId !== "string" ||
      typeof state.user.name !== "string"
    ) {
      return
    }

    nextUsers.push({
      peerId: state.peerId,
      userId: state.user.userId,
      name: state.user.name,
      photoURL:
        typeof state.user.photoURL === "string" && state.user.photoURL
          ? state.user.photoURL
          : null,
      color:
        typeof state.user.color === "string" && state.user.color.trim().length
          ? state.user.color
          : "#3b82f6",
    })
  })

  users.value = nextUsers.sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

const visibleUsers = computed(() => users.value.slice(0, props.maxVisible))
const overflowCount = computed(() =>
  Math.max(users.value.length - props.maxVisible, 0)
)

watch(
  () => props.awareness,
  (nextAwareness, previousAwareness) => {
    if (previousAwareness) {
      previousAwareness.off("change", syncUsers)
      previousAwareness.off("update", syncUsers)
    }

    if (nextAwareness) {
      nextAwareness.on("change", syncUsers)
      nextAwareness.on("update", syncUsers)
      syncUsers()
      return
    }

    users.value = []
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (!props.awareness) {
    return
  }

  props.awareness.off("change", syncUsers)
  props.awareness.off("update", syncUsers)
})
</script>

<template>
  <div v-if="users.length" class="flex items-center gap-2">
    <TooltipProvider>
      <Tooltip v-for="participant in visibleUsers" :key="participant.peerId">
        <TooltipTrigger as-child>
          <Avatar
            class="ring-offset-sidebar -ml-2 size-5 ring-2 ring-offset-2 first:ml-0"
            :style="{ '--tw-ring-color': participant.color }"
          >
            <AvatarImage
              :src="participant.photoURL || ''"
              :alt="participant.name"
              referrerpolicy="no-referrer"
            />
            <AvatarFallback>
              {{ getInitials(participant.name) }}
            </AvatarFallback>
          </Avatar>
        </TooltipTrigger>
        <TooltipContent side="top">
          {{ participant.name }}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <span v-if="overflowCount > 0" class="text-muted-foreground text-xs">
      +{{ overflowCount }}
    </span>
  </div>
</template>

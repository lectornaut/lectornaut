<script lang="ts" setup>
import { usePopout } from "@/composables/usePopout"
import { useAuthStore } from "@/stores/authStore"
import type { IBotSession } from "@/types/domain"
import { createBotSessionsQuery } from "@/utils/firebase/firebase-helpers"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import { storeToRefs } from "pinia"

const { t } = useI18n()

const { isPoppedOut, poppedOutSessionId, openChatInPopout } = usePopout()

const { currentUser, currentTeamId, currentWorkspaceId } =
  storeToRefs(useAuthStore())

// Same query descriptor (path + params) as `useBotChat`'s `mySessions`,
// so the bar shares that one cache entry and Firestore listener instead
// of opening a second subscription over the same docs.
const sessionsQuery = useCollectionQuery<IBotSession>(() => {
  const teamId = currentTeamId.value
  const workspaceId = currentWorkspaceId.value
  const uid = currentUser.value?.uid
  if (!teamId || !workspaceId || !uid) return null
  return {
    query: createBotSessionsQuery(teamId, workspaceId, uid),
    path: `teams/${teamId}/workspaces/${workspaceId}/botSessions`,
    params: { ownerUid: uid },
  }
})

// Archived wins over pinned: archiving is the user saying "get this out
// of my way", and the sidebar already hides archived chats from the
// Pinned group for the same reason.
const pinnedSessions = computed(() =>
  (sessionsQuery.data.value ?? []).filter((s) => s.pinnedAt && !s.archivedAt)
)

const sessionTitle = (session: IBotSession) =>
  session.title || t("ai.untitledChat")

// One window, swapped in place — clicking a different pinned chat
// replaces what the pop-out holds rather than opening a second floating
// window. A genuinely parallel chat is a real OS window (AiAsk's
// pop-out), which handles focus and placement properly.
const openChat = (session: IBotSession) => {
  openChatInPopout(session.id, sessionTitle(session))
}

const isOpenInPopout = (session: IBotSession) =>
  isPoppedOut.value && poppedOutSessionId.value === session.id
</script>

<template>
  <div
    data-tauri-drag-region="deep"
    class="no-scrollbar flex min-w-0 shrink-0 items-center justify-end gap-2 overflow-x-auto px-2 pb-2 transition-all"
  >
    <TooltipProvider>
      <Tooltip v-for="session in pinnedSessions" :key="session.id">
        <TooltipTrigger as-child>
          <Button
            :variant="isOpenInPopout(session) ? 'default' : 'outline'"
            size="sm"
            class="shadow-none"
            @click="openChat(session)"
          >
            <span class="max-w-32 truncate">{{ sessionTitle(session) }}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ sessionTitle(session) }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <AiAsk />

    <!-- The pop-out frame (drag / resize / minimize) lives in
         MainLayout; only its content is ours. `defer` waits for the
         dock to mount, and the `v-if` keeps us from targeting an id
         that doesn't exist while the window is closed. -->
    <Teleport v-if="isPoppedOut && poppedOutSessionId" defer to="#popout-dock">
      <PoppedOutChat />
    </Teleport>
  </div>
</template>

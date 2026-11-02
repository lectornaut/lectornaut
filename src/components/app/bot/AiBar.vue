<script lang="ts" setup>
import { useBotSessionActions } from "@/composables/useBotSessionActions"
import { usePopout } from "@/composables/usePopout"
import {
  IconArchive,
  IconPencil,
  IconPinOff,
  IconPlus,
  IconTrash2,
} from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import type { IBotSession } from "@/types/domain"
import { createBotSessionsQuery } from "@/utils/firebase/firebase-helpers"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import { storeToRefs } from "pinia"

const { t } = useI18n()

const {
  isPoppedOut,
  poppedOutSessionId,
  openChatInPopout,
  closeChatWindow,
  startNewChat,
  forgetSession,
} = usePopout()
const { renameSession, archiveSession, pinSession, removeSession } =
  useBotSessionActions()

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
// replaces what the floating window holds rather than opening a second floating
// window. A genuinely parallel chat is a real OS window (AiAsk's
// pop-out), which handles focus and placement properly.
// Clicking the active chat again closes the shared floating/sidebar frame.
const openChat = (session: IBotSession) => {
  if (isOpenInPopout(session)) {
    closeChatWindow()
  } else {
    openChatInPopout(session.id, sessionTitle(session))
  }
}

const isOpenInPopout = (session: IBotSession) =>
  isPoppedOut.value && poppedOutSessionId.value === session.id

const onUnpin = (session: IBotSession) => {
  void pinSession(session.id, false)
}

const onArchive = (session: IBotSession) => {
  void archiveSession(session.id, true)
}

// Rename dialog

const renameDialogOpen = ref(false)
const renameTarget = ref<IBotSession | null>(null)

const openRename = (session: IBotSession) => {
  renameTarget.value = session
  renameDialogOpen.value = true
}

const saveRename = (title: string) =>
  renameSession(renameTarget.value!.id, title)

// Delete confirmation

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IBotSession | null>(null)

const openDelete = (session: IBotSession) => {
  deleteTarget.value = session
  deleteDialogOpen.value = true
}

const submitDelete = async () => {
  const target = deleteTarget.value
  if (!target || !(await removeSession(target.id))) return false
  forgetSession(target.id)
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div class="flex shrink-0 items-center gap-2">
        <TooltipProvider>
          <Tooltip v-for="session in pinnedSessions" :key="session.id">
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <TooltipTrigger as-child>
                  <Button
                    :variant="
                      isOpenInPopout(session) ? 'destructive' : 'secondary'
                    "
                    size="sm"
                    :class="[
                      isOpenInPopout(session)
                        ? ''
                        : 'bg-secondary/50 text-secondary-foreground/50 hover:bg-secondary/75 hover:text-secondary-foreground/75',
                    ]"
                    @click="openChat(session)"
                  >
                    <span class="max-w-32 truncate">{{
                      sessionTitle(session)
                    }}</span>
                  </Button>
                </TooltipTrigger>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem @click="onUnpin(session)">
                  <IconPinOff />
                  {{ t("actions.unpin") }}
                </ContextMenuItem>
                <ContextMenuItem @click="openRename(session)">
                  <IconPencil />
                  {{ t("actions.rename") }}
                </ContextMenuItem>
                <ContextMenuItem @click="onArchive(session)">
                  <IconArchive />
                  {{ t("ai.archive") }}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  @click="openDelete(session)"
                >
                  <IconTrash2 />
                  {{ t("actions.delete") }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <TooltipContent>{{ sessionTitle(session) }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <AiAsk />
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem @click="startNewChat">
        <IconPlus />
        {{ t("ai.newChat") }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>

  <SessionRenameDialog
    v-model:open="renameDialogOpen"
    :title="renameTarget?.title"
    :on-save="saveRename"
  />

  <ConfirmAction
    v-model:open="deleteDialogOpen"
    :title="t('ai.deleteChatTitle')"
    :action-label="t('actions.delete')"
    destructive
    :on-confirm="submitDelete"
  >
    <template #description>
      <span class="text-foreground font-medium">{{
        deleteTarget?.title || t("ai.thisChat")
      }}</span>
      {{ t("ai.deleteChatConfirm") }}
    </template>
  </ConfirmAction>
</template>

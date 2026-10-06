<script lang="ts" setup>
import { useBotSessionActions } from "@/composables/useBotSessionActions"
import { usePopout } from "@/composables/usePopout"
import {
  IconArchive,
  IconLeaf,
  IconPencil,
  IconPinOff,
  IconPlus,
  IconTrash2,
} from "@/data/icons"
import { emitter } from "@/modules/mitt"
import { useAuthStore } from "@/stores/authStore"
import type { IBotSession } from "@/types/domain"
import { createBotSessionsQuery } from "@/utils/firebase/firebase-helpers"
import { useCollectionQuery } from "@/utils/firebase/firebase-query"
import { storeToRefs } from "pinia"

const { t } = useI18n()

const { isPoppedOut, poppedOutSessionId, openChatInPopout } = usePopout()
const { isMutating, renameSession, archiveSession, pinSession, removeSession } =
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
// replaces what the pop-out holds rather than opening a second floating
// window. A genuinely parallel chat is a real OS window (AiAsk's
// pop-out), which handles focus and placement properly.
const openChat = (session: IBotSession) => {
  openChatInPopout(session.id, sessionTitle(session))
}

const isOpenInPopout = (session: IBotSession) =>
  isPoppedOut.value && poppedOutSessionId.value === session.id

// Opens the AiAsk sheet, same as the sidebar's "Ask AI" trigger — it
// always starts a fresh session on open, so this reads as "new chat".
const onNewChat = () => {
  emitter.emit("Dialog.AiAsk.Toggle")
}

const onUnpin = (session: IBotSession) => {
  void pinSession(session.id, false)
}

const onArchive = (session: IBotSession) => {
  void archiveSession(session.id, true)
}

// Rename dialog

const renameDialogOpen = ref(false)
const renameTarget = ref<IBotSession | null>(null)
const renameInput = ref("")

const openRename = (session: IBotSession) => {
  renameTarget.value = session
  renameInput.value = session.title ?? ""
  renameDialogOpen.value = true
}

const submitRename = async () => {
  const target = renameTarget.value
  if (!target || isMutating.value) return
  const next = renameInput.value.trim()
  if (!next || next === (target.title ?? "")) {
    renameDialogOpen.value = false
    return
  }
  if (await renameSession(target.id, next)) {
    renameDialogOpen.value = false
    renameTarget.value = null
  }
}

// Delete confirmation

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IBotSession | null>(null)

const openDelete = (session: IBotSession) => {
  deleteTarget.value = session
  deleteDialogOpen.value = true
}

const submitDelete = async () => {
  const target = deleteTarget.value
  if (!target || isMutating.value) return
  if (await removeSession(target.id)) {
    deleteDialogOpen.value = false
    deleteTarget.value = null
    if (poppedOutSessionId.value === target.id) {
      isPoppedOut.value = false
      poppedOutSessionId.value = null
    }
  }
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        data-tauri-drag-region="deep"
        class="no-scrollbar flex min-w-0 shrink-0 items-center justify-end gap-2 overflow-x-auto px-2 pb-2"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                class="mr-auto shrink-0"
                as-child
              >
                <RouterLink to="/zen" :aria-label="t('ai.zenMode')">
                  <IconLeaf />
                </RouterLink>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t("ai.zenMode") }}</TooltipContent>
          </Tooltip>
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
                <ContextMenuItem @click="openDelete(session)">
                  <IconTrash2 />
                  {{ t("actions.delete") }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <TooltipContent>{{ sessionTitle(session) }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <AiAsk />

        <!-- The pop-out frame (drag / resize / minimize) lives in
             MainLayout; only its content is ours. `defer` waits for the
             dock to mount, and the `v-if` keeps us from targeting an id
             that doesn't exist while the window is closed. -->
        <Teleport
          v-if="isPoppedOut && poppedOutSessionId"
          defer
          to="#popout-dock"
        >
          <PoppedOutChat />
        </Teleport>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem @click="onNewChat">
        <IconPlus />
        {{ t("ai.newChat") }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>

  <!-- Rename dialog -->
  <Dialog v-model:open="renameDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t("ai.renameChat") }}</DialogTitle>
        <DialogDescription>
          {{ t("ai.renameChatHint") }}
        </DialogDescription>
      </DialogHeader>
      <form @submit.prevent="submitRename">
        <Field>
          <FieldLabel for="ai-bar-rename-input">{{
            t("ai.chatTitle")
          }}</FieldLabel>
          <Input
            id="ai-bar-rename-input"
            v-model="renameInput"
            :placeholder="t('ai.chatTitlePlaceholder')"
            maxlength="120"
            :disabled="isMutating"
          />
        </Field>
      </form>
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" :disabled="isMutating">
            {{ t("actions.cancel") }}
          </Button>
        </DialogClose>
        <Button
          :disabled="isMutating || !renameInput.trim()"
          @click="submitRename"
        >
          <Spinner v-if="isMutating" />
          {{ t("actions.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Delete confirm -->
  <AlertDialog v-model:open="deleteDialogOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("ai.deleteChatTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          <span class="text-foreground font-medium">{{
            deleteTarget?.title || t("ai.thisChat")
          }}</span>
          {{ t("ai.deleteChatConfirm") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isMutating">
          {{ t("actions.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          :disabled="isMutating"
          @click.prevent="submitDelete"
        >
          <Spinner v-if="isMutating" />
          {{ t("actions.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

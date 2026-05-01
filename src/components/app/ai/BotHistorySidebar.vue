<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import {
  IconArchive,
  IconGlobe,
  IconHistory,
  IconLock,
  IconMessageCircleMore,
  IconMoreHorizontal,
  IconPencil,
  IconPlus,
  IconRotateCcw,
  IconTrash2,
  IconUsers,
} from "@/data/icons"
import type { IBotSession, IBotSessionVisibility } from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { computed, inject, nextTick, ref } from "vue"
import { useRouter } from "vue-router"

const botChat = inject(BotChatContextKey)

const mySessions = computed(() => botChat?.mySessions.value ?? [])
const archivedMySessions = computed(
  () => botChat?.archivedMySessions.value ?? []
)
const sharedSessions = computed(() => botChat?.sharedSessions.value ?? [])
const activeSessionId = computed(() => botChat?.sessionId.value ?? null)
const isLoadingSessions = computed(
  () => botChat?.isLoadingSessions.value ?? false
)
const isMutating = computed(() => botChat?.isMutatingSession.value ?? false)

interface SessionGroup {
  label: string
  items: IBotSession[]
}

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const formatRelative = (date: Date | null): string => {
  if (!date) return ""
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "now"
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

const sessionDate = (session: IBotSession): Date | null => {
  const value = session.updatedAt
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate()
  return null
}

const visibilityIcon = (visibility: IBotSessionVisibility) => {
  if (visibility === "shared") return IconUsers
  if (visibility === "public") return IconGlobe
  return IconLock
}

const visibilityLabel = (visibility: IBotSessionVisibility): string => {
  if (visibility === "shared") return "Shared with team"
  if (visibility === "public") return "Public"
  return "Private"
}

const groupByTime = (sessions: IBotSession[]): SessionGroup[] => {
  const today: IBotSession[] = []
  const yesterday: IBotSession[] = []
  const lastWeek: IBotSession[] = []
  const older: IBotSession[] = []

  const todayStart = startOfToday()
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000
  const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000

  for (const s of sessions) {
    const date = sessionDate(s)
    const ts = date ? date.getTime() : 0
    if (ts >= todayStart) today.push(s)
    else if (ts >= yesterdayStart) yesterday.push(s)
    else if (ts >= weekStart) lastWeek.push(s)
    else older.push(s)
  }

  const out: SessionGroup[] = []
  if (today.length) out.push({ label: "Today", items: today })
  if (yesterday.length) out.push({ label: "Yesterday", items: yesterday })
  if (lastWeek.length) out.push({ label: "Previous 7 days", items: lastWeek })
  if (older.length) out.push({ label: "Older", items: older })
  return out
}

const myGroups = computed(() => groupByTime(mySessions.value))
const sharedGroups = computed(() => groupByTime(sharedSessions.value))

const isEmpty = computed(
  () =>
    !isLoadingSessions.value &&
    mySessions.value.length === 0 &&
    sharedSessions.value.length === 0 &&
    archivedMySessions.value.length === 0
)

// ── Dialogs ─────────────────────────────────────────────────────────────────

const renameDialogOpen = ref(false)
const renameTarget = ref<IBotSession | null>(null)
const renameInput = ref("")
const renameInputEl = ref<HTMLInputElement | null>(null)

const openRename = (session: IBotSession) => {
  renameTarget.value = session
  renameInput.value = session.title ?? ""
  renameDialogOpen.value = true
  nextTick(() => renameInputEl.value?.focus())
}

const submitRename = async () => {
  const target = renameTarget.value
  if (!target) return
  const next = renameInput.value.trim()
  if (!next || next === (target.title ?? "")) {
    renameDialogOpen.value = false
    return
  }
  await botChat?.renameSession(target.id, next)
  renameDialogOpen.value = false
  renameTarget.value = null
}

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IBotSession | null>(null)

const openDelete = (session: IBotSession) => {
  deleteTarget.value = session
  deleteDialogOpen.value = true
}

const submitDelete = async () => {
  const target = deleteTarget.value
  if (!target) return
  await botChat?.removeSession(target.id)
  deleteDialogOpen.value = false
  deleteTarget.value = null
}

// ── Row actions ─────────────────────────────────────────────────────────────

// Navigation drives session state — the bot page's URL watcher picks up
// the change and calls `selectSession` / `startNewSession` accordingly.
// This keeps every chat linkable: copying the URL is enough to share a
// pointer to that conversation.
const router = useRouter()

const onNewChat = () => {
  void router.push("/bot")
}

const onSelectSession = (id: string) => {
  void router.push(`/bot/${id}`)
}

const onArchiveToggle = (session: IBotSession) => {
  void botChat?.archiveSession(session.id, !session.archivedAt)
}
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <SidebarHeader>
      <div class="flex items-center justify-between gap-2">
        <span class="text-foreground ml-2 text-base font-medium">History</span>
        <Button variant="ghost" size="icon" @click="onNewChat">
          <IconPlus />
          <span class="sr-only">New chat</span>
        </Button>
      </div>
    </SidebarHeader>
    <Separator />
    <SidebarContent>
      <OverlayScrollbarsWrapper>
        <div
          v-if="isEmpty"
          class="text-muted-foreground flex flex-col items-center gap-2 p-6 text-center text-xs"
        >
          <IconHistory class="size-5 opacity-60" />
          <p>No chats yet. Start a new conversation to see it here.</p>
        </div>

        <template v-if="mySessions.length > 0">
          <SidebarGroup v-for="group in myGroups" :key="`mine-${group.label}`">
            <SidebarGroupLabel class="flex items-center gap-2">
              <IconHistory v-if="group.label === 'Today'" />
              {{ group.label }}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem
                  v-for="item in group.items"
                  :key="item.id"
                  class="group/history relative"
                >
                  <ContextMenu>
                    <ContextMenuTrigger as-child>
                      <SidebarMenuButton
                        :is-active="item.id === activeSessionId"
                        class="h-auto items-start gap-2 py-2 pr-8"
                        @click="onSelectSession(item.id)"
                      >
                        <IconMessageCircleMore class="mt-0.5 shrink-0" />
                        <span class="flex min-w-0 grow flex-col">
                          <span class="flex items-center gap-1.5">
                            <span class="truncate text-sm">
                              {{ item.title || "New chat" }}
                            </span>
                            <component
                              :is="visibilityIcon(item.visibility)"
                              v-if="item.visibility !== 'private'"
                              class="text-muted-foreground size-3 shrink-0"
                              :aria-label="visibilityLabel(item.visibility)"
                            />
                          </span>
                          <span
                            v-if="item.preview"
                            class="text-muted-foreground line-clamp-1 text-xs"
                          >
                            {{ item.preview }}
                          </span>
                        </span>
                        <span
                          class="text-muted-foreground shrink-0 text-[10px]"
                        >
                          {{ formatRelative(sessionDate(item)) }}
                        </span>
                      </SidebarMenuButton>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem @click="openRename(item)">
                        <IconPencil />
                        Rename
                      </ContextMenuItem>
                      <ContextMenuItem @click="onArchiveToggle(item)">
                        <IconArchive />
                        Archive
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem @click="openDelete(item)">
                        <IconTrash2 />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        class="absolute top-2 right-2 opacity-0 group-hover/history:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        aria-label="Chat actions"
                        @click.stop
                      >
                        <IconMoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @click="openRename(item)">
                        <IconPencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="onArchiveToggle(item)">
                        <IconArchive />
                        Archive
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem @click="openDelete(item)">
                        <IconTrash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </template>

        <template v-if="sharedSessions.length > 0">
          <Separator class="my-1" />
          <SidebarGroup
            v-for="group in sharedGroups"
            :key="`shared-${group.label}`"
          >
            <SidebarGroupLabel class="flex items-center gap-2">
              <IconUsers />
              <span>Shared · {{ group.label }}</span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem
                  v-for="item in group.items"
                  :key="item.id"
                  class="group/history relative"
                >
                  <SidebarMenuButton
                    :is-active="item.id === activeSessionId"
                    class="h-auto items-start gap-2 py-2"
                    @click="onSelectSession(item.id)"
                  >
                    <IconMessageCircleMore class="mt-0.5 shrink-0" />
                    <span class="flex min-w-0 grow flex-col">
                      <span class="flex items-center gap-1.5">
                        <span class="truncate text-sm">
                          {{ item.title || "Untitled" }}
                        </span>
                        <IconUsers
                          class="text-muted-foreground size-3 shrink-0"
                          aria-label="Shared with team"
                        />
                      </span>
                      <span
                        v-if="item.preview"
                        class="text-muted-foreground line-clamp-1 text-xs"
                      >
                        {{ item.preview }}
                      </span>
                    </span>
                    <span class="text-muted-foreground shrink-0 text-[10px]">
                      {{ formatRelative(sessionDate(item)) }}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </template>

        <template v-if="archivedMySessions.length > 0">
          <Separator class="my-1" />
          <SidebarGroup>
            <SidebarGroupLabel class="flex items-center gap-2">
              <IconArchive />
              Archived
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem
                  v-for="item in archivedMySessions"
                  :key="item.id"
                  class="group/history relative"
                >
                  <ContextMenu>
                    <ContextMenuTrigger as-child>
                      <SidebarMenuButton
                        :is-active="item.id === activeSessionId"
                        class="h-auto items-start gap-2 py-2 pr-8 opacity-70"
                        @click="onSelectSession(item.id)"
                      >
                        <IconArchive class="mt-0.5 shrink-0" />
                        <span class="flex min-w-0 grow flex-col">
                          <span class="truncate text-sm">
                            {{ item.title || "Untitled" }}
                          </span>
                          <span
                            v-if="item.preview"
                            class="text-muted-foreground line-clamp-1 text-xs"
                          >
                            {{ item.preview }}
                          </span>
                        </span>
                        <span
                          class="text-muted-foreground shrink-0 text-[10px]"
                        >
                          {{ formatRelative(sessionDate(item)) }}
                        </span>
                      </SidebarMenuButton>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem @click="onArchiveToggle(item)">
                        <IconRotateCcw />
                        Restore
                      </ContextMenuItem>
                      <ContextMenuItem @click="openRename(item)">
                        <IconPencil />
                        Rename
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem @click="openDelete(item)">
                        <IconTrash2 />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        class="absolute top-2 right-2 opacity-0 group-hover/history:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        aria-label="Chat actions"
                        @click.stop
                      >
                        <IconMoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @click="onArchiveToggle(item)">
                        <IconRotateCcw />
                        Restore
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="openRename(item)">
                        <IconPencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem @click="openDelete(item)">
                        <IconTrash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </template>
      </OverlayScrollbarsWrapper>
    </SidebarContent>
  </Sidebar>

  <!-- Rename dialog -->
  <Dialog v-model:open="renameDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename chat</DialogTitle>
        <DialogDescription>
          Pick a name that helps you find this chat later.
        </DialogDescription>
      </DialogHeader>
      <form class="grid gap-2" @submit.prevent="submitRename">
        <Label for="bot-rename-input">Title</Label>
        <Input
          id="bot-rename-input"
          ref="renameInputEl"
          v-model="renameInput"
          placeholder="e.g. Q3 launch checklist"
          maxlength="120"
          :disabled="isMutating"
        />
      </form>
      <DialogFooter>
        <Button
          variant="ghost"
          :disabled="isMutating"
          @click="renameDialogOpen = false"
        >
          Cancel
        </Button>
        <Button
          :disabled="isMutating || !renameInput.trim()"
          @click="submitRename"
        >
          <Spinner v-if="isMutating" />
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Delete confirm -->
  <AlertDialog v-model:open="deleteDialogOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
        <AlertDialogDescription>
          <span class="text-foreground font-medium">{{
            deleteTarget?.title || "This chat"
          }}</span>
          will be permanently deleted, including all of its messages. This
          action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isMutating">Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          class="text-current"
          :disabled="isMutating"
          @click.prevent="submitDelete"
        >
          <Spinner v-if="isMutating" />
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

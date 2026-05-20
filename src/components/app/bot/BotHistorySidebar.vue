<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import { useBotSessionFilter } from "@/composables/useBotSessionFilter"
import {
  IconArchive,
  IconChevronRight,
  IconGlobe,
  IconHistory,
  IconLock,
  IconMoreHorizontal,
  IconPencil,
  IconPlus,
  IconRotateCcw,
  IconSearch,
  IconTrash2,
  IconUsers,
  IconX,
} from "@/data/icons"
import type { IBotSession, IBotSessionVisibility } from "@/types/domain"
import { Timestamp } from "firebase/firestore"
import { computed, inject, nextTick, ref } from "vue"
import { useRouter } from "vue-router"

const botChat = inject(BotChatContextKey)
const { t } = useI18n()

// Filter + search state — instance-local, so the history sidebar's
// filter state doesn't leak into the inspector's Bot tab (or vice
// versa). Each composable call returns a fresh, independently reactive
// piece of state.
const filter = useBotSessionFilter()

const rawMySessions = computed(() => botChat?.mySessions.value ?? [])
const rawArchivedMySessions = computed(
  () => botChat?.archivedMySessions.value ?? []
)
const rawSharedSessions = computed(() => botChat?.sharedSessions.value ?? [])

// Pipe each list through the filter. Search and most checkbox filters
// apply uniformly, but `onlyShared` is naturally about the *other*
// list — applying it to `mySessions` would hide everything since I'm
// always the owner. We special-case it: when `onlyShared` is true, the
// "my chats" group disappears entirely and only `sharedSessions`
// shows. This matches user intent ("show me chats shared with me").
const mySessions = computed(() =>
  filter.state.onlyShared ? [] : filter.filter(rawMySessions.value)
)
// Archived is rendered as a single flat block, so just apply the
// global `sortBy` — grouping doesn't add value for a typically-small
// list users open infrequently.
const archivedMySessions = computed(() =>
  filter.state.onlyShared
    ? []
    : filter.sortSessions(filter.filter(rawArchivedMySessions.value))
)
const sharedSessions = computed(() => filter.filter(rawSharedSessions.value))
const activeSessionId = computed(() => botChat?.sessionId.value ?? null)
const isLoadingSessions = computed(
  () => botChat?.isLoadingSessions.value ?? false
)
const isMutating = computed(() => botChat?.isMutatingSession.value ?? false)

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
  if (visibility === "shared") return t("ai.visibilityShared")
  if (visibility === "public") return t("ai.visibilityPublic")
  return t("ai.visibilityPrivate")
}

// The composable emits stable keys ("today" / "private" / "all" / …)
// rather than localized strings, so i18n stays in the component layer.
// This switch maps every key the composable can produce to its label.
const groupLabel = (key: string): string => {
  if (key === "today") return t("time.today")
  if (key === "yesterday") return t("time.yesterday")
  if (key === "lastWeek") return t("time.previousWeek")
  if (key === "older") return t("time.older")
  if (key === "private") return t("ai.visibilityPrivate")
  if (key === "shared") return t("ai.visibilityShared")
  if (key === "public") return t("ai.visibilityPublic")
  // `all` is the only key emitted when groupBy=none.
  return t("labels.history")
}

const myGroups = computed(() => filter.groupSessions(mySessions.value))
const sharedGroups = computed(() => filter.groupSessions(sharedSessions.value))

const hasAnyRawSessions = computed(
  () =>
    rawMySessions.value.length > 0 ||
    rawSharedSessions.value.length > 0 ||
    rawArchivedMySessions.value.length > 0
)
const hasAnyFilteredSessions = computed(
  () =>
    mySessions.value.length > 0 ||
    sharedSessions.value.length > 0 ||
    archivedMySessions.value.length > 0
)
const isEmpty = computed(
  () => !isLoadingSessions.value && !hasAnyRawSessions.value
)
// Distinct "no results" state — the user has chats, but the active
// filter/search hides all of them. Different copy clarifies what's
// happening so the user knows to reset the filter, not start sending.
const isFilteredEmpty = computed(
  () =>
    !isLoadingSessions.value &&
    hasAnyRawSessions.value &&
    !hasAnyFilteredSessions.value
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
        <Button variant="outline" @click="onNewChat">
          <IconPlus />
          {{ $t("ai.newChat") }}
        </Button>
        <InputGroup>
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput
            v-model="filter.state.search"
            :placeholder="$t('ai.searchChats')"
          />
          <!-- Clear-search + filter menu live in a single trailing addon. -->
          <!-- The clear button conditionally renders (only when there's a -->
          <!-- search query); the filter menu is always available so the -->
          <!-- user can change filters even with no search text. -->
          <InputGroupAddon align="inline-end">
            <TooltipProvider v-if="filter.state.search">
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    size="icon-xs"
                    @click="filter.state.search = ''"
                  >
                    <IconX />
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>{{ $t("ai.searchClear") }}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <BotSessionFilterMenu :filter="filter" />
          </InputGroupAddon>
        </InputGroup>
      </div>
    </SidebarHeader>
    <SidebarContent>
      <OverlayScrollbarsWrapper>
        <div
          v-if="isEmpty"
          class="text-muted-foreground flex flex-col items-center gap-2 p-6 text-center text-xs"
        >
          <IconHistory />
          <p>{{ t("ai.botHistoryEmptyAll") }}</p>
        </div>
        <div
          v-else-if="isFilteredEmpty"
          class="text-muted-foreground flex flex-col items-center gap-2 p-6 text-center text-xs"
        >
          <IconHistory />
          <p>{{ $t("ai.filterNoResults") }}</p>
          <Button variant="ghost" size="sm" @click="filter.reset()">
            {{ $t("ai.filterReset") }}
          </Button>
        </div>

        <template v-if="mySessions.length > 0">
          <SidebarGroup v-for="group in myGroups" :key="`mine-${group.key}`">
            <Collapsible default-open class="group/collapsible">
              <SidebarGroupLabel as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-2">
                  {{ groupLabel(group.key) }}
                  <IconChevronRight
                    class="ml-auto size-3! transition-transform group-data-[state=open]/collapsible:rotate-90"
                  />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
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
                            <span class="flex min-w-0 grow flex-col">
                              <span class="flex items-center gap-2">
                                <span class="truncate text-sm">
                                  {{ item.title || t("ai.newChat") }}
                                </span>
                                <Tooltip v-if="item.visibility !== 'private'">
                                  <TooltipTrigger as-child>
                                    <Component
                                      :is="visibilityIcon(item.visibility)"
                                      class="text-muted-foreground"
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {{ visibilityLabel(item.visibility) }}
                                  </TooltipContent>
                                </Tooltip>
                              </span>
                              <span
                                v-if="item.preview"
                                class="text-muted-foreground line-clamp-1 text-xs"
                              >
                                {{ item.preview }}
                              </span>
                            </span>
                            <span
                              class="text-muted-foreground shrink-0 text-xs"
                            >
                              {{ formatRelative(sessionDate(item)) }}
                            </span>
                          </SidebarMenuButton>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem @click="openRename(item)">
                            <IconPencil />
                            {{ t("actions.rename") }}
                          </ContextMenuItem>
                          <ContextMenuItem @click="onArchiveToggle(item)">
                            <IconArchive />
                            {{ t("ai.archive") }}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem @click="openDelete(item)">
                            <IconTrash2 />
                            {{ t("actions.delete") }}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>

                      <TooltipProvider>
                        <Tooltip>
                          <DropdownMenu>
                            <TooltipTrigger as-child>
                              <DropdownMenuTrigger as-child>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  class="absolute top-2 right-2 opacity-0 group-hover/history:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                  @click.stop
                                >
                                  <IconMoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent>{{
                              t("ai.chatActions")
                            }}</TooltipContent>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem @click="openRename(item)">
                                <IconPencil />
                                {{ t("actions.rename") }}
                              </DropdownMenuItem>
                              <DropdownMenuItem @click="onArchiveToggle(item)">
                                <IconArchive />
                                {{ t("ai.archive") }}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem @click="openDelete(item)">
                                <IconTrash2 />
                                {{ t("actions.delete") }}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </Tooltip>
                      </TooltipProvider>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        </template>

        <template v-if="sharedSessions.length > 0">
          <Separator class="my-1" />
          <SidebarGroup
            v-for="group in sharedGroups"
            :key="`shared-${group.key}`"
          >
            <Collapsible default-open class="group/collapsible">
              <SidebarGroupLabel as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-2">
                  <IconUsers />
                  <span>{{
                    t("ai.sharedGroupLabel", { label: groupLabel(group.key) })
                  }}</span>
                  <IconChevronRight
                    class="ml-auto size-3! transition-transform group-data-[state=open]/collapsible:rotate-90"
                  />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
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
                        <span class="flex min-w-0 grow flex-col">
                          <span class="flex items-center gap-2">
                            <span class="truncate text-sm">
                              {{ item.title || t("ai.untitledSession") }}
                            </span>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <IconUsers class="text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                {{ t("ai.visibilityShared") }}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                          <span
                            v-if="item.preview"
                            class="text-muted-foreground line-clamp-1 text-xs"
                          >
                            {{ item.preview }}
                          </span>
                        </span>
                        <span class="text-muted-foreground shrink-0 text-xs">
                          {{ formatRelative(sessionDate(item)) }}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        </template>

        <template v-if="archivedMySessions.length > 0">
          <Separator class="my-1" />
          <SidebarGroup>
            <Collapsible default-open class="group/collapsible">
              <SidebarGroupLabel as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-2">
                  <IconArchive />
                  {{ t("ai.archived") }}
                  <IconChevronRight
                    class="ml-auto size-3! transition-transform group-data-[state=open]/collapsible:rotate-90"
                  />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
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
                            <IconArchive />
                            <span class="flex min-w-0 grow flex-col">
                              <span class="truncate text-sm">
                                {{ item.title || t("ai.untitledSession") }}
                              </span>
                              <span
                                v-if="item.preview"
                                class="text-muted-foreground line-clamp-1 text-xs"
                              >
                                {{ item.preview }}
                              </span>
                            </span>
                            <span
                              class="text-muted-foreground shrink-0 text-xs"
                            >
                              {{ formatRelative(sessionDate(item)) }}
                            </span>
                          </SidebarMenuButton>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem @click="onArchiveToggle(item)">
                            <IconRotateCcw />
                            {{ t("ai.restore") }}
                          </ContextMenuItem>
                          <ContextMenuItem @click="openRename(item)">
                            <IconPencil />
                            {{ t("actions.rename") }}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem @click="openDelete(item)">
                            <IconTrash2 />
                            {{ t("actions.delete") }}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>

                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <DropdownMenuTrigger as-child>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                class="absolute top-2 right-2 opacity-0 group-hover/history:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                @click.stop
                              >
                                <IconMoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent>{{
                            t("ai.chatActions")
                          }}</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem @click="onArchiveToggle(item)">
                            <IconRotateCcw />
                            {{ t("ai.restore") }}
                          </DropdownMenuItem>
                          <DropdownMenuItem @click="openRename(item)">
                            <IconPencil />
                            {{ t("actions.rename") }}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem @click="openDelete(item)">
                            <IconTrash2 />
                            {{ t("actions.delete") }}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        </template>
      </OverlayScrollbarsWrapper>
    </SidebarContent>
  </Sidebar>

  <!-- Rename dialog -->
  <Dialog v-model:open="renameDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t("ai.renameChat") }}</DialogTitle>
        <DialogDescription>
          {{ t("ai.renameChatHint") }}
        </DialogDescription>
      </DialogHeader>
      <form class="grid gap-2" @submit.prevent="submitRename">
        <Label for="bot-rename-input">{{ t("ai.chatTitle") }}</Label>
        <Input
          id="bot-rename-input"
          ref="renameInputEl"
          v-model="renameInput"
          :placeholder="t('ai.chatTitlePlaceholder')"
          maxlength="120"
          :disabled="isMutating"
        />
      </form>
      <DialogFooter>
        <Button :disabled="isMutating" @click="renameDialogOpen = false">
          {{ t("actions.cancel") }}
        </Button>
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
          class="text-current"
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

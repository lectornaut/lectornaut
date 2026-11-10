<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import { useBotSessionFilter } from "@/composables/useBotSessionFilter"
import {
  IconArchive,
  IconChevronDown,
  IconChevronRight,
  IconGlobe,
  IconHistory,
  IconLock,
  IconMoreHorizontal,
  IconPencil,
  IconPin,
  IconPinOff,
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

// ── Compact search ───────────────────────────────────────────────────────────

// The search field collapses to a single icon button to keep the header
// compact. Clicking the button expands the input and focuses it; on blur
// it collapses again — but only when empty, so an active query stays
// visible and clearable instead of disappearing behind the icon.
const searchExpanded = ref(false)

const expandSearch = () => {
  searchExpanded.value = true
  // The input mounts via v-if, so focus on the next tick. We focus by id
  // rather than a template ref: InputGroupInput wraps Input, and neither
  // exposes the underlying <input> to a parent ref.
  nextTick(() => document.getElementById("bot-history-search")?.focus())
}

const onSearchBlur = () => {
  if (!filter.state.search.trim()) searchExpanded.value = false
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
  if (key === "pinned") return t("ai.pinned")
  // `all` is the only key emitted when groupBy=none.
  return t("labels.history")
}

const isPinned = (session: IBotSession) => !!session.pinnedAt

// Pinned chats are hoisted into their own bucket ahead of whatever
// `groupBy` produces, so "Pinned" stays at the top regardless of the
// active view option. They're removed from the normal groups first —
// a pinned chat appearing twice would be worse than not pinning it.
const myGroups = computed(() => {
  const pinned = mySessions.value.filter(isPinned)
  const groups = filter.groupSessions(
    mySessions.value.filter((s) => !isPinned(s))
  )
  if (pinned.length === 0) return groups
  return [{ key: "pinned", items: filter.sortSessions(pinned) }, ...groups]
})
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

const openRename = (session: IBotSession) => {
  renameTarget.value = session
  renameDialogOpen.value = true
}

const saveRename = async (title: string) =>
  !!(await botChat?.renameSession(renameTarget.value!.id, title))

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IBotSession | null>(null)

const openDelete = (session: IBotSession) => {
  deleteTarget.value = session
  deleteDialogOpen.value = true
}

const submitDelete = async () => {
  const target = deleteTarget.value
  if (!target || !(await botChat?.removeSession(target.id))) return false
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

const onPinToggle = (session: IBotSession) => {
  void botChat?.pinSession(session.id, !session.pinnedAt)
}

// ── Finder-style multi-select ───────────────────────────────────────────────
//
// ⌘/Ctrl-click toggles a chat into the selection, Shift-click selects the
// visible range from the anchor; a plain click clears it and opens the chat.
// Only my own chats (active + archived) are selectable: shared chats belong
// to other members and carry no row actions. Bulk actions live in the
// "N selected" footer menu; row menus keep acting on their own chat.

// Group open state, so Shift ranges skip rows inside collapsed groups.
const groupOpen = ref<Record<string, boolean>>({})
const isGroupOpen = (key: string) => groupOpen.value[key] !== false
const setGroupOpen = (key: string, open: boolean) => {
  groupOpen.value = { ...groupOpen.value, [key]: open }
}

const multiSelectedIds = ref<string[]>([])
let anchorId: string | null = null

const ownById = computed(
  () =>
    new Map(
      [...rawMySessions.value, ...rawArchivedMySessions.value].map((s) => [
        s.id,
        s,
      ])
    )
)

/** Selectable ids in on-screen order. */
const visibleOwnIds = computed(() => [
  ...myGroups.value
    .filter((g) => isGroupOpen(`mine-${g.key}`))
    .flatMap((g) => g.items.map((s) => s.id)),
  ...(isGroupOpen("archived") ? archivedMySessions.value.map((s) => s.id) : []),
])

// Resolved against the live lists, so deleted chats and team/workspace
// switches drop out of the selection on their own.
const selectedSessions = computed(() =>
  multiSelectedIds.value
    .map((id) => ownById.value.get(id))
    .filter((s): s is IBotSession => Boolean(s))
)

const isRowActive = (id: string) =>
  selectedSessions.value.length
    ? selectedSessions.value.some((s) => s.id === id)
    : id === activeSessionId.value

const onRowClick = (session: IBotSession, event: MouseEvent) => {
  const selectable = ownById.value.has(session.id)
  if (selectable && event.shiftKey) {
    const order = visibleOwnIds.value
    const to = order.indexOf(session.id)
    const anchorIndex = order.indexOf(anchorId ?? activeSessionId.value ?? "")
    const from = anchorIndex === -1 ? to : anchorIndex
    multiSelectedIds.value = order.slice(
      Math.min(from, to),
      Math.max(from, to) + 1
    )
    return
  }
  if (selectable && (event.metaKey || event.ctrlKey)) {
    const active = activeSessionId.value
    const base = selectedSessions.value.length
      ? selectedSessions.value.map((s) => s.id)
      : active && ownById.value.has(active)
        ? [active]
        : []
    multiSelectedIds.value = base.includes(session.id)
      ? base.filter((id) => id !== session.id)
      : [...base, session.id]
    anchorId = session.id
    return
  }
  multiSelectedIds.value = []
  anchorId = session.id
  onSelectSession(session.id)
}

const clearSelection = () => {
  multiSelectedIds.value = []
}

const bulkActive = computed(() =>
  selectedSessions.value.filter((s) => !s.archivedAt)
)
const bulkArchived = computed(() =>
  selectedSessions.value.filter((s) => !!s.archivedAt)
)
const bulkPinnable = computed(() =>
  bulkActive.value.filter((s) => !isPinned(s))
)
const bulkUnpinnable = computed(() => bulkActive.value.filter(isPinned))

const bulkBusy = ref(false)

/** Runs `action` per chat, then drops the ones that succeeded. */
const runBulk = async (
  targets: IBotSession[],
  action: (session: IBotSession) => Promise<unknown> | undefined
) => {
  if (bulkBusy.value || !targets.length) return false
  bulkBusy.value = true
  const done = new Set<string>()
  try {
    // ponytail: sequential, like Settings → Sessions; removeSession refuses
    // while another session mutation is in flight (isMutatingSession).
    for (const session of targets) {
      if ((await action(session)) !== false) done.add(session.id)
    }
  } finally {
    multiSelectedIds.value = multiSelectedIds.value.filter(
      (id) => !done.has(id)
    )
    bulkBusy.value = false
  }
  return done.size === targets.length
}

const bulkPin = (pinned: boolean) =>
  runBulk(pinned ? bulkPinnable.value : bulkUnpinnable.value, (s) =>
    botChat?.pinSession(s.id, pinned)
  )

const bulkArchive = (archived: boolean) =>
  runBulk(archived ? bulkActive.value : bulkArchived.value, (s) =>
    botChat?.archiveSession(s.id, archived)
  )

const bulkDeleteDialogOpen = ref(false)
const bulkDeleteCount = ref(0)

const openBulkDelete = () => {
  bulkDeleteCount.value = selectedSessions.value.length
  bulkDeleteDialogOpen.value = true
}

// Each failed delete already toasts; a failure keeps the dialog open so the
// outcome is visible instead of a silently half-finished wipe.
const submitBulkDelete = async () => {
  if (
    !(await runBulk(selectedSessions.value, (s) =>
      botChat?.removeSession(s.id)
    ))
  )
    return false
}
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <SidebarHeader>
      <div class="flex items-center justify-between gap-2">
        <Button variant="outline" class="grow justify-start" @click="onNewChat">
          <IconPlus />
          {{ $t("ai.newChat") }}
        </Button>
        <!-- Compact mode: the search field collapses to a single icon -->
        <!-- button (`w-auto`) and only expands to a full input on click. -->
        <!-- DOM order matches visual/tab order; the trailing addon keeps a -->
        <!-- stable key so the filter menu instance survives the toggle. -->
        <InputGroup
          class="border-border"
          :class="searchExpanded ? 'max-w-64' : 'w-auto'"
        >
          <!-- Collapsed: tooltipped button standing in for the search field. -->
          <InputGroupAddon v-if="!searchExpanded" key="search-compact">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    :aria-label="$t('ai.search')"
                    size="icon-xs"
                    @click="expandSearch"
                  >
                    <IconSearch />
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>{{ $t("ai.search") }}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </InputGroupAddon>

          <!-- Expanded: the real field. `@blur` collapses it back, but -->
          <!-- only when empty (see `onSearchBlur`). -->
          <InputGroupAddon v-if="searchExpanded" key="search-icon">
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput
            v-if="searchExpanded"
            id="bot-history-search"
            key="search-input"
            v-model="filter.state.search"
            :placeholder="$t('ai.searchChats')"
            @blur="onSearchBlur"
          />

          <!-- Always present: the clear button only shows while expanded -->
          <!-- with a query; `@mousedown.prevent` keeps focus on the input -->
          <!-- so clearing doesn't trigger the blur-collapse. The filter -->
          <!-- menu stays reachable in both states. -->
          <InputGroupAddon key="search-trailing" align="inline-end">
            <TooltipProvider v-if="searchExpanded && filter.state.search">
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    :aria-label="$t('ai.searchClear')"
                    size="icon-xs"
                    @mousedown.prevent
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
      <ScrollContainer>
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
          <Button variant="ghost" @click="filter.reset()">
            {{ $t("ai.filterReset") }}
          </Button>
        </div>

        <template v-if="mySessions.length > 0">
          <SidebarGroup v-for="group in myGroups" :key="`mine-${group.key}`">
            <Collapsible
              :open="isGroupOpen(`mine-${group.key}`)"
              class="group/collapsible"
              @update:open="setGroupOpen(`mine-${group.key}`, $event)"
            >
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
                            :is-active="isRowActive(item.id)"
                            class="h-auto items-end gap-2 py-2 pr-3.5"
                            @click="onRowClick(item, $event)"
                          >
                            <span class="flex min-w-0 grow flex-col gap-0.5">
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
                          <ContextMenuItem @click="onPinToggle(item)">
                            <Component
                              :is="isPinned(item) ? IconPinOff : IconPin"
                            />
                            {{
                              isPinned(item)
                                ? t("actions.unpin")
                                : t("actions.pin")
                            }}
                          </ContextMenuItem>
                          <ContextMenuItem @click="openRename(item)">
                            <IconPencil />
                            {{ t("actions.rename") }}
                          </ContextMenuItem>
                          <ContextMenuItem @click="onArchiveToggle(item)">
                            <IconArchive />
                            {{ t("ai.archive") }}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            @click="openDelete(item)"
                          >
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
                                  :aria-label="t('ai.chatActions')"
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
                              <DropdownMenuItem
                                data-hotkey="p"
                                @click="onPinToggle(item)"
                              >
                                <Component
                                  :is="isPinned(item) ? IconPinOff : IconPin"
                                />
                                {{
                                  isPinned(item)
                                    ? t("actions.unpin")
                                    : t("actions.pin")
                                }}
                                <DropdownMenuShortcut>P</DropdownMenuShortcut>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-hotkey="r"
                                @click="openRename(item)"
                              >
                                <IconPencil />
                                {{ t("actions.rename") }}
                                <DropdownMenuShortcut>R</DropdownMenuShortcut>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-hotkey="a"
                                @click="onArchiveToggle(item)"
                              >
                                <IconArchive />
                                {{ t("ai.archive") }}
                                <DropdownMenuShortcut>A</DropdownMenuShortcut>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                data-hotkey="backspace delete"
                                @click="openDelete(item)"
                              >
                                <IconTrash2 />
                                {{ t("actions.delete") }}
                                <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
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
                        :is-active="isRowActive(item.id)"
                        class="h-auto items-start gap-2 py-2"
                        @click="onRowClick(item, $event)"
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
            <Collapsible
              :open="isGroupOpen('archived')"
              class="group/collapsible"
              @update:open="setGroupOpen('archived', $event)"
            >
              <SidebarGroupLabel as-child>
                <CollapsibleTrigger class="flex w-full items-center gap-2">
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
                            :is-active="isRowActive(item.id)"
                            class="h-auto items-end gap-2 py-2 pr-3.5"
                            @click="onRowClick(item, $event)"
                          >
                            <span class="flex min-w-0 grow flex-col gap-0.5">
                              <span class="flex items-center gap-2">
                                <span class="truncate text-sm">
                                  {{ item.title || t("ai.untitledSession") }}
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
                          <ContextMenuItem @click="onArchiveToggle(item)">
                            <IconRotateCcw />
                            {{ t("ai.restore") }}
                          </ContextMenuItem>
                          <ContextMenuItem @click="openRename(item)">
                            <IconPencil />
                            {{ t("actions.rename") }}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            @click="openDelete(item)"
                          >
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
                                  :aria-label="t('ai.chatActions')"
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
                              <DropdownMenuItem
                                data-hotkey="a"
                                @click="onArchiveToggle(item)"
                              >
                                <IconRotateCcw />
                                {{ t("ai.restore") }}
                                <DropdownMenuShortcut>A</DropdownMenuShortcut>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-hotkey="r"
                                @click="openRename(item)"
                              >
                                <IconPencil />
                                {{ t("actions.rename") }}
                                <DropdownMenuShortcut>R</DropdownMenuShortcut>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                data-hotkey="backspace delete"
                                @click="openDelete(item)"
                              >
                                <IconTrash2 />
                                {{ t("actions.delete") }}
                                <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
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
      </ScrollContainer>
    </SidebarContent>
    <!-- Bulk actions for the ⌘/Shift selection; mirrors DataTable's -->
    <!-- selected-count chip so every list surface reads the same. -->
    <SidebarFooter v-if="selectedSessions.length">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="outline"
            class="data-[state=open]:bg-accent self-stretch border-dashed tabular-nums"
          >
            {{
              t("settings.sessions.selectedCount", {
                count: selectedSessions.length,
              })
            }}
            <IconChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" class="min-w-48">
          <DropdownMenuItem
            v-if="bulkPinnable.length"
            :disabled="bulkBusy"
            @click="bulkPin(true)"
          >
            <IconPin />
            {{ t("ai.bulkPin") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="bulkUnpinnable.length"
            :disabled="bulkBusy"
            @click="bulkPin(false)"
          >
            <IconPinOff />
            {{ t("ai.bulkUnpin") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="bulkActive.length"
            :disabled="bulkBusy"
            @click="bulkArchive(true)"
          >
            <IconArchive />
            {{ t("settings.sessions.bulkArchive") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="bulkArchived.length"
            :disabled="bulkBusy"
            @click="bulkArchive(false)"
          >
            <IconRotateCcw />
            {{ t("settings.sessions.bulkRestore") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            :disabled="bulkBusy"
            @click="openBulkDelete"
          >
            <IconTrash2 />
            {{ t("settings.sessions.bulkDelete") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="bulkBusy" @click="clearSelection">
            <IconX />
            {{ t("settings.sessions.bulkClear") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
  </Sidebar>

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

  <ConfirmAction
    v-model:open="bulkDeleteDialogOpen"
    :title="t('ai.bulkDeleteTitle')"
    :description="t('ai.bulkDeleteConfirm', bulkDeleteCount)"
    :action-label="t('actions.delete')"
    destructive
    :on-confirm="submitBulkDelete"
  />
</template>

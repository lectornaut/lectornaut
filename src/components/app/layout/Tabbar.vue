<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { useShortcutKeys } from "@/composables/useShortcutKeys"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconCheck,
  IconChevronDown,
  IconCircleX,
  IconCopy,
  IconGalleryHorizontalEnd,
  IconHistory,
  IconPanelBottom,
  IconPanelLeft,
  IconPanelRight,
  IconPenLine,
  IconPictureInPicture2,
  IconPin,
  IconPinOff,
  IconPlus,
  IconSquarePen,
  IconSquareX,
  IconTrash,
  IconX,
} from "@/data/icons"
import { resolveRouteName } from "@/helpers/breadcrumber"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { isDefaultRoute } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useLayoutStore } from "@/stores/layoutStore"
import { useLocalStorage } from "@vueuse/core"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"
import type Sortable from "sortablejs"
import { useRouter } from "vue-router"

// ----------------------------------------------------------------------------
// Environment / shell context
// ----------------------------------------------------------------------------
const isFullscreen = useIsFullscreen()
const { open, isMobile } = useSidebar()

const el = ref<HTMLElement>()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

// ----------------------------------------------------------------------------
// Layout store: tab state + panel flags + tab actions
// ----------------------------------------------------------------------------
const layoutStore = useLayoutStore()
const {
  tabs,
  activeTabId,
  activeTab,
  recentlyClosed,
  leftPanelCollapsed,
  rightPanelCollapsed,
  bottomPanelCollapsed,
  sidebarPinned,
  isLoading: pending,
  isHydrated,
} = storeToRefs(layoutStore)
const {
  addTab,
  closeTab,
  closeOtherTabs,
  closeAllTabs,
  duplicateTab,
  getTabIndicator: getStoredTabIndicator,
  isTabPending,
  normalizeTabOrder,
  renameTab,
  setTabPinned,
  setActiveTab,
  updateActiveTab,
  clearRecentlyClosed,
  reopenLastClosed,
} = layoutStore

// Display strings for the keyboard shortcuts surfaced in menus/tooltips.
const leftPanelKeys = useShortcutKeys("Sidebar.Left.Toggle")
const rightPanelKeys = useShortcutKeys("Sidebar.Right.Toggle")
const bottomPanelKeys = useShortcutKeys("Panel.Bottom.Toggle")
const newTabKeys = useShortcutKeys("Tabs.Add")
const closeTabKeys = useShortcutKeys("Tabs.Close")
const closeAllTabsKeys = useShortcutKeys("Tabs.Close.All")
const closeOtherTabsKeys = useShortcutKeys("Tabs.Close.Others")
const duplicateTabKeys = useShortcutKeys("Tabs.Duplicate")
const renameTabKeys = useShortcutKeys("Tabs.Rename")
const reopenLastTabKeys = useShortcutKeys("Tabs.ReopenLast")

const isPoppedOut = useLocalStorage("popout-state", false)

// On mobile the side panels can't coexist with the tab strip, so collapse
// both when entering mobile and restore them when leaving it.
watch(isMobile, (val) => {
  if (val) {
    emitter.emit("Sidebar.Left.Collapse")
    emitter.emit("Sidebar.Right.Collapse")
  } else {
    emitter.emit("Sidebar.Left.Expand")
    emitter.emit("Sidebar.Right.Expand")
  }
})

// ----------------------------------------------------------------------------
// Inline rename / copy-url local UI state
// ----------------------------------------------------------------------------
const renamingTabId = ref<string | null>(null)
const renamingName = ref("")
const copiedTabId = ref<string | null>(null)
const { copy, copied } = useClipboard({ legacy: true })

// Route↔store sync bookkeeping (see watchers below).
const isInitialRouteSync = ref(true)
const previousWorkspaceRoutePath = ref<string | null>(null)
const pinnedTabCount = computed(
  () => tabs.value.filter((tab) => tab.pinned).length
)

// ----------------------------------------------------------------------------
// Drag-and-drop reordering (pinned tabs stay grouped at the front)
// ----------------------------------------------------------------------------
function resolveDropIndex(evt: Sortable.MoveEvent) {
  const siblingTabs = Array.from(evt.to.children)
  const relatedIndex = siblingTabs.indexOf(evt.related)
  if (relatedIndex === -1) return siblingTabs.length
  return evt.willInsertAfter ? relatedIndex + 1 : relatedIndex
}

function isPinnedTabElement(element?: Element | null) {
  return element instanceof HTMLElement && element.dataset.pinned === "true"
}

// A pinned tab may only drop within the pinned prefix; a regular tab only
// after it. Enforced mid-drag so the strip never interleaves the two groups.
function canDropWithinTabBoundary(evt: Sortable.MoveEvent) {
  const dropIndex = resolveDropIndex(evt)
  return isPinnedTabElement(evt.dragged)
    ? dropIndex <= pinnedTabCount.value
    : dropIndex >= pinnedTabCount.value
}

useSortable(el, tabs, {
  animation: 150,
  draggable: ".tab-item",
  handle: ".hover-trigger",
  onMove: (evt) => canDropWithinTabBoundary(evt),
  onEnd: () => {
    normalizeTabOrder()
  },
})

// ----------------------------------------------------------------------------
// Derived guards used by the menus/tooltips
// ----------------------------------------------------------------------------
const { currentWorkspace } = useWorkspaceActions()
const hasClosableTabs = computed(() => tabs.value.some((tab) => !tab.pinned))
const canCloseActiveTab = computed(() =>
  Boolean(activeTab.value && !activeTab.value.pinned)
)
const canRenameActiveTab = computed(() =>
  Boolean(activeTab.value && !isDefaultRoute(activeTab.value))
)

function isPinnedTab(tab?: { pinned?: boolean } | null) {
  return Boolean(tab?.pinned)
}

function canCloseTab(tab?: { pinned?: boolean } | null) {
  return tab ? !tab.pinned : false
}

function resolveTabUrl(fullPath: string) {
  if (typeof window === "undefined") return fullPath
  return new URL(fullPath, window.location.origin).href
}

async function handleCopyTabUrl(tab: { id: string; fullPath: string }) {
  copiedTabId.value = tab.id
  try {
    await copy(resolveTabUrl(tab.fullPath))
  } catch {
    copiedTabId.value = null
  }
}

function hasClosableOtherTabs(keepId?: string) {
  return tabs.value.some((tab) => !tab.pinned && tab.id !== keepId)
}

// Prefer an explicit stored indicator; otherwise show a syncing badge while a
// tab op is in flight for this tab.
function resolveTabIndicator(tab: { id: string }) {
  const stored = getStoredTabIndicator(tab.id)
  if (stored) return stored
  if (isTabPending(tab.id)) {
    return { label: t("states.syncing"), tone: "info" as const, spin: true }
  }
  return null
}

function navigateToTab(tab: { fullPath: string }) {
  if (route.fullPath !== tab.fullPath) {
    router.push(tab.fullPath)
  }
}

// ----------------------------------------------------------------------------
// Core synchronization: Route → Store (primary truth)
//
// When the URL changes, reflect it in the store — activating an existing tab,
// consuming a throwaway "/new" tab, reusing the active tab for in-app
// navigation, restoring the last session, or finally adding a new tab.
// ----------------------------------------------------------------------------
watch(
  [() => route.fullPath, isHydrated],
  async ([newPath, hydrated]) => {
    if (!hydrated || !currentWorkspace.value) return

    // Drop the workspace-switch marker once the route leaves the old path.
    if (
      previousWorkspaceRoutePath.value &&
      newPath !== previousWorkspaceRoutePath.value
    ) {
      previousWorkspaceRoutePath.value = null
    }

    // While switching workspace, don't materialize the *old* workspace's route
    // as a tab in the new one — redirect to a sensible fallback instead.
    if (
      previousWorkspaceRoutePath.value &&
      newPath === previousWorkspaceRoutePath.value
    ) {
      const fallbackPath =
        activeTab.value?.fullPath ?? tabs.value[0]?.fullPath ?? "/start"
      if (fallbackPath !== newPath) {
        router.replace(fallbackPath)
        return
      }
      // The same route can legitimately exist in both workspaces.
      previousWorkspaceRoutePath.value = null
    }

    // Already the active tab → nothing to do. Lets several "/new" tabs coexist
    // without snapping back to the first one.
    if (activeTab.value?.fullPath === newPath) {
      isInitialRouteSync.value = false
      return
    }

    // Case A: route matches an existing tab (excluding the reusable "/new").
    const existingTab = tabs.value.find((tab) => tab.fullPath === newPath)
    if (existingTab && newPath !== "/new") {
      if (activeTabId.value !== existingTab.id) setActiveTab(existingTab.id)
      isInitialRouteSync.value = false
      return
    }

    // Case B: the active tab is a throwaway "/new" → consume it for this route.
    if (activeTab.value?.fullPath === "/new") {
      updateActiveTab(newPath, resolveRouteName(route))
      isInitialRouteSync.value = false
      return
    }

    // Case C: in-app navigation → reuse the active tab (never on initial sync,
    // never for "/start").
    if (
      !isInitialRouteSync.value &&
      activeTabId.value &&
      newPath !== "/start"
    ) {
      updateActiveTab(newPath, resolveRouteName(route))
      return
    }

    // Case D: landed on "/start" with a remembered active tab → restore it.
    if (newPath === "/start" && activeTabId.value) {
      const tab = tabs.value.find((entry) => entry.id === activeTabId.value)
      if (tab) {
        router.push(tab.fullPath)
        return
      }
    }

    // Case E: fall back to opening a fresh tab (optimistic add sets active id).
    if (route.name) {
      await addTab(newPath, resolveRouteName(route))
    }

    isInitialRouteSync.value = false
  },
  { immediate: true }
)

// ----------------------------------------------------------------------------
// Store → Route (secondary truth): when the active tab's path changes, follow.
// ----------------------------------------------------------------------------
watch(
  () => activeTab.value?.fullPath,
  (newPath) => {
    if (!isHydrated.value) return
    // During initial sync the Route→Store watcher is authoritative — don't let
    // a restored tab override a redirect URL.
    if (isInitialRouteSync.value) return

    if (!activeTabId.value) {
      if (route.fullPath !== "/start" && tabs.value.length === 0) {
        router.push("/start")
      }
      return
    }

    if (newPath && newPath !== route.fullPath) {
      router.push(newPath)
    }
  },
  { flush: "post" }
)

// ----------------------------------------------------------------------------
// Workspace switch: re-enter the per-workspace initial-sync phase and remember
// the outgoing route so the Route→Store watcher can ignore it once hydrated.
// ----------------------------------------------------------------------------
watch(
  () => currentWorkspace.value?.id,
  (newId, oldId) => {
    if (newId === oldId) return
    isInitialRouteSync.value = true
    previousWorkspaceRoutePath.value =
      oldId !== undefined ? route.fullPath : null
  }
)

// ----------------------------------------------------------------------------
// Event handlers
// ----------------------------------------------------------------------------
function onTabClick(tab: { id: string }) {
  // Snappy active-state update; the route watcher reconciles the rest.
  setActiveTab(tab.id)
}

async function handleAddTab(fullPath = "/new", name?: string) {
  // Reuse an existing tab for the same (non-"/new") path instead of duplicating.
  const existing = tabs.value.find(
    (tab) => tab.fullPath === fullPath && fullPath !== "/new"
  )
  if (existing) {
    setActiveTab(existing.id)
    return
  }

  const newTab = await addTab(fullPath, name)
  if (newTab) navigateToTab(newTab)
}

function openNewTab() {
  void handleAddTab()
}

async function handleCloseTab(id: string | undefined) {
  if (!id) return
  const tab = tabs.value.find((entry) => entry.id === id)
  if (!canCloseTab(tab)) return
  // closeTab computes the next active tab/path; push it for instant feedback.
  const result = await closeTab(id)
  if (result?.nextPath) router.push(result.nextPath)
}

async function handleDuplicateTab(id: string | undefined) {
  if (!id) return
  await duplicateTab(id)
  // duplicateTab sets the copy active; navigate to it if it's a new tab.
  const newTab = tabs.value.find((tab) => tab.id === activeTabId.value)
  if (newTab && newTab.id !== id) navigateToTab(newTab)
}

function handleRenameTab(id: string | undefined) {
  if (!id) return
  const tab = tabs.value.find((entry) => entry.id === id)
  if (!tab || isDefaultRoute(tab)) return

  renamingTabId.value = id
  renamingName.value = tab.name

  nextTick(() => {
    const input = el.value?.querySelector("input")
    input?.focus()
    input?.select()
  })
}

function saveRename() {
  if (!renamingTabId.value) return
  renameTab(renamingTabId.value, renamingName.value)
  cancelRename()
}

function cancelRename() {
  renamingTabId.value = null
  renamingName.value = ""
}

function handleRenameKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") saveRename()
  else if (event.key === "Escape") cancelRename()
}

async function handleToggleTabPinned(id: string | undefined) {
  if (!id) return
  const tab = tabs.value.find((entry) => entry.id === id)
  if (!tab) return
  await setTabPinned(id, !tab.pinned)
}

// Select a tab by id, by 1-based index, or by relative direction.
function selectTab(idOrDirection: string | number) {
  if (tabs.value.length === 0) return

  let targetId: string | undefined

  if (idOrDirection === "next" || idOrDirection === "previous") {
    const currentIndex = tabs.value.findIndex(
      (tab) => tab.id === activeTabId.value
    )
    const start = currentIndex === -1 ? 0 : currentIndex
    const nextIndex =
      idOrDirection === "next"
        ? (start + 1) % tabs.value.length
        : (start - 1 + tabs.value.length) % tabs.value.length
    targetId = tabs.value[nextIndex]?.id
  } else if (typeof idOrDirection === "number") {
    const tabIdx = Math.max(
      0,
      Math.min(idOrDirection - 1, tabs.value.length - 1)
    )
    targetId = tabs.value[tabIdx]?.id
  } else {
    targetId = idOrDirection
  }

  if (!targetId) return
  const target = tabs.value.find((tab) => tab.id === targetId)
  if (!target) return

  // Keep active state in sync even when the path doesn't change (e.g. several
  // tabs pointing at "/new").
  if (activeTabId.value !== target.id) setActiveTab(target.id)
  navigateToTab(target)
}

// ----------------------------------------------------------------------------
// Global events (Mitt) — driven by hotkeys and other components
// ----------------------------------------------------------------------------
function onTabsAdd(raw?: unknown) {
  const data = raw as
    | { fullPath?: string; path?: string; url?: string; name?: string }
    | undefined
  const path = data?.fullPath || data?.path || data?.url || "/new"
  handleAddTab(path, data?.name).catch(() => {})
}

function onTabsClose(id?: unknown) {
  handleCloseTab((typeof id === "string" ? id : activeTabId.value) || undefined)
}

function onTabsCloseOthers(id?: unknown) {
  const keepId = typeof id === "string" ? id : activeTabId.value
  if (keepId) closeOtherTabs(keepId)
}

async function onTabsCloseAll() {
  await closeAllTabs()
  const nextPath = activeTab.value?.fullPath
  if (nextPath && nextPath !== route.fullPath) {
    router.push(nextPath)
    return
  }
  if (!activeTabId.value && route.fullPath !== "/start") {
    router.push("/start")
  }
}

function onTabsSelect(idOrIndex?: unknown) {
  if (typeof idOrIndex === "string" || typeof idOrIndex === "number") {
    selectTab(idOrIndex)
  }
}

function onTabsReopenLast() {
  const last = reopenLastClosed()
  if (last) handleAddTab(last.fullPath, last.name)
}

function onTabsReopen(raw?: unknown) {
  const tab = raw as { fullPath: string; name: string } | undefined
  if (tab) handleAddTab(tab.fullPath, tab.name)
}

function onTabsDuplicate(id?: unknown) {
  handleDuplicateTab(
    (typeof id === "string" ? id : activeTabId.value) || undefined
  )
}

function onTabsRename(id?: unknown) {
  handleRenameTab(
    (typeof id === "string" ? id : activeTabId.value) || undefined
  )
}

// Reset the per-tab "copied" check mark when the clipboard flag clears.
watch(copied, (isCopied) => {
  if (!isCopied) copiedTabId.value = null
})

onMounted(() => {
  emitter.on("Tabs.Add", onTabsAdd)
  emitter.on("Tabs.Close", onTabsClose)
  emitter.on("Tabs.Close.Others", onTabsCloseOthers)
  emitter.on("Tabs.Close.All", onTabsCloseAll)
  emitter.on("Tabs.Select", onTabsSelect)
  emitter.on("Tabs.ReopenLast", onTabsReopenLast)
  emitter.on("Tabs.Reopen", onTabsReopen)
  emitter.on("Tabs.Duplicate", onTabsDuplicate)
  emitter.on("Tabs.Rename", onTabsRename)
})

onUnmounted(() => {
  emitter.off("Tabs.Add", onTabsAdd)
  emitter.off("Tabs.Close", onTabsClose)
  emitter.off("Tabs.Close.Others", onTabsCloseOthers)
  emitter.off("Tabs.Close.All", onTabsCloseAll)
  emitter.off("Tabs.Select", onTabsSelect)
  emitter.off("Tabs.ReopenLast", onTabsReopenLast)
  emitter.off("Tabs.Reopen", onTabsReopen)
  emitter.off("Tabs.Duplicate", onTabsDuplicate)
  emitter.off("Tabs.Rename", onTabsRename)
})
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        class="min-h-titlebar-height ml-titlebar-left max-w-titlebar-width pt-safe-top relative z-40"
      >
        <div
          data-tauri-drag-region="deep"
          class="flex min-w-0 items-center gap-2 px-2 pt-2 transition-all"
          :class="{
            'pl-22':
              isTauri &&
              !isFullscreen &&
              (isMobile || (!open && !sidebarPinned)),
            'pl-12':
              isTauri && !isFullscreen && !isMobile && !open && sidebarPinned,
          }"
        >
          <HoverCard
            v-if="!isMobile && !open && !sidebarPinned"
            v-motion-fade-visible
            :open-delay="500"
            :close-delay="0"
          >
            <HoverCardTrigger as-child>
              <SidebarTrigger />
            </HoverCardTrigger>
            <HoverCardContent
              side="bottom"
              align="start"
              :side-offset="8"
              class="h-[80svh] overflow-clip p-0"
            >
              <MainSidebar preview />
            </HoverCardContent>
          </HoverCard>
          <SidebarTrigger
            v-else-if="isMobile || (!open && sidebarPinned)"
            v-motion-fade-visible
          />
          <BackForth v-if="!open || isMobile" v-motion-fade-visible />
          <nav
            ref="el"
            class="relative flex min-w-0 items-stretch justify-start gap-2 empty:hidden"
          >
            <template v-if="pending">
              <Skeleton v-for="n in 3" :key="n" class="bg-accent h-8 w-60" />
            </template>
            <template v-else>
              <div
                v-for="(tab, index) in tabs"
                :key="tab.id"
                class="tab-item min-w-0"
                :data-pinned="isPinnedTab(tab)"
                :class="[
                  renamingTabId === tab.id
                    ? 'w-60 shrink'
                    : isPinnedTab(tab)
                      ? 'w-8 shrink-0'
                      : 'w-60 shrink',
                  {
                    'min-w-40': !isPinnedTab(tab) && tab.id === activeTabId,
                  },
                ]"
              >
                <InputGroup v-if="renamingTabId === tab.id" class="h-8">
                  <InputGroupAddon>
                    <IconPenLine />
                  </InputGroupAddon>
                  <InputGroupInput
                    v-model="renamingName"
                    :placeholder="tab.name"
                    class="h-fit"
                    @keydown="handleRenameKeydown"
                  />
                  <InputGroupAddon align="inline-end">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <InputGroupButton
                            variant="secondary"
                            size="icon-xs"
                            @click.prevent="saveRename"
                          >
                            <IconCheck />
                          </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent>{{ t("common.save") }}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </InputGroupAddon>
                </InputGroup>
                <HoverCard v-else :open-delay="2000" :close-delay="0">
                  <HoverCardTrigger class="hover-trigger">
                    <ContextMenu>
                      <ContextMenuTrigger as-child class="context-trigger">
                        <Button
                          :variant="
                            tab.id === activeTabId ? 'outline' : 'secondary'
                          "
                          class="group w-[-webkit-fill-available] min-w-0 gap-2"
                          :class="[
                            tab.id === activeTabId
                              ? 'hover:bg-background'
                              : 'bg-accent/25 text-accent-foreground/25 hover:text-accent-foreground/50 hover:bg-accent/50',
                            isPinnedTab(tab) ? 'justify-center px-0!' : 'pr-1!',
                          ]"
                          size="sm"
                          as-child
                        >
                          <RouterLink
                            :to="tab.fullPath"
                            @click="onTabClick(tab)"
                            @dblclick="
                              !isDefaultRoute(tab)
                                ? handleRenameTab(tab.id)
                                : null
                            "
                          >
                            <TabIcon
                              :full-path="tab.fullPath"
                              :indicator="resolveTabIndicator(tab)"
                            />
                            <span
                              v-if="!isPinnedTab(tab)"
                              class="mr-auto truncate"
                            >
                              {{ tab.name }}
                            </span>
                            <span v-else class="sr-only">
                              {{ tab.name }}
                            </span>
                            <TooltipProvider v-if="canCloseTab(tab)">
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <InputGroupButton
                                    variant="ghost"
                                    size="icon-xs"
                                    class="invisible group-hover:visible"
                                    @click.stop.prevent="handleCloseTab(tab.id)"
                                  >
                                    <IconX />
                                  </InputGroupButton>
                                </TooltipTrigger>
                                <TooltipContent
                                  class="flex items-center gap-2 pr-2"
                                >
                                  {{ t("common.close") }}
                                  <KbdGroup>
                                    <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
                                    <Kbd>W</Kbd>
                                  </KbdGroup>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </RouterLink>
                        </Button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuGroup>
                          <ContextMenuItem @click="openNewTab">
                            <IconPlus />
                            {{ t("tabs.newTab") }}
                            <ContextMenuShortcut v-if="newTabKeys?.length">
                              {{ newTabKeys.join("") }}
                            </ContextMenuShortcut>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem
                            :disabled="!canCloseTab(tab)"
                            @click="handleCloseTab(tab.id)"
                          >
                            <IconX />
                            {{ t("common.close") }}
                            <ContextMenuShortcut v-if="closeTabKeys?.length">
                              {{ closeTabKeys.join("") }}
                            </ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            :disabled="!hasClosableTabs"
                            @click="emitter.emit('Tabs.Close.All')"
                          >
                            <IconCircleX />
                            {{ t("tabs.closeAll") }}
                            <ContextMenuShortcut
                              v-if="closeAllTabsKeys?.length"
                            >
                              {{ closeAllTabsKeys.join("") }}
                            </ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            :disabled="!hasClosableOtherTabs(tab.id)"
                            @click="emitter.emit('Tabs.Close.Others', tab.id)"
                          >
                            <IconSquareX />
                            {{ t("tabs.closeOthers") }}
                            <ContextMenuShortcut
                              v-if="closeOtherTabsKeys?.length"
                            >
                              {{ closeOtherTabsKeys.join("") }}
                            </ContextMenuShortcut>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem
                            @click="handleToggleTabPinned(tab.id)"
                          >
                            <Component
                              :is="isPinnedTab(tab) ? IconPinOff : IconPin"
                            />
                            {{
                              isPinnedTab(tab)
                                ? t("actions.unpin")
                                : t("actions.pin")
                            }}
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem
                            :disabled="isDefaultRoute(tab)"
                            @click="handleRenameTab(tab.id)"
                          >
                            <IconSquarePen />
                            {{ t("tabs.rename") }}
                            <ContextMenuShortcut v-if="renameTabKeys?.length">
                              {{ renameTabKeys.join("") }}
                            </ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            :disabled="isDefaultRoute(tab)"
                            @click="handleDuplicateTab(tab.id)"
                          >
                            <IconCopy />
                            {{ t("tabs.duplicate") }}
                            <ContextMenuShortcut
                              v-if="duplicateTabKeys?.length"
                            >
                              {{ duplicateTabKeys.join("") }}
                            </ContextMenuShortcut>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                      </ContextMenuContent>
                    </ContextMenu>
                  </HoverCardTrigger>
                  <HoverCardContent
                    :side-offset="12"
                    class="flex w-60 flex-col gap-2 p-2"
                  >
                    <div class="flex items-center gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <InputGroupButton
                              variant="ghost"
                              size="icon-xs"
                              @click="handleCopyTabUrl(tab)"
                            >
                              <IconCopy
                                v-if="!(copied && copiedTabId === tab.id)"
                              />
                              <IconCheck v-else />
                            </InputGroupButton>
                          </TooltipTrigger>
                          <TooltipContent>{{
                            t("actions.copyURL")
                          }}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <span
                        class="text-muted-foreground mr-auto min-w-0 justify-center truncate font-mono text-sm font-medium"
                      >
                        {{ tab.fullPath }}
                      </span>
                      <KbdGroup>
                        <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
                        <Kbd>{{ index + 1 }}</Kbd>
                      </KbdGroup>
                    </div>
                    <div class="bg-secondary aspect-video rounded border"></div>
                  </HoverCardContent>
                </HoverCard>
              </div>
            </template>
          </nav>
          <div class="flex shrink-0 grow items-stretch justify-between gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="outline" size="icon-sm" @click="openNewTab">
                    <IconPlus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent> {{ t("tabs.newTab") }} </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div class="flex items-stretch justify-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <DropdownMenu>
                    <TooltipTrigger as-child>
                      <DropdownMenuTrigger as-child>
                        <Button variant="ghost" size="icon-sm">
                          <IconChevronDown />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent> {{ t("tabs.options") }} </TooltipContent>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem @click="openNewTab">
                          <IconPlus />
                          {{ t("tabs.newTab") }}
                          <DropdownMenuShortcut v-if="newTabKeys?.length">
                            {{ newTabKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          :disabled="!canCloseActiveTab"
                          @click="handleCloseTab(activeTabId)"
                        >
                          <IconX />
                          {{ t("common.close") }}
                          <DropdownMenuShortcut v-if="closeTabKeys?.length">
                            {{ closeTabKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="!hasClosableTabs"
                          @click="emitter.emit('Tabs.Close.All')"
                        >
                          <IconCircleX />
                          {{ t("tabs.closeAll") }}
                          <DropdownMenuShortcut v-if="closeAllTabsKeys?.length">
                            {{ closeAllTabsKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="
                            !activeTabId || !hasClosableOtherTabs(activeTabId)
                          "
                          @click="
                            emitter.emit('Tabs.Close.Others', activeTabId)
                          "
                        >
                          <IconSquareX />
                          {{ t("tabs.closeOthers") }}
                          <DropdownMenuShortcut
                            v-if="closeOtherTabsKeys?.length"
                          >
                            {{ closeOtherTabsKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          :disabled="!activeTabId"
                          @click="handleToggleTabPinned(activeTabId)"
                        >
                          <Component
                            :is="isPinnedTab(activeTab) ? IconPinOff : IconPin"
                          />
                          {{
                            isPinnedTab(activeTab)
                              ? t("actions.unpin")
                              : t("actions.pin")
                          }}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          :disabled="!canRenameActiveTab"
                          @click="handleRenameTab(activeTabId)"
                        >
                          <IconSquarePen />
                          {{ t("tabs.rename") }}
                          <DropdownMenuShortcut v-if="renameTabKeys?.length">
                            {{ renameTabKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="!canRenameActiveTab"
                          @click="handleDuplicateTab(activeTabId)"
                        >
                          <IconCopy />
                          {{ t("tabs.duplicate") }}
                          <DropdownMenuShortcut v-if="duplicateTabKeys?.length">
                            {{ duplicateTabKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuSub>
                          <DropdownMenuItem as-child>
                            <DropdownMenuSubTrigger>
                              <IconGalleryHorizontalEnd />
                              {{ t("tabs.activeTabs") }}
                            </DropdownMenuSubTrigger>
                          </DropdownMenuItem>
                          <DropdownMenuSubContent>
                            <DropdownMenuLabel v-if="tabs.length === 0">
                              {{ t("tabs.activeTabsEmpty") }}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              v-for="tab in tabs"
                              :key="tab.id"
                              @click="emitter.emit('Tabs.Select', tab.id)"
                            >
                              <TabIcon
                                :full-path="tab.fullPath"
                                :indicator="resolveTabIndicator(tab)"
                              />
                              <span class="min-w-0 truncate">
                                {{ tab.name }}
                              </span>
                              <DropdownMenuShortcut
                                v-if="isPinnedTab(tab)"
                                class="tracking-normal"
                              >
                                <IconPin />
                              </DropdownMenuShortcut>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              :disabled="!hasClosableTabs"
                              @click="emitter.emit('Tabs.Close.All')"
                            >
                              <IconTrash />
                              {{ t("tabs.closeAllTabs") }}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                          <DropdownMenuItem as-child>
                            <DropdownMenuSubTrigger>
                              <IconHistory />
                              {{ t("tabs.recentClosedTabs") }}
                            </DropdownMenuSubTrigger>
                          </DropdownMenuItem>
                          <DropdownMenuSubContent>
                            <DropdownMenuLabel
                              v-if="recentlyClosed.length === 0"
                            >
                              {{ t("tabs.recentlyClosedEmpty") }}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              v-for="tab in recentlyClosed"
                              :key="tab.id + tab.fullPath"
                              @click="emitter.emit('Tabs.Reopen', tab)"
                            >
                              <TabIcon :full-path="tab.fullPath" />
                              {{ tab.name }}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              :disabled="recentlyClosed.length === 0"
                              @click="clearRecentlyClosed"
                            >
                              <IconTrash />
                              {{ t("tabs.clearRecent") }}
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuCheckboxItem
                          :model-value="isPoppedOut"
                          @update:model-value="isPoppedOut = !isPoppedOut"
                          @select.prevent
                        >
                          <IconPictureInPicture2 />
                          {{ t("layouts.app.statusBar.popOut") }}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                          :model-value="!leftPanelCollapsed"
                          @update:model-value="
                            emitter.emit('Sidebar.Left.Toggle')
                          "
                          @select.prevent
                        >
                          <IconPanelLeft />
                          {{ t("layouts.app.statusBar.leftPanel") }}
                          <DropdownMenuShortcut v-if="leftPanelKeys?.length">
                            {{ leftPanelKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          :model-value="!rightPanelCollapsed"
                          @update:model-value="
                            emitter.emit('Sidebar.Right.Toggle')
                          "
                          @select.prevent
                        >
                          <IconPanelRight />
                          {{ t("layouts.app.statusBar.rightPanel") }}
                          <DropdownMenuShortcut v-if="rightPanelKeys?.length">
                            {{ rightPanelKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          :model-value="!bottomPanelCollapsed"
                          @update:model-value="
                            emitter.emit('Panel.Bottom.Toggle')
                          "
                          @select.prevent
                        >
                          <IconPanelBottom />
                          {{ t("layouts.app.statusBar.bottomPanel") }}
                          <DropdownMenuShortcut v-if="bottomPanelKeys?.length">
                            {{ bottomPanelKeys.join("") }}
                          </DropdownMenuShortcut>
                        </DropdownMenuCheckboxItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Tooltip>
              </TooltipProvider>
              <AiAsk />
            </div>
          </div>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem @click="openNewTab">
          <IconPlus />
          {{ t("tabs.newTab") }}
          <ContextMenuShortcut v-if="newTabKeys?.length">
            {{ newTabKeys.join("") }}
          </ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem
          :disabled="recentlyClosed.length === 0"
          @click="emitter.emit('Tabs.ReopenLast')"
        >
          <IconHistory />
          {{ t("tabs.reopenLast") }}
          <ContextMenuShortcut v-if="reopenLastTabKeys?.length">
            {{ reopenLastTabKeys.join("") }}
          </ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>

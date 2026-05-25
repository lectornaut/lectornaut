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

const isFullscreen = useIsFullscreen()
const { open, isMobile } = useSidebar()

const el = ref<HTMLElement>()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const layoutStore = useLayoutStore()
const {
  tabs,
  activeTabId,
  activeTab,
  recentlyClosed,
  leftPanelCollapsed,
  rightPanelCollapsed,
  bottomPanelCollapsed,
  isLoading: pending,
  isHydrated,
} = storeToRefs(layoutStore)

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

watch(isMobile, (val) => {
  if (val) {
    emitter.emit("Sidebar.Left.Collapse")
    emitter.emit("Sidebar.Right.Collapse")
  } else {
    emitter.emit("Sidebar.Left.Expand")
    emitter.emit("Sidebar.Right.Expand")
  }
})

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

const renamingTabId = ref<string | null>(null)
const renamingName = ref("")
const copiedTabId = ref<string | null>(null)
const { copy, copied } = useClipboard({ legacy: true })

const isInitialRouteSync = ref(true)
const previousWorkspaceRoutePath = ref<string | null>(null)
const pinnedTabCount = computed(
  () => tabs.value.filter((tab) => tab.pinned).length
)

function resolveDropIndex(evt: Sortable.MoveEvent) {
  const siblingTabs = Array.from(evt.to.children)
  const relatedIndex = siblingTabs.indexOf(evt.related)

  if (relatedIndex === -1) {
    return siblingTabs.length
  }

  return evt.willInsertAfter ? relatedIndex + 1 : relatedIndex
}

function isPinnedTabElement(element?: Element | null) {
  return element instanceof HTMLElement && element.dataset.pinned === "true"
}

function canDropWithinTabBoundary(evt: Sortable.MoveEvent) {
  const dropIndex = resolveDropIndex(evt)

  return isPinnedTabElement(evt.dragged)
    ? dropIndex <= pinnedTabCount.value
    : dropIndex >= pinnedTabCount.value
}

// Enable drag-and-drop reordering
useSortable(el, tabs, {
  animation: 150,
  draggable: ".tab-item",
  handle: ".hover-trigger",
  onMove: (evt) => canDropWithinTabBoundary(evt),
  onEnd: () => {
    normalizeTabOrder()
  },
})

const { currentWorkspace } = useWorkspaceActions()
const hasClosableTabs = computed(() => tabs.value.some((tab) => !tab.pinned))
const canCloseActiveTab = computed(() => {
  const tab = activeTab.value
  return Boolean(tab && !tab.pinned)
})
const canRenameActiveTab = computed(() => {
  const tab = activeTab.value
  return Boolean(tab && !isDefaultRoute(tab))
})

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

function resolveTabIndicator(tab: { id: string }) {
  const storedIndicator = getStoredTabIndicator(tab.id)
  if (storedIndicator) {
    return storedIndicator
  }

  if (isTabPending(tab.id)) {
    return {
      label: t("states.syncing"),
      tone: "info" as const,
      spin: true,
    }
  }

  return null
}

// Navigation Helper
function navigateToTab(tab: { fullPath: string }) {
  if (route.fullPath !== tab.fullPath) {
    router.push(tab.fullPath)
  }
}

// ----------------------------------------------------------------------------
// Core Synchronization Logic
// ----------------------------------------------------------------------------
// 1. Route -> Store (Primary Truth)
// When URL changes, ensure Store reflects it (either by activating existing or adding new)
watch(
  [() => route.fullPath, isHydrated],
  async ([newPath, hydrated]) => {
    // Ignore updates until hydrated or valid workspace
    if (!hydrated || !currentWorkspace.value) return

    // Clear switch marker once route has moved away from the previous workspace path.
    if (
      previousWorkspaceRoutePath.value &&
      newPath !== previousWorkspaceRoutePath.value
    ) {
      previousWorkspaceRoutePath.value = null
    }

    // During workspace switch, avoid materializing the old workspace route as a tab.
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

      // Same route can legitimately exist in both workspaces.
      previousWorkspaceRoutePath.value = null
    }

    // Optimization: If the new route is already the active tab, do nothing.
    // This allows multiple /new tabs to exist without forcing a switch to the first one.
    if (activeTab.value?.fullPath === newPath) {
      isInitialRouteSync.value = false
      return
    }

    // Case A: Route matches existing tab
    // Skip if newPath is /new (allow multiple instances)
    const existingTab = tabs.value.find((t) => t.fullPath === newPath)
    if (existingTab && newPath !== "/new") {
      if (activeTabId.value !== existingTab.id) {
        setActiveTab(existingTab.id)
      }
      isInitialRouteSync.value = false
      return
    }

    // Case B: Consumable Tab Logic
    // If current tab is /new, reuse it for the new route
    if (activeTab.value?.fullPath === "/new") {
      const name = resolveRouteName(route)
      updateActiveTab(newPath, name)
      isInitialRouteSync.value = false
      return
    }

    // Case C: Reuse Active Tab (In-App Navigation)
    // If we have an active tab and it's not /start, reuse it
    // Only reuse if it's NOT the initial sync of this session
    if (
      !isInitialRouteSync.value &&
      activeTabId.value &&
      newPath !== "/start"
    ) {
      const name = resolveRouteName(route)
      updateActiveTab(newPath, name)
      return
    }

    // Case D: Session Restore / Final Fallback
    // If we are at /start (initial load), try to restore the last active tab from store.
    // Otherwise, add a new tab.
    if (newPath === "/start" && activeTabId.value) {
      const tab = tabs.value.find((t) => t.id === activeTabId.value)
      if (tab) {
        router.push(tab.fullPath)
        return
      }
    }

    // Case E: Add New Tab
    if (route.name) {
      const name = resolveRouteName(route)
      await addTab(newPath, name)
      // addTab inside store (optimistic) sets activeId, so we are good.
    }

    isInitialRouteSync.value = false
  },
  { immediate: true }
)

// 2. Store -> Route (Secondary Truth)
// When Store active tab changes (ID or path), ensure Router follows.
watch(
  () => activeTab.value?.fullPath,
  (newPath) => {
    // Ignore updates until hydrated
    if (!isHydrated.value) return

    // During initial sync, let the Route→Store watcher be the authority.
    // This prevents restoring the old active tab over a redirect URL.
    if (isInitialRouteSync.value) return

    // If no active tab, maybe go to start?
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

// 3. Workspace Switch
// When workspace changes, the store will clear tabs.
// We just need to ensure we don't accidentally add the *old* route as a new tab in the *new* workspace
// before the router has a chance to update to the new workspace's default/active tab.
watch(
  () => currentWorkspace.value?.id,
  (newId, oldId) => {
    if (newId !== oldId) {
      // Each workspace needs its own initial route synchronization phase.
      isInitialRouteSync.value = true

      // Track the route from the previous workspace so we can ignore it once hydrated.
      previousWorkspaceRoutePath.value =
        oldId !== undefined ? route.fullPath : null

      // Do not force /start while switching workspace.
      // Persisted tabs restore asynchronously and may legitimately point to /new.
    }
  }
)

// ----------------------------------------------------------------------------
// Event Handlers
// ----------------------------------------------------------------------------

function onTabClick(tab: { id: string }) {
  // Just set active, let the watcher handle routing if needed?
  // Actually, UI usually has <RouterLink> which handles the push.
  // Then the Route watcher handles the setActiveTab.
  // The store setActiveTab is redundant if RouterLink is used, BUT
  // RouterLink update might be slightly delayed.
  // Setting active tab immediately makes UI snappy.
  setActiveTab(tab.id)
}

async function handleAddTab(fullPath = "/new", name?: string) {
  // Check if tab exists before adding (prevent duplicates for external URLs)
  const existing = tabs.value.find(
    (t) => t.fullPath === fullPath && fullPath !== "/new"
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
  const tab = tabs.value.find((item) => item.id === id)
  if (!canCloseTab(tab)) return
  // If closing active tab, store calculates next one and updates activeTabId
  // Our activeTabId watcher will then trigger the route change.
  // BUT, we might want to manually push if we know the next path to feel faster?
  // Let's rely on the result from closeTab if available for max speed.
  const result = await closeTab(id)
  if (result?.nextPath) {
    router.push(result.nextPath)
  }
}

async function handleDuplicateTab(id: string | undefined) {
  if (!id) return
  await duplicateTab(id)
  // Store doesn't return new tab easily unless we search for it.
  // User might expect to switch to it?
  // Previous logic found it and switched.
  const newTab = tabs.value.find((t) => t.id === activeTabId.value)
  // If duplicatTab set it as active, we just nav there.
  if (newTab && newTab.id !== id) navigateToTab(newTab)
}

function handleRenameTab(id: string | undefined) {
  if (!id) return
  const tab = tabs.value.find((t) => t.id === id)
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

async function handleToggleTabPinned(id: string | undefined) {
  if (!id) return
  const tab = tabs.value.find((item) => item.id === id)
  if (!tab) return

  await setTabPinned(id, !tab.pinned)
}

// Select tab by ID or direction
function selectTab(idOrDirection: string | number) {
  if (tabs.value.length === 0) return

  let targetId: string | undefined

  if (idOrDirection === "next" || idOrDirection === "previous") {
    // Visual order cycling
    const currentIndex = tabs.value.findIndex((t) => t.id === activeTabId.value)
    // If no active tab or not found, start at 0
    const start = currentIndex === -1 ? 0 : currentIndex

    let nextIndex = 0
    if (idOrDirection === "next") {
      nextIndex = (start + 1) % tabs.value.length
    } else {
      nextIndex = (start - 1 + tabs.value.length) % tabs.value.length
    }

    targetId = tabs.value[nextIndex]?.id
  } else if (typeof idOrDirection === "number") {
    const tabIdx = Math.max(
      0,
      Math.min(idOrDirection - 1, tabs.value.length - 1)
    )
    targetId = tabs.value[tabIdx]?.id
  } else {
    targetId = idOrDirection as string
  }

  if (!targetId) return

  const target = tabs.value.find((t) => t.id === targetId)
  if (!target) return

  // Keep active tab state in sync even when route path does not change
  // (e.g., multiple tabs pointing to the same fullPath such as "/new").
  if (activeTabId.value !== target.id) {
    setActiveTab(target.id)
  }

  navigateToTab(target)
}

// ----------------------------------------------------------------------------
// Global Events (Mitt)
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

watch(copied, (isCopied) => {
  if (!isCopied) {
    copiedTabId.value = null
  }
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
          class="flex min-w-0 items-center gap-2 px-2 pt-2"
          :class="{
            'pl-22': (!open || isMobile) && isTauri && !isFullscreen,
          }"
        >
          <HoverCard v-if="!open && !isMobile">
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
          <SidebarTrigger v-else-if="isMobile" />
          <BackForth v-if="!open || isMobile" />
          <nav
            ref="el"
            class="relative flex min-w-0 items-stretch justify-start gap-2"
          >
            <template v-if="pending">
              <Skeleton v-for="n in 3" :key="n" class="bg-accent h-8 w-60" />
            </template>
            <template v-else-if="tabs.length === 0">
              <Button
                variant="outline"
                class="w-60 min-w-0 shrink-0 justify-start border-dashed shadow-none"
                size="sm"
                @click="openNewTab"
              >
                <IconPlus />
                {{ t("tabs.newTab") }}
              </Button>
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
                <InputGroup v-if="renamingTabId === tab.id">
                  <InputGroupAddon>
                    <IconPenLine />
                  </InputGroupAddon>
                  <InputGroupInput
                    v-model="renamingName"
                    :placeholder="tab.name"
                    @keydown.enter="saveRename"
                    @keydown.esc="cancelRename"
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
                            tab.id === activeTabId ? 'secondary' : 'ghost'
                          "
                          class="group w-[-webkit-fill-available] min-w-0"
                          :class="[
                            tab.id === activeTabId
                              ? 'text-foreground shadow-none'
                              : 'text-secondary-foreground/50 bg-secondary/50',
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
                      <ContextMenuContent class="w-auto">
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
                  <Button variant="ghost" size="icon-sm" @click="openNewTab">
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
                    <DropdownMenuContent class="w-auto" align="end">
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
                          <DropdownMenuSubContent class="w-auto">
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
                          <DropdownMenuSubContent class="w-auto">
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
    <ContextMenuContent class="w-auto">
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

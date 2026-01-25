<script lang="ts" setup>
import {
  IconCheck,
  IconChevronDown,
  IconCircleX,
  IconCopy,
  IconGalleryHorizontalEnd,
  IconHistory,
  IconLayers,
  IconPenLine,
  IconPlus,
  IconSquarePen,
  IconSquareX,
  IconTrash,
  IconX,
} from "@/data/icons"
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { isDefaultRoute } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useLayoutStore } from "@/stores/layoutStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"
import { useRouter } from "vue-router"

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
  isLoading: pending,
  isHydrated,
} = storeToRefs(layoutStore)

const {
  addTab,
  closeTab,
  closeOtherTabs,
  closeAllTabs,
  duplicateTab,
  renameTab,
  setActiveTab,
  updateActiveTab,
  clearRecentlyClosed,
  reopenLastClosed,
} = layoutStore

const renamingTabId = ref<string | null>(null)
const renamingName = ref("")

// Enable drag-and-drop reordering
useSortable(el, tabs, {
  animation: 150,
  draggable: ".tab-item",
  handle: ".hover-trigger",
})

const workspaceStore = useWorkspaceStore()
const { currentWorkspace } = storeToRefs(workspaceStore)

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

    // Optimization: If the new route is already the active tab, do nothing.
    // This allows multiple /new tabs to exist without forcing a switch to the first one.
    if (activeTab.value?.fullPath === newPath) {
      return
    }

    // Case A: Route matches existing tab
    // Skip if newPath is /new (allow multiple instances)
    const existingTab = tabs.value.find((t) => t.fullPath === newPath)
    if (existingTab && newPath !== "/new") {
      if (activeTabId.value !== existingTab.id) {
        setActiveTab(existingTab.id)
      }
      return
    }

    // Case B: Consumable Tab Logic
    // If current tab is /new, reuse it for the new route
    if (activeTab.value?.fullPath === "/new") {
      const name =
        (route.meta?.breadcrumb as string) ||
        (route.name as string) ||
        "New tab"
      updateActiveTab(newPath, name)
      return
    }

    // Case C: Session Restore
    // If we are at /start (initial load), try to restore the last active tab from store.
    if (newPath === "/start") {
      if (activeTabId.value) {
        const tab = tabs.value.find((t) => t.id === activeTabId.value)
        if (tab) {
          router.push(tab.fullPath)
        }
      }
      return
    }

    // Check if we should add a tab
    if (route.name) {
      const name =
        (route.meta?.breadcrumb as string) ||
        (route.name as string) ||
        "New tab"
      await addTab(newPath, name)
      // addTab inside store (optimistic) sets activeId, so we are good.
    }
  },
  { immediate: true }
)

// 2. Store -> Route (Secondary Truth)
// When Store activeTabId changes (e.g. closed tab, clicked tab in other window), ensure Router follows.
watch(
  activeTabId,
  (newId) => {
    // Ignore updates until hydrated
    if (!isHydrated.value) return

    // If no active tab, maybe go to start?
    if (!newId) {
      if (route.fullPath !== "/start" && tabs.value.length === 0) {
        router.push("/start")
      }
      return
    }

    const tab = tabs.value.find((t) => t.id === newId)
    if (tab && tab.fullPath !== route.fullPath) {
      router.push(tab.fullPath)
    }
  },
  // We generally don't need immediate here because the Route watcher handles the initial sync.
  // But if the store loads *after* the route, the route watcher might miss if the store was empty?
  // No, the route watcher handles "addTab".
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
      // When switching workspace, the store clears tabs.
      // We might want to go to /start immediately to avoid "ghost" routes adding themselves?
      // But usually the App persistence will redirect us.
      // The previous logic used `hasInitialized` to gate this.
      // With our simpler "Route -> Store" logic, if the user stays on OldRoute, it will try to AddTab to NewWorkspace.
      // We should indeed redirect to start or the workspace's active tab.
      // However, `layoutStore` persistence might load the new active tab and trigger the activeTabId watcher,
      // which will push the new route.
      // So mostly handled, but let's prevent accidental addition.
      // For now, relies on layoutStore clearing activeTabId -> triggers Router push /start
      if (tabs.value.length === 0) {
        router.push("/start")
      }
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
  const newTab = await addTab(fullPath, name)
  if (newTab) navigateToTab(newTab)
}

async function handleCloseTab(id: string | undefined) {
  if (!id) return
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
  if (target) navigateToTab(target)
}

// ----------------------------------------------------------------------------
// Global Events (Mitt)
// ----------------------------------------------------------------------------
function onTabsAdd(raw?: unknown) {
  const data = raw as
    | { fullPath?: string; path?: string; url?: string; name?: string }
    | undefined
  const path = data?.fullPath || data?.path || data?.url || "/new"
  handleAddTab(path, data?.name)
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
  router.push("/start")
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

// Register/Cleanup
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
        data-tauri-drag-region
        class="flex min-w-0 items-stretch gap-2 p-2 transition-all"
      >
        <BackForth />
        <nav
          ref="el"
          class="relative flex min-w-0 items-stretch justify-start gap-2"
        >
          <template v-if="pending">
            <Skeleton v-for="n in 3" :key="n" class="bg-accent h-9 w-60" />
          </template>
          <template v-else-if="tabs.length === 0">
            <Button
              variant="outline"
              class="w-60 min-w-0 shrink-0 justify-start border-dashed shadow-none"
              @click="emitter.emit('Tabs.Add')"
            >
              <IconPlus />
              {{ t("tabs.newTab") }}
            </Button>
          </template>
          <template v-else>
            <div
              v-for="(tab, index) in tabs"
              :key="tab.id"
              class="tab-item w-60 min-w-0 shrink"
              :class="{ 'min-w-40 transition-all': tab.id === activeTabId }"
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
                        class="group w-[-webkit-fill-available] min-w-0 pr-1.5!"
                        :class="
                          tab.id === activeTabId
                            ? 'text-foreground shadow-none'
                            : 'text-secondary-foreground/50 bg-secondary/50'
                        "
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
                          <IconLayers />
                          <span class="mr-auto truncate">
                            {{ tab.name }}
                          </span>
                          <TooltipProvider>
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
                    <ContextMenuContent class="w-56">
                      <ContextMenuGroup>
                        <ContextMenuItem
                          as-child
                          @click="emitter.emit('Tabs.Add')"
                        >
                          <RouterLink to="/new">
                            <IconPlus />
                            {{ t("tabs.newTab") }}
                            <ContextMenuShortcut>⌘T</ContextMenuShortcut>
                          </RouterLink>
                        </ContextMenuItem>
                      </ContextMenuGroup>
                      <ContextMenuSeparator />
                      <ContextMenuGroup>
                        <ContextMenuItem @click="handleCloseTab(tab.id)">
                          <IconX />
                          {{ t("common.close") }}
                          <ContextMenuShortcut>⌘W</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem
                          :disabled="tabs.length === 0"
                          @click="emitter.emit('Tabs.Close.All')"
                        >
                          <IconCircleX />
                          {{ t("tabs.closeAll") }}
                          <ContextMenuShortcut>⌘⌥W</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem
                          :disabled="tabs.length <= 1"
                          @click="emitter.emit('Tabs.Close.Others', tab.id)"
                        >
                          <IconSquareX />
                          {{ t("tabs.closeOthers") }}
                          <ContextMenuShortcut>⌘⇧W</ContextMenuShortcut>
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
                          <ContextMenuShortcut>F2</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem
                          :disabled="isDefaultRoute(tab)"
                          @click="handleDuplicateTab(tab.id)"
                        >
                          <IconCopy />
                          {{ t("tabs.duplicate") }}
                          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                        </ContextMenuItem>
                      </ContextMenuGroup>
                    </ContextMenuContent>
                  </ContextMenu>
                </HoverCardTrigger>
                <HoverCardContent
                  :side-offset="12"
                  class="flex w-60 flex-col gap-1.5 p-1.5"
                >
                  <div class="flex items-center justify-between px-1.5 py-1">
                    <span class="flex items-center gap-2">
                      <IconLayers />
                      {{ tab.name }}
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
        <div
          data-tauri-drag-region
          class="flex shrink-0 grow items-stretch justify-between gap-2"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  as-child
                  @click="emitter.emit('Tabs.Add')"
                >
                  <RouterLink to="/new">
                    <IconPlus />
                  </RouterLink>
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
                      <Button variant="secondary" size="icon">
                        <IconChevronDown />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent> {{ t("tabs.options") }} </TooltipContent>
                  <DropdownMenuContent align="end" side="bottom">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        as-child
                        @click="emitter.emit('Tabs.Add')"
                      >
                        <RouterLink to="/new">
                          <IconPlus />
                          {{ t("tabs.newTab") }}
                          <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
                        </RouterLink>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        :disabled="!activeTabId"
                        @click="handleCloseTab(activeTabId)"
                      >
                        <IconX />
                        {{ t("common.close") }}
                        <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="tabs.length === 0"
                        @click="emitter.emit('Tabs.Close.All')"
                      >
                        <IconCircleX />
                        {{ t("tabs.closeAll") }}
                        <DropdownMenuShortcut>⌘⌥W</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="tabs.length <= 1 || !activeTabId"
                        @click="emitter.emit('Tabs.Close.Others', activeTabId)"
                      >
                        <IconSquareX />
                        {{ t("tabs.closeOthers") }}
                        <DropdownMenuShortcut>⌘⇧W</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        :disabled="!activeTabId || isDefaultRoute(activeTab!)"
                        @click="handleRenameTab(activeTabId)"
                      >
                        <IconSquarePen />
                        {{ t("tabs.rename") }}
                        <DropdownMenuShortcut>F2</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        :disabled="!activeTabId || isDefaultRoute(activeTab!)"
                        @click="handleDuplicateTab(activeTabId)"
                      >
                        <IconCopy />
                        {{ t("tabs.duplicate") }}
                        <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
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
                        <DropdownMenuSubContent class="w-56">
                          <DropdownMenuLabel
                            v-if="tabs.length === 0"
                            class="text-muted-foreground text-xs"
                          >
                            {{ t("tabs.activeTabsEmpty") }}
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            v-for="tab in tabs"
                            :key="tab.id"
                            @click="emitter.emit('Tabs.Select', tab.id)"
                          >
                            <IconLayers />
                            {{ tab.name }}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            :disabled="tabs.length === 0"
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
                        <DropdownMenuSubContent class="w-56">
                          <DropdownMenuLabel
                            v-if="recentlyClosed.length === 0"
                            class="text-muted-foreground text-xs"
                          >
                            {{ t("tabs.recentlyClosedEmpty") }}
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            v-for="tab in recentlyClosed"
                            :key="tab.id + tab.fullPath"
                            @click="emitter.emit('Tabs.Reopen', tab)"
                          >
                            <IconLayers />
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
                  </DropdownMenuContent>
                </DropdownMenu>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-56" align="start" side="bottom">
      <ContextMenuGroup>
        <ContextMenuItem as-child @click="emitter.emit('Tabs.Add')">
          <RouterLink to="/new">
            <IconPlus />
            {{ t("tabs.newTab") }}
            <ContextMenuShortcut>⌘T</ContextMenuShortcut>
          </RouterLink>
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
          <ContextMenuShortcut>⌘⇧T</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>

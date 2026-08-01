<script lang="ts" setup>
import { useSidebar } from "@/components/ui/sidebar"
import { useCopy } from "@/composables/useCopy"
import { isTauri, useIsFullscreen } from "@/composables/usePlatform"
import { useShortcutKeys } from "@/composables/useShortcutKeys"
import { useTabRouterSync } from "@/composables/useTabRouterSync"
import { useTabs } from "@/composables/useTabs"
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
import { getPlatformSpecialKey } from "@/helpers/shortcuts"
import { isDefaultRoute } from "@/helpers/utilities"
import { emitter } from "@/modules/mitt"
import { useTabsStore } from "@/stores/tabsStore"
import { useUiPreferencesStore } from "@/stores/uiPreferencesStore"
import { useLocalStorage } from "@vueuse/core"
import { useSortable } from "@vueuse/integrations/useSortable"
import { storeToRefs } from "pinia"

// ----------------------------------------------------------------------------
// Environment / shell context
// ----------------------------------------------------------------------------
const isFullscreen = useIsFullscreen()
const { open, isMobile } = useSidebar()

const el = ref<HTMLElement>()
const { t } = useI18n()

// ----------------------------------------------------------------------------
// Layout store: tab state + panel flags + tab actions
// ----------------------------------------------------------------------------
const tabsStore = useTabsStore()
const {
  tabs,
  activeTabId,
  activeTab,
  recentlyClosed,
  isLoading: pending,
} = storeToRefs(tabsStore)
const { normalizeTabOrder, renameTab, clearRecentlyClosed } = tabsStore

// Derived views over the tabs store (guards, indicator merge, drag boundary).
const {
  hasClosableTabs,
  canCloseActiveTab,
  canRenameActiveTab,
  hasClosableOtherTabs,
  resolveTabIndicator,
  canDropWithinTabBoundary,
} = useTabs()

// Panel/sidebar collapse flags live in the per-user UI-preferences store.
const uiPreferencesStore = useUiPreferencesStore()
const {
  leftPanelCollapsed,
  rightPanelCollapsed,
  bottomPanelCollapsed,
  sidebarPinned,
} = storeToRefs(uiPreferencesStore)

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
const { copy, copied } = useCopy()

// ----------------------------------------------------------------------------
// Drag-and-drop reordering (boundary math lives in useTabs; pinned tabs stay
// grouped at the front)
// ----------------------------------------------------------------------------
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
// Local tab predicates + copy-URL UI (derived guards live in useTabs)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Route ⇄ store sync, navigation entry points, and the Tabs.* mitt bridge.
// Inline rename stays in this component (above); the composable triggers it
// through the `beginRename` callback.
// ----------------------------------------------------------------------------
const {
  onTabClick,
  openNewTab,
  handleCloseTab,
  handleDuplicateTab,
  handleToggleTabPinned,
} = useTabRouterSync({ beginRename: handleRenameTab })

// Reset the per-tab "copied" check mark when the clipboard flag clears.
watch(copied, (isCopied) => {
  if (!isCopied) copiedTabId.value = null
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
          <TooltipProvider v-else-if="isMobile || (!open && sidebarPinned)">
            <Tooltip>
              <TooltipTrigger as-child>
                <SidebarTrigger v-motion-fade-visible />
              </TooltipTrigger>
              <TooltipContent class="flex items-center gap-2 pr-2">
                {{ t("components.ui.toggleSidebar") }}
                <KbdGroup>
                  <Kbd>{{ getPlatformSpecialKey() }}</Kbd>
                  <Kbd>B</Kbd>
                </KbdGroup>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span
            v-if="!open || isMobile"
            v-motion-fade-visible
            class="inline-flex items-center"
          >
            <BackForth />
          </span>
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
                    <div
                      class="bg-secondary aspect-video rounded-4xl border"
                    ></div>
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
                          data-hotkey="p"
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
                          <DropdownMenuShortcut>P</DropdownMenuShortcut>
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

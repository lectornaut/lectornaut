<script setup lang="ts">
import { generateId } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useSortable } from "@vueuse/integrations/useSortable"
import { collection, doc, setDoc } from "firebase/firestore"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

const el = ref<HTMLElement | null>(null)

type Tab = {
  // Stable identifier for the tab (used for selection and ordering)
  id: string
  // User-visible title shown in the tab button
  name: string
  // Router fullPath to navigate when tab is activated
  fullPath: string
}

const db = useFirestore()
const user = useCurrentUser()

// Firestore document reference for persisting tabs per user under
// users/{uid}/layout/tabs
const tabsDocRef = computed(() => {
  if (!user.value?.uid) return null
  return doc(
    collection(doc(collection(db, "users"), user.value.uid), "layout"),
    "tabs"
  )
})

// Remote state binding: data (document snapshot as reactive object),
// pending (loading), error
const { data: tabsDocData, pending, error } = useDocument(tabsDocRef)

// Local UI state for tabs and selection
const tabs = ref<Tab[]>([])
const active = ref("")
// Stack of recently-closed tabs (for quick reopen)
const recentlyClosed = ref<Tab[]>([])

// Limit how many recently-closed items we keep
const MAX_RECENT = 20

// Guard for avoiding save loops when we hydrate from Firestore
let internalUpdate = false
// Guard to differentiate between route changes triggered by tab clicks
// vs. other router navigations (so we don't create new tabs unnecessarily)
let isTabClickNavigation = false

// Hydrate local state from Firestore and avoid triggering save until applied
watch(
  tabsDocData,
  (doc) => {
    if (doc) {
      internalUpdate = true
      tabs.value = doc.tabs ?? []
      active.value = doc.active ?? ""
      // Load recently closed list if present
      recentlyClosed.value = doc.recentlyClosed ?? []
      nextTick(() => {
        internalUpdate = false
      })
    }
  },
  { deep: true, immediate: true }
)

// Persist local changes (tabs, active) to Firestore with debounce.
// Merge to avoid clobbering other server fields accidentally.
watchDebounced(
  [tabs, active, recentlyClosed],
  ([newTabs, newActive, newRecent]) => {
    if (internalUpdate) return
    if (!tabsDocRef.value) return

    setDoc(
      tabsDocRef.value,
      { tabs: newTabs, active: newActive, recentlyClosed: newRecent },
      { merge: true }
    ).catch((err) => {
      console.error("Failed to sync tabs to Firestore", err)
    })
  },
  { debounce: 500, deep: true }
)

// Enable drag-and-drop reordering of tabs in the nav container
useSortable(el, tabs, {
  // Animate sibling movements while sorting
  animation: 150,
  // Make only our wrapper elements draggable
  draggable: ".tab-item",
  // Use the visible trigger area as the drag handle
  handle: ".hover-trigger",
  ghostClass: "cursor-grab",
  chosenClass: "cursor-grabbing",
  dragClass: "cursor-grabbing",
})

const route = useRoute()

// Create a Tab object from the current route (generates a new id)
function buildTabFromRoute(r: typeof route): Tab {
  return {
    id: generateId(),
    name: (r.meta?.breadcrumb as string) || (r.name as string) || "Tab",
    fullPath: r.fullPath,
  }
}

// Maintain a small MRU list of recently closed tabs.
// We dedupe by comparing to the head to avoid consecutive duplicates.
function addToRecentlyClosed(tab: Tab) {
  const entry = { id: tab.id, name: tab.name, fullPath: tab.fullPath }
  const head = recentlyClosed.value[0]
  if (head && head.fullPath === entry.fullPath && head.name === entry.name)
    return
  recentlyClosed.value = [entry, ...recentlyClosed.value].slice(0, MAX_RECENT)
}

// Close a tab by id, push it to recently closed, and select a sensible neighbor
function closeTabById(id: string) {
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx === -1) return
  const closing = tabs.value[idx]
  if (!closing) return
  addToRecentlyClosed(closing)
  const newTabs = tabs.value.slice()
  newTabs.splice(idx, 1)
  tabs.value = newTabs

  if (newTabs.length === 0) {
    active.value = ""
    return
  }

  const stillExists = newTabs.some((t) => t.id === active.value)
  if (!stillExists || closing.id === active.value) {
    const nextIndex = Math.min(idx, newTabs.length - 1)
    const nextTab = newTabs[nextIndex]!
    emitter.emit("Tabs.Select", nextTab.id)
  }
}

// Make a copy of a tab and select it
function duplicateTab(id: string) {
  const src = tabs.value.find((t) => t.id === id)
  if (!src) return
  const duplicate: Tab = {
    id: generateId(),
    name: src.name.endsWith(" (copy)") ? src.name : `${src.name} (copy)`,
    fullPath: src.fullPath,
  }
  tabs.value = [...tabs.value, duplicate]
  emitter.emit("Tabs.Select", duplicate.id)
}

// Prompt-based rename of a tab title
function renameTab(id: string) {
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx === -1) return
  const current = tabs.value[idx]
  if (!current) return
  const nextName = window.prompt("Rename tab", current.name)
  if (!nextName) return
  tabs.value[idx] = {
    id: current.id,
    name: nextName,
    fullPath: current.fullPath,
  }
}

// Clear the entire recently-closed list
function clearRecentlyClosed() {
  recentlyClosed.value = []
}

// Keep tabs in sync with route changes:
// 1) If the change came from clicking a tab, skip creating/updating.
// 2) If a tab already exists for the fullPath, just activate it.
// 3) If an active tab exists, update it in-place to reflect new route meta/path.
// 4) On first load or no active, create a new tab from the route.
watch(
  () => route.fullPath,
  () => {
    if (isTabClickNavigation) {
      isTabClickNavigation = false
      return
    }

    const existing = tabs.value.find((t) => t.fullPath === route.fullPath)
    if (existing) {
      active.value = existing.id
      return
    }

    if (active.value && tabs.value.length > 0) {
      const activeTabIndex = tabs.value.findIndex((t) => t.id === active.value)
      if (activeTabIndex !== -1) {
        const updatedTab = buildTabFromRoute(route)
        updatedTab.id = active.value
        tabs.value[activeTabIndex] = updatedTab
        return
      }
    }

    if (tabs.value.length === 0 || !active.value) {
      if (!route.name) return
      const newTab = buildTabFromRoute(route)
      tabs.value = [...tabs.value, newTab]
      active.value = newTab.id
    }
  },
  { immediate: true }
)

// Open or focus tabs via events from elsewhere in the app
emitter.on("Tabs.Add", (raw?: unknown) => {
  const tab = raw as Partial<Tab> & {
    path?: string
    fullPath?: string
    url?: string
  }
  let newTab: Tab
  if (tab && (tab.name || tab.fullPath || tab.path || tab.url)) {
    const targetPath = tab.fullPath || tab.path || tab.url || route.fullPath
    const existing = tabs.value.find((t) => t.fullPath === targetPath)
    if (existing) {
      emitter.emit("Tabs.Select", existing.id)
      return
    }
    newTab = {
      id: tab.id || generateId(),
      name: tab.name || "Tab",
      fullPath: targetPath,
    }
  } else {
    newTab = {
      id: generateId(),
      name: "New tab",
      fullPath: "/new",
    }
  }
  tabs.value = [...tabs.value, newTab]
  emitter.emit("Tabs.Select", newTab.id)
})

// Close current or specific tab id
emitter.on("Tabs.Close", (id?: unknown) => {
  const targetId = typeof id === "string" && id ? id : active.value
  if (targetId) closeTabById(targetId)
})

// Keep only the specified tab, move others to recently closed
emitter.on("Tabs.Close.Others", (id = active.value) => {
  const keep = tabs.value.find((t) => t.id === id)
  if (!keep) return
  tabs.value.forEach((t) => {
    if (t.id !== id) addToRecentlyClosed(t)
  })
  tabs.value = [keep]
  active.value = keep.id
})

// Close all tabs, but keep ability to reopen from recently closed
emitter.on("Tabs.Close.All", () => {
  tabs.value.forEach((t) => addToRecentlyClosed(t))
  tabs.value = []
  active.value = ""
})

// Select a tab and navigate to it
emitter.on("Tabs.Select", (idOrIndex) => {
  const id: string = idOrIndex as string
  const target = tabs.value.find((t) => t.id === id)
  if (!target) {
    console.warn(`Tab with id ${id} not found.`)
    if (tabs.value[0]) {
      active.value = tabs.value[0].id
    }
    return
  }
  active.value = target.id
})

// Reopen the most recently closed tab; focus an existing one if already open
emitter.on("Tabs.ReopenLast", () => {
  const last = recentlyClosed.value.shift()
  if (!last) return
  const reopened: Tab = {
    id: generateId(),
    name: last.name,
    fullPath: last.fullPath,
  }
  const existing = tabs.value.find((t) => t.fullPath === reopened.fullPath)
  if (existing) {
    emitter.emit("Tabs.Select", existing.id)
    return
  }
  tabs.value = [...tabs.value, reopened]
  emitter.emit("Tabs.Select", reopened.id)
})

// Reopen a specific recently-closed tab entry
emitter.on("Tabs.Reopen", (raw?: unknown) => {
  const t = raw as Tab | undefined
  if (!t) return
  const reopened: Tab = { id: generateId(), name: t.name, fullPath: t.fullPath }
  const existing = tabs.value.find((x) => x.fullPath === reopened.fullPath)
  if (existing) {
    emitter.emit("Tabs.Select", existing.id)
    return
  }
  tabs.value = [...tabs.value, reopened]
  emitter.emit("Tabs.Select", reopened.id)
})
</script>

<template>
  <ContextMenu>
    <div class="bg-background flex w-full flex-col">
      <ContextMenuTrigger as-child>
        <div
          data-tauri-drag-region
          class="flex grow items-stretch gap-2 p-2 transition-all"
        >
          <div class="flex items-stretch justify-start gap-2">
            <ButtonGroup>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="secondary" size="icon" class="shadow-none">
                      <icon-lucide-arrow-left />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> Go back </TooltipContent>
                </Tooltip>
                <ButtonGroupSeparator />
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="secondary" size="icon" class="shadow-none">
                      <icon-lucide-arrow-right />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> Go forward </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </ButtonGroup>
          </div>
          <nav
            ref="el"
            class="relative flex min-w-0 items-stretch justify-center gap-2"
          >
            <template v-if="pending">
              <Skeleton v-for="n in 3" :key="n" class="bg-accent h-9 w-60" />
            </template>
            <template v-else-if="error">
              <div
                class="text-destructive rounded-md bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px] bg-fixed px-4"
              >
                <icon-lucide-alert-triangle /> {{ error }}
              </div>
            </template>
            <template v-else-if="tabs.length === 0">
              <Button
                variant="ghost"
                size="icon"
                @click="emitter.emit('Tabs.Add')"
              >
                <icon-lucide-circle />
              </Button>
            </template>
            <template v-else>
              <div
                v-for="tab in tabs"
                :key="tab.id"
                class="tab-item w-60 min-w-0"
                :class="{ 'min-w-40 transition-all': tab.id === active }"
              >
                <HoverCard :open-delay="2000" :close-delay="0">
                  <HoverCardTrigger class="hover-trigger">
                    <ContextMenu>
                      <ContextMenuTrigger as-child class="context-trigger">
                        <Button
                          :variant="tab.id === active ? 'secondary' : 'ghost'"
                          class="group w-[-webkit-fill-available] min-w-0"
                          :class="
                            tab.id === active
                              ? 'text-foreground shadow-none'
                              : 'text-secondary-foreground/50 bg-secondary/50'
                          "
                          as-child
                          @click="emitter.emit('Tabs.Select', tab.id)"
                        >
                          <RouterLink :to="tab.fullPath">
                            <icon-lucide-workflow />
                            <span class="mr-auto truncate">
                              {{ tab.name }}
                            </span>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    class="invisible size-5 group-hover:visible"
                                    @click.prevent="
                                      emitter.emit('Tabs.Close', tab.id)
                                    "
                                  >
                                    <icon-lucide-x />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Close tab</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </RouterLink>
                        </Button>
                      </ContextMenuTrigger>
                      <ContextMenuContent class="w-56">
                        <ContextMenuGroup>
                          <ContextMenuItem
                            @click="emitter.emit('Tabs.Close', tab.id)"
                          >
                            <icon-lucide-x />
                            Close
                            <ContextMenuShortcut>⌘W</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            @click="emitter.emit('Tabs.Close.Others', tab.id)"
                          >
                            <icon-lucide-circle-x />
                            Close others
                            <ContextMenuShortcut>⌘⇧W</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            @click="emitter.emit('Tabs.Close.All')"
                          >
                            <icon-lucide-square-x />
                            Close all
                            <ContextMenuShortcut>⌘⇧Q</ContextMenuShortcut>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem @click="renameTab(tab.id)">
                            <icon-lucide-square-pen />
                            Rename
                            <ContextMenuShortcut>⌘R</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem @click="duplicateTab(tab.id)">
                            <icon-lucide-copy />
                            Duplicate
                            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem
                            as-child
                            @click="emitter.emit('Tabs.Add')"
                          >
                            <RouterLink to="/new">
                              <icon-lucide-plus />
                              New tab
                              <ContextMenuShortcut>⌘T</ContextMenuShortcut>
                            </RouterLink>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                      </ContextMenuContent>
                    </ContextMenu>
                  </HoverCardTrigger>
                  <HoverCardContent
                    class="grid w-60 grid-cols-1 p-0"
                    :side-offset="12"
                  >
                    <div class="flex flex-col p-3">
                      <span class="font-medium">
                        {{ tab.name }}
                      </span>
                      <span class="text-secondary-foreground text-xs">
                        {{ tab.fullPath }}
                      </span>
                    </div>
                    <Separator />
                    <div
                      class="bg-accent/50 text-muted-foreground flex items-center gap-2 rounded-b-md p-2"
                    >
                      <icon-lucide-hash />
                      <span class="truncate">{{ tab.id }}</span>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </div>
            </template>
          </nav>
          <div class="flex grow items-stretch justify-between gap-2">
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
                      <icon-lucide-plus />
                    </RouterLink>
                  </Button>
                </TooltipTrigger>
                <TooltipContent> New Tab </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div class="flex items-stretch justify-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <Combobox>
                    <ComboboxTrigger as-child>
                      <TooltipTrigger as-child>
                        <Button variant="outline" size="icon">
                          <icon-lucide-history />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent> History </TooltipContent>
                    </ComboboxTrigger>
                    <ComboboxList align="end">
                      <ComboboxInput
                        placeholder="Search tabs..."
                        class="border-none p-0 focus:border-inherit focus:ring-0"
                      />
                      <ComboboxEmpty> No tabs found. </ComboboxEmpty>
                      <ComboboxGroup v-if="tabs.length > 0" heading="Open tabs">
                        <ComboboxItem
                          v-for="tab in tabs"
                          :key="tab.id"
                          :value="tab"
                          @click="emitter.emit('Tabs.Select', tab.id)"
                        >
                          <icon-lucide-workflow />
                          {{ tab.name }}
                          <ComboboxItemIndicator>
                            <icon-lucide-check />
                          </ComboboxItemIndicator>
                        </ComboboxItem>
                      </ComboboxGroup>
                      <ComboboxGroup v-if="tabs.length > 0" heading="Actions">
                        <ComboboxItem
                          :value="'__close_all__'"
                          :disabled="tabs.length === 0"
                          @click.stop="emitter.emit('Tabs.Close.All')"
                        >
                          <icon-lucide-trash />
                          Close all tabs
                        </ComboboxItem>
                      </ComboboxGroup>
                      <ComboboxSeparator />
                      <ComboboxGroup
                        v-if="recentlyClosed.length > 0"
                        heading="Recently closed"
                      >
                        <ComboboxItem
                          v-for="tab in recentlyClosed"
                          :key="tab.id + tab.fullPath"
                          :value="tab"
                          @click="emitter.emit('Tabs.Reopen', tab)"
                        >
                          <icon-lucide-workflow />
                          {{ tab.name }}
                          <ComboboxItemIndicator>
                            <icon-lucide-check />
                          </ComboboxItemIndicator>
                        </ComboboxItem>
                      </ComboboxGroup>
                      <ComboboxGroup
                        v-if="recentlyClosed.length > 0"
                        heading="Actions"
                      >
                        <ComboboxItem
                          :value="'__clear_recently__'"
                          :disabled="recentlyClosed.length === 0"
                          @click.stop="clearRecentlyClosed()"
                        >
                          <icon-lucide-trash />
                          Clear recently closed
                        </ComboboxItem>
                      </ComboboxGroup>
                    </ComboboxList>
                  </Combobox>
                </Tooltip>
                <Tooltip>
                  <DropdownMenu>
                    <TooltipTrigger as-child>
                      <DropdownMenuTrigger as-child>
                        <Button variant="outline" size="icon">
                          <icon-lucide-chevron-down />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent> Tab options </TooltipContent>
                    <DropdownMenuContent class="w-56" align="end" side="bottom">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          @click="emitter.emit('Tabs.Close', active)"
                        >
                          <icon-lucide-x />
                          Close
                          <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          @click="emitter.emit('Tabs.Close.Others', active)"
                        >
                          <icon-lucide-circle-x />
                          Close others
                          <DropdownMenuShortcut>⌘⇧W</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          @click="emitter.emit('Tabs.Close.All')"
                        >
                          <icon-lucide-square-x />
                          Close all
                          <DropdownMenuShortcut>⌘⇧Q</DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem>
                          <icon-lucide-square-pen />
                          Rename
                          <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem @click="duplicateTab(active)">
                          <icon-lucide-copy />
                          Duplicate
                          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          as-child
                          @click="emitter.emit('Tabs.Add')"
                        >
                          <RouterLink to="/new">
                            <icon-lucide-plus />
                            New tab
                            <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
                          </RouterLink>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-56" align="end" side="bottom">
        <ContextMenuGroup>
          <ContextMenuItem as-child @click="emitter.emit('Tabs.Add')">
            <RouterLink to="/new">
              <icon-lucide-plus />
              New Tab
              <ContextMenuShortcut>⌘T</ContextMenuShortcut>
            </RouterLink>
          </ContextMenuItem>
          <ContextMenuItem @click="emitter.emit('Tabs.ReopenLast')">
            <icon-lucide-history />
            Reopen last tab
            <ContextMenuShortcut>⌘⇧T</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem @click="emitter.emit('Tabs.Close.All')">
            <icon-lucide-square-x />
            Close all
            <ContextMenuShortcut>⌘⇧Q</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </div>
    <Separator />
  </ContextMenu>
</template>

<script lang="ts" setup>
import { generateId } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useSortable } from "@vueuse/integrations/useSortable"
import { collection, doc, setDoc } from "firebase/firestore"
import { useRouter } from "vue-router"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

const el = ref<HTMLElement | null>(null)
const router = useRouter()
const route = useRoute()

type Tab = {
  id: string
  name: string
  fullPath: string
}

const db = useFirestore()
const user = useCurrentUser()

const tabsDocRef = computed(() => {
  if (!user.value?.uid) return null
  return doc(
    collection(doc(collection(db, "users"), user.value.uid), "layout"),
    "tabs"
  )
})

const { data: tabsDocData, pending, error } = useDocument(tabsDocRef)

const tabs = ref<Tab[]>([])
const active = ref("")
const recentlyClosed = ref<Tab[]>([])

const MAX_RECENT = 20

// Guard to prevent Firestore write loops during hydration
let isHydrating = false

// Hydrate local state from Firestore
watch(
  tabsDocData,
  (doc) => {
    if (!doc) return

    isHydrating = true
    tabs.value = doc.tabs ?? []
    active.value = doc.active ?? ""
    recentlyClosed.value = doc.recentlyClosed ?? []

    nextTick(() => {
      isHydrating = false
    })
  },
  { immediate: true }
)

// Persist local changes to Firestore with debounce
watchDebounced(
  [tabs, active, recentlyClosed],
  ([newTabs, newActive, newRecent]) => {
    if (isHydrating || !tabsDocRef.value) return

    setDoc(
      tabsDocRef.value,
      { tabs: newTabs, active: newActive, recentlyClosed: newRecent },
      { merge: true }
    ).catch((err) => {
      console.error("Failed to sync tabs to Firestore:", err)
    })
  },
  { debounce: 500, deep: true }
)

// Enable drag-and-drop reordering of tabs
useSortable(el, tabs, {
  animation: 150,
  draggable: ".tab-item",
  handle: ".hover-trigger",
  ghostClass: "cursor-grab",
  chosenClass: "cursor-grabbing",
  dragClass: "cursor-grabbing",
})

function buildTabFromRoute(r: typeof route): Tab {
  return {
    id: generateId(),
    name: (r.meta?.breadcrumb as string) || (r.name as string) || "Tab",
    fullPath: r.fullPath,
  }
}

function addToRecentlyClosed(tab: Tab) {
  const entry: Tab = {
    id: generateId(),
    name: tab.name,
    fullPath: tab.fullPath,
  }
  const head = recentlyClosed.value[0]

  // Avoid consecutive duplicates
  if (head?.fullPath === entry.fullPath && head?.name === entry.name) return

  recentlyClosed.value = [entry, ...recentlyClosed.value].slice(0, MAX_RECENT)
}

function closeTabById(id: string) {
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx === -1) return

  const closing = tabs.value[idx]
  if (!closing) return

  addToRecentlyClosed(closing)
  tabs.value = tabs.value.filter((t) => t.id !== id)

  // Handle empty tabs
  if (tabs.value.length === 0) {
    active.value = ""
    return
  }

  // Select next tab if we closed the active one
  if (closing.id === active.value) {
    const nextIndex = Math.min(idx, tabs.value.length - 1)
    const nextTab = tabs.value[nextIndex]
    if (nextTab) {
      active.value = nextTab.id
      router.push(nextTab.fullPath).catch((err) => {
        console.error("Failed to navigate to tab:", err)
      })
    }
  }
}

function duplicateTab(id: string) {
  const src = tabs.value.find((t) => t.id === id)
  if (!src) return

  const duplicate: Tab = {
    id: generateId(),
    name: src.name.endsWith(" (copy)") ? src.name : `${src.name} (copy)`,
    fullPath: src.fullPath,
  }

  tabs.value = [...tabs.value, duplicate]
  active.value = duplicate.id
  router.push(duplicate.fullPath).catch((err) => {
    console.error("Failed to navigate to duplicated tab:", err)
  })
}

function renameTab(id: string) {
  const tab = tabs.value.find((t) => t.id === id)
  if (!tab) return

  const nextName = window.prompt("Rename tab", tab.name)
  if (!nextName || nextName === tab.name) return

  tabs.value = tabs.value.map((t) =>
    t.id === id ? { ...t, name: nextName } : t
  )
}

function clearRecentlyClosed() {
  recentlyClosed.value = []
}

function selectNextTab(): string | undefined {
  if (tabs.value.length === 0) return

  const currentIndex = tabs.value.findIndex((t) => t.id === active.value)
  const nextIndex =
    currentIndex === -1 ? 0 : (currentIndex + 1) % tabs.value.length

  return tabs.value[nextIndex]?.id
}

function selectPreviousTab(): string | undefined {
  if (tabs.value.length === 0) return

  const currentIndex = tabs.value.findIndex((t) => t.id === active.value)
  const prevIndex =
    currentIndex === -1
      ? tabs.value.length - 1
      : (currentIndex - 1 + tabs.value.length) % tabs.value.length

  return tabs.value[prevIndex]?.id
}

function selectTabByIndex(index: number): string | undefined {
  if (tabs.value.length === 0) return

  const tabIndex = Math.max(0, Math.min(index - 1, tabs.value.length - 1))
  return tabs.value[tabIndex]?.id
}

// Sync tabs with route changes - create new tab if path doesn't exist
watch(
  () => route.fullPath,
  (fullPath) => {
    // Find existing tab for this path
    const existing = tabs.value.find((t) => t.fullPath === fullPath)

    if (existing) {
      // Just activate the existing tab
      active.value = existing.id
      return
    }

    // Create new tab only if route has a name
    if (!route.name) return

    const newTab = buildTabFromRoute(route)
    tabs.value = [...tabs.value, newTab]
    active.value = newTab.id
  },
  { immediate: true }
)

// Event handlers with cleanup on unmount
const eventHandlers = {
  "Tabs.Add": (raw?: unknown) => {
    const tab = raw as Partial<Tab> & { path?: string; url?: string }

    const targetPath = tab?.fullPath || tab?.path || tab?.url || "/new"
    const existing = tabs.value.find((t) => t.fullPath === targetPath)

    if (existing) {
      active.value = existing.id
      router.push(existing.fullPath).catch((err) => {
        console.error("Failed to navigate to tab:", err)
      })
      return
    }

    const newTab: Tab = {
      id: tab?.id || generateId(),
      name: tab?.name || "New tab",
      fullPath: targetPath,
    }

    tabs.value = [...tabs.value, newTab]
    active.value = newTab.id
    router.push(newTab.fullPath).catch((err) => {
      console.error("Failed to navigate to new tab:", err)
    })
  },

  "Tabs.Close": (id?: unknown) => {
    const targetId = typeof id === "string" && id ? id : active.value
    if (targetId) closeTabById(targetId)
  },

  "Tabs.Close.Others": (id?: unknown) => {
    const targetId = typeof id === "string" && id ? id : active.value
    const keep = tabs.value.find((t) => t.id === targetId)
    if (!keep) return

    tabs.value.forEach((t) => {
      if (t.id !== targetId) addToRecentlyClosed(t)
    })

    tabs.value = [keep]
    active.value = keep.id
  },

  "Tabs.Close.All": () => {
    tabs.value.forEach((t) => addToRecentlyClosed(t))
    tabs.value = []
    active.value = ""
  },

  "Tabs.Select": (idOrIndex?: unknown) => {
    if (tabs.value.length === 0) return

    let targetId: string | undefined

    if (idOrIndex === "next") {
      targetId = selectNextTab()
    } else if (idOrIndex === "previous") {
      targetId = selectPreviousTab()
    } else if (typeof idOrIndex === "number") {
      targetId = selectTabByIndex(idOrIndex)
    } else if (typeof idOrIndex === "string") {
      targetId = idOrIndex
    } else {
      targetId = tabs.value[0]?.id
    }

    if (!targetId) return

    const target = tabs.value.find((t) => t.id === targetId)
    if (!target) {
      console.warn(`Tab with id ${targetId} not found`)
      return
    }

    active.value = target.id

    if (route.fullPath !== target.fullPath) {
      router.push(target.fullPath).catch((err) => {
        console.error("Failed to navigate to tab:", err)
      })
    }
  },

  "Tabs.ReopenLast": () => {
    const last = recentlyClosed.value.shift()
    if (!last) return

    const existing = tabs.value.find((t) => t.fullPath === last.fullPath)

    if (existing) {
      active.value = existing.id
      router.push(existing.fullPath).catch((err) => {
        console.error("Failed to navigate to tab:", err)
      })
      return
    }

    const reopened: Tab = {
      id: generateId(),
      name: last.name,
      fullPath: last.fullPath,
    }

    tabs.value = [...tabs.value, reopened]
    active.value = reopened.id
    router.push(reopened.fullPath).catch((err) => {
      console.error("Failed to navigate to reopened tab:", err)
    })
  },

  "Tabs.Reopen": (raw?: unknown) => {
    const t = raw as Tab | undefined
    if (!t) return

    const existing = tabs.value.find((x) => x.fullPath === t.fullPath)

    if (existing) {
      active.value = existing.id
      router.push(existing.fullPath).catch((err) => {
        console.error("Failed to navigate to tab:", err)
      })
      return
    }

    const reopened: Tab = {
      id: generateId(),
      name: t.name,
      fullPath: t.fullPath,
    }

    tabs.value = [...tabs.value, reopened]
    active.value = reopened.id
    router.push(reopened.fullPath).catch((err) => {
      console.error("Failed to navigate to reopened tab:", err)
    })
  },
}

// Register all event handlers
Object.entries(eventHandlers).forEach(([event, handler]) => {
  emitter.on(event, handler)
})

// Cleanup event listeners on unmount
onUnmounted(() => {
  Object.entries(eventHandlers).forEach(([event, handler]) => {
    emitter.off(event, handler)
  })
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
                    <Button variant="secondary" size="icon">
                      <icon-lucide-arrow-left />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> Go back </TooltipContent>
                </Tooltip>
                <ButtonGroupSeparator />
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="secondary" size="icon">
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
                  <DropdownMenu>
                    <TooltipTrigger as-child>
                      <DropdownMenuTrigger as-child>
                        <Button variant="secondary" size="icon">
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
                        <DropdownMenuItem @click="renameTab(active)">
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
                        <DropdownMenuSub>
                          <DropdownMenuItem as-child>
                            <DropdownMenuSubTrigger>
                              <icon-lucide-workflow />
                              Active tabs
                            </DropdownMenuSubTrigger>
                          </DropdownMenuItem>
                          <DropdownMenuSubContent class="w-56">
                            <DropdownMenuItem
                              v-for="tab in tabs"
                              :key="tab.id"
                              @click="emitter.emit('Tabs.Select', tab.id)"
                            >
                              <icon-lucide-workflow />
                              {{ tab.name }}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator v-if="tabs.length > 0" />
                            <DropdownMenuItem
                              :disabled="tabs.length === 0"
                              @click="emitter.emit('Tabs.Close.All')"
                            >
                              <icon-lucide-trash />
                              Close all tabs
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                          <DropdownMenuItem as-child>
                            <DropdownMenuSubTrigger>
                              <icon-lucide-history />
                              Recent tabs
                            </DropdownMenuSubTrigger>
                          </DropdownMenuItem>
                          <DropdownMenuSubContent class="w-56">
                            <DropdownMenuItem
                              v-for="tab in recentlyClosed"
                              :key="tab.id + tab.fullPath"
                              @click="emitter.emit('Tabs.Reopen', tab)"
                            >
                              <icon-lucide-workflow />
                              {{ tab.name }}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator
                              v-if="recentlyClosed.length > 0"
                            />
                            <DropdownMenuItem
                              :disabled="recentlyClosed.length === 0"
                              @click="clearRecentlyClosed()"
                            >
                              <icon-lucide-trash />
                              Clear recent tabs
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
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

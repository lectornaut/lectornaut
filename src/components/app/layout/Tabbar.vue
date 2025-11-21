<script lang="ts" setup>
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconCircleX,
  IconCopy,
  IconHash,
  IconHistory,
  IconPlus,
  IconSquarePen,
  IconSquareX,
  IconTrash,
  IconWorkflow,
  IconX,
} from "@/data/icons"
import { generateId } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useSortable } from "@vueuse/integrations/useSortable"
import { collection, doc, setDoc } from "firebase/firestore"
import { useRouter } from "vue-router"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

const el = ref<HTMLElement | null>(null)
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

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
const activeTabId = ref("")
const recentlyClosed = ref<Tab[]>([])

const renamingTabId = ref<string | null>(null)
const renamingName = ref("")

const MAX_RECENT = 20

// Hydrate from Firestore
watch(
  tabsDocData,
  (doc) => {
    if (!doc) return
    tabs.value = doc.tabs ?? []
    activeTabId.value = doc.active ?? ""
    recentlyClosed.value = doc.recentlyClosed ?? []
  },
  { immediate: true }
)

// Persist to Firestore
watchDebounced(
  [tabs, activeTabId, recentlyClosed],
  ([newTabs, newActive, newRecent]) => {
    if (!tabsDocRef.value) return
    setDoc(
      tabsDocRef.value,
      { tabs: newTabs, active: newActive, recentlyClosed: newRecent },
      { merge: true }
    )
  },
  { debounce: 500, deep: true }
)

// Enable drag-and-drop reordering
useSortable(el, tabs, {
  animation: 150,
  draggable: ".tab-item",
  handle: ".hover-trigger",
})

// Create a new tab
function createTab(fullPath: string, name?: string): Tab {
  // If name is explicitly provided, use it
  if (name) {
    return {
      id: generateId(),
      name,
      fullPath,
    }
  }

  // Try to get name from the route that matches the fullPath
  const matchedRoute = router.resolve(fullPath)
  return {
    id: generateId(),
    name:
      (matchedRoute.meta?.breadcrumb as string) ||
      (matchedRoute.name as string) ||
      t("tabs.newTab"),
    fullPath,
  }
}

// Add tab to history
function addToHistory(tab: Tab) {
  const head = recentlyClosed.value[0]
  if (head?.fullPath === tab.fullPath && head?.name === tab.name) return

  recentlyClosed.value = [
    { id: generateId(), name: tab.name, fullPath: tab.fullPath },
    ...recentlyClosed.value,
  ].slice(0, MAX_RECENT)
}

// Navigate to a tab (used by event handlers and programmatic navigation)
function navigateToTab(tab: Tab) {
  activeTabId.value = tab.id
  router.push(tab.fullPath)
}

// Handle tab click - switch to the clicked tab
function onTabClick(tab: Tab) {
  activeTabId.value = tab.id
}

// Add a new tab
function addTab(fullPath = "/new", name?: string) {
  const newTab = createTab(fullPath, name)
  tabs.value.push(newTab)
  onTabClick(newTab)
  router.push(fullPath)
}

// Close a tab
function closeTab(id: string) {
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx === -1) return

  const closing = tabs.value[idx]
  if (!closing) return

  addToHistory(closing)
  tabs.value.splice(idx, 1)

  // No tabs left - navigate to /start and clear active tab
  if (tabs.value.length === 0) {
    activeTabId.value = ""
    router.push("/start")
    return
  }

  // If closed tab was active, switch to next or previous tab
  if (closing.id === activeTabId.value) {
    // Try to get the tab at the same index (next tab)
    // If no next tab, get the previous one (idx - 1)
    const nextTab = tabs.value[idx] || tabs.value[idx - 1]
    if (nextTab) {
      navigateToTab(nextTab)
    }
  }
}

// Duplicate a tab
function duplicateTab(id: string) {
  const src = tabs.value.find((t) => t.id === id)
  if (!src) return

  const duplicate = createTab(
    src.fullPath,
    src.name.endsWith(` ${t("tabs.copy")}`)
      ? src.name
      : `${src.name} ${t("tabs.copy")}`
  )
  tabs.value.push(duplicate)
  navigateToTab(duplicate)
}

// Rename a tab
function renameTab(id: string) {
  const tab = tabs.value.find((t) => t.id === id)
  if (!tab) return

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

  const tab = tabs.value.find((t) => t.id === renamingTabId.value)
  if (tab && renamingName.value.trim()) {
    tab.name = renamingName.value.trim()
  }
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

  if (idOrDirection === "next") {
    const idx = tabs.value.findIndex((t) => t.id === activeTabId.value)
    const nextIdx = (idx + 1) % tabs.value.length
    targetId = tabs.value[nextIdx]?.id
  } else if (idOrDirection === "previous") {
    const idx = tabs.value.findIndex((t) => t.id === activeTabId.value)
    const prevIdx = (idx - 1 + tabs.value.length) % tabs.value.length
    targetId = tabs.value[prevIdx]?.id
  } else if (typeof idOrDirection === "number") {
    const tabIdx = Math.max(
      0,
      Math.min(idOrDirection - 1, tabs.value.length - 1)
    )
    targetId = tabs.value[tabIdx]?.id
  } else {
    targetId = idOrDirection
  }

  const target = tabs.value.find((t) => t.id === targetId)
  if (target) navigateToTab(target)
}

// Sync route changes with tabs
watch(
  () => route.fullPath,
  (fullPath) => {
    if (!route.name) return

    // If no tabs and no active tab, don't create a tab (empty state)
    if (tabs.value.length === 0 && !activeTabId.value) return

    // Check if the route change is because we clicked on an existing tab
    const clickedTab = tabs.value.find(
      (t) => t.id === activeTabId.value && t.fullPath === fullPath
    )

    // If we clicked on a tab, don't update anything - tab is already active
    if (clickedTab) return

    // If we have an active tab, update it with the new route (normal navigation)
    if (activeTabId.value) {
      const activeTab = tabs.value.find((t) => t.id === activeTabId.value)
      if (activeTab) {
        activeTab.fullPath = fullPath
        activeTab.name =
          (route.meta?.breadcrumb as string) ||
          (route.name as string) ||
          activeTab.name
        return
      }
    }

    // No active tab or active tab not found - create a new tab
    const newTab = createTab(fullPath)
    tabs.value.push(newTab)
    activeTabId.value = newTab.id
  },
  { immediate: true }
)

// Event handlers
emitter.on("Tabs.Add", (raw?: unknown) => {
  const data = raw as
    | { fullPath?: string; path?: string; url?: string; name?: string }
    | undefined
  const path = data?.fullPath || data?.path || data?.url || "/new"
  addTab(path, data?.name)
})

emitter.on("Tabs.Close", (id?: unknown) => {
  closeTab((typeof id === "string" ? id : activeTabId.value) || "")
})

emitter.on("Tabs.Close.Others", (id?: unknown) => {
  const keepId = typeof id === "string" ? id : activeTabId.value
  const keep = tabs.value.find((t) => t.id === keepId)
  if (!keep) return

  tabs.value.forEach((t) => {
    if (t.id !== keepId) addToHistory(t)
  })
  tabs.value = [keep]
  activeTabId.value = keep.id
})

emitter.on("Tabs.Close.All", () => {
  tabs.value.forEach(addToHistory)
  tabs.value = []
  activeTabId.value = ""
  router.push("/start")
})

emitter.on("Tabs.Select", (idOrIndex?: unknown) => {
  if (typeof idOrIndex === "string" || typeof idOrIndex === "number") {
    selectTab(idOrIndex)
  }
})

emitter.on("Tabs.ReopenLast", () => {
  const last = recentlyClosed.value.shift()
  if (last) addTab(last.fullPath, last.name)
})

emitter.on("Tabs.Reopen", (raw?: unknown) => {
  const tab = raw as Tab | undefined
  if (tab) addTab(tab.fullPath, tab.name)
})

// Cleanup
onUnmounted(() => {
  emitter.off("Tabs.Add")
  emitter.off("Tabs.Close")
  emitter.off("Tabs.Close.Others")
  emitter.off("Tabs.Close.All")
  emitter.off("Tabs.Select")
  emitter.off("Tabs.ReopenLast")
  emitter.off("Tabs.Reopen")
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
                      <IconArrowLeft />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> {{ t("tabs.goBack") }} </TooltipContent>
                </Tooltip>
                <ButtonGroupSeparator />
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="secondary" size="icon">
                      <IconArrowRight />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> {{ t("tabs.goForward") }} </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </ButtonGroup>
          </div>
          <nav
            ref="el"
            class="relative flex min-w-0 items-stretch justify-center"
            :class="tabs.length === 0 ? 'hidden' : 'gap-2'"
          >
            <template v-if="pending">
              <Skeleton v-for="n in 3" :key="n" class="bg-accent h-9 w-60" />
            </template>
            <template v-else-if="error">
              <div
                class="text-destructive rounded-md bg-[repeating-linear-gradient(45deg,var(--muted)_0,var(--muted)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px] bg-fixed px-4"
              >
                <IconAlertTriangle /> {{ error }}
              </div>
            </template>
            <!-- <template v-else-if="tabs.length === 0">
              <Button
                variant="ghost"
                size="icon"
                @click="emitter.emit('Tabs.Add')"
              >
                <IconCircle />
              </Button>
            </template> -->
            <template v-else>
              <div
                v-for="tab in tabs"
                :key="tab.id"
                class="tab-item w-60 min-w-0"
                :class="{ 'min-w-40 transition-all': tab.id === activeTabId }"
              >
                <InputGroup v-if="renamingTabId === tab.id">
                  <InputGroupAddon>
                    <IconWorkflow />
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
                            @dblclick="renameTab(tab.id)"
                          >
                            <IconWorkflow />
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
                                    @click.prevent="closeTab(tab.id)"
                                  >
                                    <IconX />
                                  </InputGroupButton>
                                </TooltipTrigger>
                                <TooltipContent>{{
                                  t("common.close")
                                }}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </RouterLink>
                        </Button>
                      </ContextMenuTrigger>
                      <ContextMenuContent class="w-56">
                        <ContextMenuGroup>
                          <ContextMenuItem @click="closeTab(tab.id)">
                            <IconX />
                            {{ t("common.close") }}
                            <ContextMenuShortcut>⌘W</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            @click="emitter.emit('Tabs.Close.Others', tab.id)"
                          >
                            <IconCircleX />
                            {{ t("tabs.closeOthers") }}
                            <ContextMenuShortcut>⌘⇧W</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem
                            @click="emitter.emit('Tabs.Close.All')"
                          >
                            <IconSquareX />
                            {{ t("tabs.closeAll") }}
                            <ContextMenuShortcut>⌘⇧Q</ContextMenuShortcut>
                          </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem @click="renameTab(tab.id)">
                            <IconSquarePen />
                            {{ t("tabs.rename") }}
                            <ContextMenuShortcut>⌘R</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem @click="duplicateTab(tab.id)">
                            <IconCopy />
                            {{ t("tabs.duplicate") }}
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
                              <IconPlus />
                              {{ t("tabs.newTab") }}
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
                      <IconHash />
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
                    <DropdownMenuContent class="w-56" align="end" side="bottom">
                      <DropdownMenuGroup>
                        <DropdownMenuItem @click="closeTab(activeTabId)">
                          <IconX />
                          {{ t("common.close") }}
                          <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          @click="
                            emitter.emit('Tabs.Close.Others', activeTabId)
                          "
                        >
                          <IconCircleX />
                          {{ t("tabs.closeOthers") }}
                          <DropdownMenuShortcut>⌘⇧W</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          @click="emitter.emit('Tabs.Close.All')"
                        >
                          <IconSquareX />
                          {{ t("tabs.closeAll") }}
                          <DropdownMenuShortcut>⌘⇧Q</DropdownMenuShortcut>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem @click="renameTab(activeTabId)">
                          <IconSquarePen />
                          {{ t("tabs.rename") }}
                          <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem @click="duplicateTab(activeTabId)">
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
                              <IconWorkflow />
                              {{ t("tabs.activeTabs") }}
                            </DropdownMenuSubTrigger>
                          </DropdownMenuItem>
                          <DropdownMenuSubContent class="w-56">
                            <DropdownMenuItem
                              v-for="tab in tabs"
                              :key="tab.id"
                              @click="emitter.emit('Tabs.Select', tab.id)"
                            >
                              <IconWorkflow />
                              {{ tab.name }}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator v-if="tabs.length > 0" />
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
                              {{ t("tabs.recentTabs") }}
                            </DropdownMenuSubTrigger>
                          </DropdownMenuItem>
                          <DropdownMenuSubContent class="w-56">
                            <DropdownMenuItem
                              v-for="tab in recentlyClosed"
                              :key="tab.id + tab.fullPath"
                              @click="emitter.emit('Tabs.Reopen', tab)"
                            >
                              <IconWorkflow />
                              {{ tab.name }}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator
                              v-if="recentlyClosed.length > 0"
                            />
                            <DropdownMenuItem
                              :disabled="recentlyClosed.length === 0"
                              @click="recentlyClosed = []"
                            >
                              <IconTrash />
                              {{ t("tabs.clearRecent") }}
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
                            <IconPlus />
                            {{ t("tabs.newTab") }}
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
              <IconPlus />
              {{ t("tabs.newTab") }}
              <ContextMenuShortcut>⌘T</ContextMenuShortcut>
            </RouterLink>
          </ContextMenuItem>
          <ContextMenuItem @click="emitter.emit('Tabs.ReopenLast')">
            <IconHistory />
            {{ t("tabs.reopenLast") }}
            <ContextMenuShortcut>⌘⇧T</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem @click="emitter.emit('Tabs.Close.All')">
            <IconSquareX />
            {{ t("tabs.closeAll") }}
            <ContextMenuShortcut>⌘⇧Q</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </div>
    <Separator />
  </ContextMenu>
</template>

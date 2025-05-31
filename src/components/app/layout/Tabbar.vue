<script setup lang="ts">
import { generateId } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useSortable } from "@vueuse/integrations/useSortable"
import { collection, doc, setDoc } from "firebase/firestore"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

const el = ref<HTMLElement | null>(null)

type Tab = {
  id: string
  name: string
  url: string
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

const localTabs = ref<Tab[]>([])
const localActive = ref("")

const computedTabs = computed(() => tabsDocData.value?.tabs || [])
const computedActive = computed(() => tabsDocData.value?.active || "")

watch(
  () => computedTabs.value,
  (newTabs) => {
    localTabs.value = newTabs
  },
  { immediate: true }
)

watch(
  () => computedActive.value,
  (newActive) => {
    localActive.value = newActive
  },
  { immediate: true }
)

watch(
  localTabs,
  async (newTabs) => {
    if (!tabsDocRef.value) {
      console.error("tabsDocRef is null. Cannot update tabs.")
      return
    }
    try {
      await setDoc(tabsDocRef.value, { tabs: newTabs }, { merge: true })
    } catch (error) {
      console.error("Failed to update tabs:", error)
    }
  },
  { deep: true }
)

watch(localActive, async (newActive) => {
  if (!tabsDocRef.value) {
    console.error("tabsDocRef is null. Cannot update active tab.")
    return
  }
  try {
    await setDoc(tabsDocRef.value, { active: newActive }, { merge: true })
  } catch (error) {
    console.error("Failed to update active tab:", error)
  }
})

const tabs = computed({
  get: () => localTabs.value,
  set: (newTabs) => {
    localTabs.value = newTabs
  },
})

const active = computed({
  get: () => localActive.value,
  set: (newActive) => {
    localActive.value = newActive
  },
})

useSortable(el, tabs, {
  animation: 150,
  ghostClass: "cursor-grab",
  chosenClass: "cursor-grabbing",
  dragClass: "cursor-grabbing",
})

emitter.on(
  "Tabs.Add",
  (
    tab = {
      id: generateId(),
      name: "Sample tab",
      url: "/agents",
    }
  ) => {
    const newTab = tab as Tab
    tabs.value = [...tabs.value, newTab]
    emitter.emit("Tabs.Select", newTab.id)
  }
)

emitter.on("Tabs.Close", (id = active.value) => {
  const newTabs = tabs.value.filter((tab) => tab.id !== id)
  tabs.value = newTabs
  emitter.emit("Tabs.Select", newTabs[0]?.id)
})

emitter.on("Tabs.Close.Others", (id = active.value) => {
  const newTabs = tabs.value.filter((tab) => tab.id === id)
  tabs.value = newTabs
})

emitter.on("Tabs.Close.All", () => {
  tabs.value = []
  active.value = ""
})

emitter.on("Tabs.Select", (idOrIndex) => {
  const id: string = idOrIndex as string
  if (id === "next") {
    const currentIndex = tabs.value.findIndex((tab) => tab.id === active.value)
    const nextIndex = (currentIndex + 1) % tabs.value.length
    active.value = tabs.value[nextIndex]?.id || ""
  } else if (id === "previous") {
    const currentIndex = tabs.value.findIndex((tab) => tab.id === active.value)
    const previousIndex =
      (currentIndex - 1 + tabs.value.length) % tabs.value.length
    active.value = tabs.value[previousIndex]?.id || ""
  } else {
    active.value = id
  }
  if (!tabs.value.some((tab) => tab.id === active.value)) {
    console.warn(
      `Tab with id ${active.value} not found. Resetting to first tab.`
    )
    active.value = tabs.value[0]?.id || ""
  }
})

const dummyRecentTabs = [
  { id: "1", name: "Tab 1", url: "/agents" },
  { id: "2", name: "Tab 2", url: "/agents" },
  { id: "3", name: "Tab 3", url: "/agents" },
]
</script>

<template>
  <div class="bg-sidebar flex flex-col">
    <div
      data-tauri-drag-region
      class="relative flex grow items-center gap-2 p-2 transition-all"
    >
      <div class="flex items-center justify-between gap-2">
        <Combobox>
          <TooltipProvider>
            <Tooltip>
              <ComboboxTrigger as-child>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon">
                    <icon-lucide-history />
                  </Button>
                </TooltipTrigger>
              </ComboboxTrigger>
              <ComboboxList align="start">
                <ComboboxInput
                  placeholder="Search tabs..."
                  class="border-none p-0 focus:border-inherit focus:ring-0"
                />
                <ComboboxEmpty> No tabs found. </ComboboxEmpty>
                <ComboboxGroup heading="Open tabs">
                  <ComboboxItem v-for="tab in tabs" :key="tab.id" :value="tab">
                    <icon-lucide-workflow />
                    {{ tab.name }}
                    <ComboboxItemIndicator>
                      <icon-lucide-check />
                    </ComboboxItemIndicator>
                  </ComboboxItem>
                </ComboboxGroup>
                <ComboboxGroup heading="Recently closed">
                  <ComboboxItem
                    v-for="tab in dummyRecentTabs"
                    :key="tab.id"
                    :value="tab"
                  >
                    <icon-lucide-workflow />
                    {{ tab.name }}
                    <ComboboxItemIndicator>
                      <icon-lucide-check />
                    </ComboboxItemIndicator>
                  </ComboboxItem>
                </ComboboxGroup>
              </ComboboxList>
              <TooltipContent> History </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Combobox>
      </div>
      <nav
        ref="el"
        class="relative flex w-fit min-w-0 items-center justify-start gap-2"
      >
        <template v-if="pending">
          <icon-lucide-loader class="animate-spin" /> loading
        </template>
        <template v-else-if="error">
          <icon-lucide-alert-triangle /> error
        </template>
        <template v-else-if="tabs.length === 0">
          <icon-lucide-file-text /> empty
        </template>
        <template v-else>
          <!-- <Button
            v-for="tab in tabs"
            :key="tab.id"
            class="group flex w-60 min-w-0 flex-1 justify-between gap-2 border border-transparent bg-transparent"
            :class="{
              'border-border bg-background hover:bg-background min-w-32 text-inherit':
                tab.id === active,
            }"
            :variant="tab.id === active ? 'secondary' : 'ghost'"
            as-child
            @click="active = tab.id"
          > -->
          <ContextMenu v-for="tab in tabs" :key="tab.id">
            <!-- <HoverCard :close-delay="0"> -->
            <ContextMenuTrigger as-child>
              <!-- <HoverCardTrigger as-child> -->
              <Button
                class="group relative flex w-60 min-w-0 flex-1 justify-between gap-2 border border-transparent bg-transparent shadow-none"
                :class="
                  tab.id === active
                    ? 'border-border bg-background before:border-border before:bg-sidebar after:bg-sidebar before:text-background after:border-border after:text-background hover:bg-background min-w-32 rounded-b-none border-b-transparent text-inherit before:absolute before:-bottom-2.5 before:-left-2 before:z-20 before:h-10 before:w-2 before:rounded-br-full before:border-r before:border-b before:shadow-[2px_4px_0_currentcolor] after:absolute after:-right-2 after:-bottom-2.5 after:z-20 after:h-10 after:w-2 after:rounded-bl-full after:border-b after:border-l after:shadow-[-2px_4px_0_currentcolor]'
                    : 'before:bg-muted text-muted-foreground after:bg-muted before:absolute before:-left-1.5 before:h-3 before:w-0.5 before:rounded-full after:absolute after:-right-1.5 after:h-3 after:w-0.5 after:rounded-full'
                "
                :variant="tab.id === active ? 'secondary' : 'ghost'"
                as-child
                @click="active = tab.id"
              >
                <RouterLink :to="`${tab.url}/${tab.id}`">
                  <icon-lucide-workflow />
                  <span class="mr-auto truncate">
                    {{ tab.name }} {{ tab.id }}
                  </span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="invisible h-4 w-4 group-hover:visible"
                          @click.prevent="emitter.emit('Tabs.Close', tab.id)"
                        >
                          <icon-lucide-x />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Close tab</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <span
                    v-if="tab.id === active"
                    class="bg-background absolute inset-x-0 -bottom-2.5 z-10 h-2.5"
                  ></span>
                </RouterLink>
              </Button>
              <!-- </HoverCardTrigger> -->
            </ContextMenuTrigger>
            <ContextMenuContent class="w-56">
              <ContextMenuGroup>
                <ContextMenuItem>
                  <icon-lucide-x />
                  Close
                  <ContextMenuShortcut>⌘W</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem>
                  <icon-lucide-circle-x />
                  Close others
                  <ContextMenuShortcut>⌘⇧W</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem>
                  <icon-lucide-square-x />
                  Close all
                  <ContextMenuShortcut>⌘⇧Q</ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem>
                  <icon-lucide-square-pen />
                  Rename
                  <ContextMenuShortcut>⌘R</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem>
                  <icon-lucide-copy />
                  Duplicate
                  <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem>
                  <icon-lucide-plus />
                  New tab
                  <ContextMenuShortcut>⌘T</ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuContent>
            <!-- <HoverCardContent class="w-56"> Content </HoverCardContent> -->
            <!-- </HoverCard> -->
          </ContextMenu>
        </template>
      </nav>
      <div
        data-tauri-drag-region
        class="flex grow items-center justify-between gap-2"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                @click="emitter.emit('Tabs.Add')"
              >
                <icon-lucide-plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent> New Tab </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div class="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-chevron-down />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent> Tab options </TooltipContent>
                <DropdownMenuContent class="w-56" align="end" side="bottom">
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <icon-lucide-x />
                      Close
                      <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <icon-lucide-circle-x />
                      Close others
                      <DropdownMenuShortcut>⌘⇧W</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
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
                    <DropdownMenuItem>
                      <icon-lucide-copy />
                      Duplicate
                      <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <icon-lucide-plus />
                      New tab
                      <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
    <Separator />
  </div>
</template>

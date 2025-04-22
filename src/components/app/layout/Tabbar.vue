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

// Reactive tabs
const tabs = computed({
  get: () => localTabs.value,
  set: (newTabs) => {
    localTabs.value = newTabs
  },
})

// Reactive active tab
const active = computed({
  get: () => localActive.value,
  set: (newActive) => {
    localActive.value = newActive
  },
})

// Enable drag-and-drop
useSortable(el, tabs, {
  animation: 150,
  ghostClass: "cursor-grab",
  chosenClass: "cursor-grabbing",
  dragClass: "cursor-grabbing",
})

// Add tab
emitter.on("Tabs.Add", (tab) => {
  const newTab = tab as Tab
  tabs.value = [...tabs.value, newTab]
})

// Close tab
emitter.on("Tabs.Close", (id) => {
  const newTabs = tabs.value.filter((tab) => tab.id !== id)
  tabs.value = newTabs
})
</script>

<template>
  <div class="bg-sidebar flex flex-col">
    <div
      data-tauri-drag-region
      class="relative flex grow items-center gap-2 p-2 transition-all"
    >
      <div class="flex items-center justify-between gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon">
                <icon-lucide-history />
              </Button>
            </TooltipTrigger>
            <TooltipContent> History </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
          <Button
            v-for="tab in tabs"
            :key="tab.id"
            class="group relative flex w-60 min-w-0 flex-1 justify-between gap-2 border border-transparent bg-transparent"
            :class="
              tab.id === active
                ? 'border-border bg-sidebar before:border-border before:text-sidebar after:border-border after:text-sidebar hover:bg-sidebar min-w-24 rounded-b-none border-b-transparent text-inherit before:absolute before:-bottom-2.5 before:-left-2 before:z-20 before:h-4 before:w-2 before:rounded-br-full before:border-r before:border-b before:shadow-[2px_4px_0_currentcolor] after:absolute after:-right-2 after:-bottom-2.5 after:z-20 after:h-4 after:w-2 after:rounded-bl-full after:border-b after:border-l after:shadow-[-2px_4px_0_currentcolor]'
                : 'before:bg-muted after:bg-muted before:absolute before:-left-1.5 before:h-3 before:w-0.5 before:rounded-full after:absolute after:-right-1.5 after:h-3 after:w-0.5 after:rounded-full'
            "
            :variant="tab.id === active ? 'secondary' : 'ghost'"
            as-child
            @click="active = tab.id"
          >
            <RouterLink :to="tab.id">
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
                  <TooltipContent> Close Tab </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span
                v-if="tab.id === active"
                class="bg-sidebar absolute inset-x-0 -bottom-2.5 z-10 h-2.5"
              ></span>
            </RouterLink>
          </Button>
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
                @click="
                  emitter.emit('Tabs.Add', {
                    id: generateId(),
                    name: 'Sample tab',
                  })
                "
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
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="gap-2">
                  <icon-lucide-chevron-down />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Tab options </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
    <Separator />
    <Settings />
    <Shortcuts />
    <ExitTrigger />
  </div>
</template>

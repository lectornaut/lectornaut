<script setup lang="ts">
import { generateId } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { useSortable } from "@vueuse/integrations/useSortable"
import { useStorage } from "@vueuse/core"
import { useRoute, useRouter } from "vue-router"

const el = ref<HTMLElement | null>(null)
const router = useRouter()
const route = useRoute()

type Tab = {
  id: string | number
  name: string
  path: string
  icon?: string
}

const tabs = useStorage<Tab[]>("hyperjump-tabs", [
  {
    id: 1,
    name: "Sample tab",
    path: "/",
    icon: "workflow"
  },
])

const selectedTab = ref<string | number>(tabs.value[0]?.id || 1)

watch(
  () => route.path,
  (newPath) => {
    const existingTab = tabs.value.find((tab) => tab.path === newPath)
    if (existingTab) {
      selectedTab.value = existingTab.id
    }
  },
  { immediate: true }
)

useSortable(el, tabs, {
  animation: 150,
  ghostClass: "cursor-grab",
  chosenClass: "cursor-grabbing",
  dragClass: "cursor-grabbing",
})

const selectTab = (tab: Tab) => {
  selectedTab.value = tab.id
  router.push(tab.path)
}

const addTab = (tab: Tab) => {
  tabs.value.push(tab)
  selectTab(tab)
}

const closeTab = (id: string | number) => {
  const tabIndex = tabs.value.findIndex((tab) => tab.id === id)
  
  if (id === selectedTab.value) {
    const newSelectedIndex = tabIndex > 0 ? tabIndex - 1 : Math.min(tabIndex + 1, tabs.value.length - 1)
    if (tabs.value[newSelectedIndex]) {
      selectTab(tabs.value[newSelectedIndex])
    }
  }
  
  tabs.value.splice(tabIndex, 1)
  
  if (tabs.value.length === 0) {
    const defaultTab = {
      id: generateId(),
      name: "Home",
      path: "/",
      icon: "home"
    }
    addTab(defaultTab)
  }
}

emitter.on("Tabs.Add", (tab: any) => {
  if (!tab.path) {
    tab.path = route.path
  }
  
  const existingTab = tabs.value.find((t) => t.path === tab.path)
  if (existingTab) {
    selectTab(existingTab)
  } else {
    addTab(tab as Tab)
  }
})

emitter.on("Tabs.Close", (id) => {
  closeTab(id)
})

const getIconComponent = (iconName: string | undefined) => {
  if (!iconName) return 'icon-lucide-file'
  return `icon-lucide-${iconName}`
}
</script>

<template>
  <div class="bg-background flex flex-col">
    <div
      data-tauri-drag-region
      class="relative flex grow items-center gap-2 p-2 transition-all"
    >
      <nav
        ref="el"
        class="relative flex w-fit min-w-0 items-center justify-start gap-2 overflow-x-auto"
      >
        <Button
          v-for="tab in tabs"
          :key="tab.id"
          class="group relative flex w-56 min-w-0 grow justify-between gap-2 border border-transparent bg-transparent pr-2 font-normal shadow-none"
          :class="
            tab.id === selectedTab
              ? 'border-border bg-background before:border-border before:text-background after:border-border after:text-background hover:bg-background min-w-24 rounded-b-none border-b-transparent text-inherit before:absolute before:-bottom-2.5 before:-left-2 before:z-20 before:h-4 before:w-2 before:rounded-br-full before:border-r before:border-b before:shadow-[0px_8px_0_currentcolor] after:absolute after:-right-2 after:-bottom-2.5 after:z-20 after:h-4 after:w-2 after:rounded-bl-full after:border-b after:border-l after:shadow-[0px_8px_0_currentcolor]'
              : 'before:bg-muted after:bg-muted before:absolute before:-left-1.5 before:h-3 before:w-0.5 before:rounded-full after:absolute after:-right-1.5 after:h-3 after:w-0.5 after:rounded-full'
          "
          :variant="tab.id === selectedTab ? 'secondary' : 'ghost'"
          as-child
          @click="selectTab(tab)"
        >
          <div class="flex w-full items-center gap-2">
            <component :is="getIconComponent(tab.icon)" />
            <span class="mr-auto truncate"> {{ tab.name }} </span>
            <TooltipProvider v-if="tabs.length > 1">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="invisible h-4 w-4 group-hover:visible"
                    @click.stop="closeTab(tab.id)"
                  >
                    <icon-lucide-x />
                  </Button>
                </TooltipTrigger>
                <TooltipContent> Close Tab </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span
              v-if="tab.id === selectedTab"
              class="bg-background absolute inset-x-0 -bottom-2.5 z-10 h-2.5"
            ></span>
          </div>
        </Button>
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
                    name: 'New Tab',
                    path: route.path,
                    icon: 'plus-circle'
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
    
    <!-- Tab content will be rendered by router-view in the parent layout -->
    
    <!-- Global components -->
    <Settings v-if="false" />
    <Shortcuts v-if="false" />
    <ExitTrigger v-if="false" />
  </div>
</template>

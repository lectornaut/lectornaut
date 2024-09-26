<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"

const sidebar = ref<InstanceType<typeof ResizablePanel>>()
const leftSidebarVisibility = useStorage("leftSidebarVisibility", true)

watch(leftSidebarVisibility, (value) => {
  if (value) {
    sidebar.value?.expand()
  } else {
    sidebar.value?.collapse()
  }
})
</script>

<template>
  <ResizablePanelGroup direction="horizontal" auto-save-id="app">
    <ResizablePanel
      ref="sidebar"
      class="bg-muted transition-all"
      :default-size="20"
      :min-size="15"
      :max-size="25"
      collapsible
      @collapse="leftSidebarVisibility = false"
      @expand="leftSidebarVisibility = true"
    >
      <Sidebar v-if="leftSidebarVisibility" v-motion-fade />
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel :default-size="80" :min-size="75">
      <Toolbar />
      <Separator />
      <RouterView />
    </ResizablePanel>
  </ResizablePanelGroup>
</template>

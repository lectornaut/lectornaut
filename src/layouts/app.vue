<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"
import { leftSidebarVisibility } from "@/modules/theme"

const sidebar = ref<InstanceType<typeof ResizablePanel>>()

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
    <ResizableHandle
      class="invisible"
      @dblclick="leftSidebarVisibility = !leftSidebarVisibility"
    />
    <ResizablePanel :default-size="80" :min-size="75">
      <Toolbar />
      <RouterView v-slot="{ Component, route }">
        <Transition
          enter-active-class="transition ease-in-out duration-300"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="transition ease-in-out duration-300"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
          mode="out-in"
        >
          <template v-if="Component">
            <Component :is="Component" :key="route.path" />
          </template>
        </Transition>
      </RouterView>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>

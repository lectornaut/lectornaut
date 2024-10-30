<script setup lang="ts">
import { ResizablePanel } from "@/components/ui/resizable"
import emitter from "@/modules/mitt"
import { leftSidebarVisibility, rightSidebarVisibility } from "@/modules/theme"

const leftSidebar = ref<InstanceType<typeof ResizablePanel>>()
const rightSidebar = ref<InstanceType<typeof ResizablePanel>>()

emitter.on("Sidebar.Left.Toggle", () => {
  leftSidebarVisibility.value = !leftSidebarVisibility.value
})

emitter.on("Sidebar.Right.Toggle", () => {
  rightSidebarVisibility.value = !rightSidebarVisibility.value
})

watch(leftSidebarVisibility, (value) => {
  if (value) {
    leftSidebar.value?.expand()
  } else {
    leftSidebar.value?.collapse()
  }
})

watch(rightSidebarVisibility, (value) => {
  if (value) {
    rightSidebar.value?.expand()
  } else {
    rightSidebar.value?.collapse()
  }
})
</script>

<template>
  <ResizablePanelGroup direction="horizontal" auto-save-id="app">
    <ResizablePanel
      ref="leftSidebar"
      class="flex flex-col bg-muted/40 transition-all"
      :default-size="15"
      :min-size="10"
      :max-size="20"
      collapsible
      @collapse="leftSidebarVisibility = false"
      @expand="leftSidebarVisibility = true"
    >
      <LeftSidebar v-if="leftSidebarVisibility" v-motion-fade />
    </ResizablePanel>
    <ResizableHandle
      :class="{ invisible: !leftSidebarVisibility }"
      class="z-50 transition hover:scale-x-[3] active:scale-x-[3] data-[state=hover]:scale-x-[3] [&[data-resize-handle-active]]:scale-x-[3] [&[data-resize-handle-active]]:bg-primary"
      @dblclick="emitter.emit('Sidebar.Left.Toggle')"
    />
    <ResizablePanel
      :default-size="60"
      :min-size="50"
      class="flex flex-col bg-background transition-all"
    >
      <Toolbar />
      <main
        class="no-scrollbar flex grow flex-col overflow-auto overscroll-none"
      >
        <RouterView v-slot="{ Component, route }">
          <Transition
            enter-active-class="transition ease-in-out duration-200"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition ease-in-out duration-200"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
            mode="out-in"
          >
            <template v-if="Component">
              <Component :is="Component" :key="route.path" />
            </template>
          </Transition>
        </RouterView>
      </main>
    </ResizablePanel>
    <ResizableHandle
      :class="{ invisible: !rightSidebarVisibility }"
      class="z-50 transition hover:scale-x-[3] active:scale-x-[3] data-[state=hover]:scale-x-[3] [&[data-resize-handle-active]]:scale-x-[3] [&[data-resize-handle-active]]:bg-primary"
      @dblclick="emitter.emit('Sidebar.Right.Toggle')"
    />
    <ResizablePanel
      ref="rightSidebar"
      class="flex flex-col bg-muted/40 transition-all"
      :default-size="25"
      :min-size="20"
      :max-size="30"
      collapsible
      @collapse="rightSidebarVisibility = false"
      @expand="rightSidebarVisibility = true"
    >
      <RightSidebar v-if="rightSidebarVisibility" v-motion-fade />
    </ResizablePanel>
  </ResizablePanelGroup>
</template>

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
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <Titlebar />
    <Separator />
    <ResizablePanelGroup direction="horizontal" auto-save-id="app">
      <ResizablePanel
        ref="leftSidebar"
        class="flex flex-col transition-all"
        :min-size="10"
        :default-size="15"
        :max-size="20"
        collapsible
        @collapse="leftSidebarVisibility = false"
        @expand="leftSidebarVisibility = true"
      >
        <LeftSidebar
          v-motion-fade
          :left-sidebar-visibility="leftSidebarVisibility"
        />
      </ResizablePanel>
      <ResizableHandle
        class="data-resize-handle-active:bg-primary z-20 transition hover:scale-x-3 active:scale-x-3 data-resize-handle-active:scale-x-3 data-[state=hover]:scale-x-3"
        @dblclick="emitter.emit('Sidebar.Left.Toggle')"
      />
      <ResizablePanel
        :default-size="60"
        class="bg-background flex flex-col transition-all"
      >
        <Toolbar />
        <Separator />
        <SubNavigation />
        <main
          class="no-scrollbar bg-background z-30 m-2 flex grow flex-col overflow-auto overscroll-none rounded-md border shadow-md"
        >
          <RouterView v-slot="{ Component, route }">
            <template v-if="Component">
              <Transition
                enter-active-class="transition ease-in-out duration-200"
                enter-from-class="opacity-0"
                enter-to-class="opacity-100"
                leave-active-class="transition ease-in-out duration-200"
                leave-from-class="opacity-100"
                leave-to-class="opacity-0"
                mode="out-in"
              >
                <Component :is="Component" :key="route.path" />
              </Transition>
            </template>
          </RouterView>
        </main>
      </ResizablePanel>
      <ResizableHandle
        class="data-resize-handle-active:bg-primary z-20 transition hover:scale-x-3 active:scale-x-3 data-resize-handle-active:scale-x-3 data-[state=hover]:scale-x-3"
        @dblclick="emitter.emit('Sidebar.Right.Toggle')"
      />
      <ResizablePanel
        ref="rightSidebar"
        class="flex flex-col transition-all"
        :min-size="20"
        :default-size="25"
        :max-size="30"
        collapsible
        @collapse="rightSidebarVisibility = false"
        @expand="rightSidebarVisibility = true"
      >
        <RightSidebar v-if="rightSidebarVisibility" v-motion-fade />
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
</template>

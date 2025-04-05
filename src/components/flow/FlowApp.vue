<script setup lang="ts">
import useDragAndDrop from "@/composables/useDnD"
import { Background } from "@vue-flow/background"
import { Controls } from "@vue-flow/controls"
import "@vue-flow/controls/dist/style.css"
import { VueFlow, useVueFlow } from "@vue-flow/core"
import "@vue-flow/core/dist/style.css"
import "@vue-flow/core/dist/theme-default.css"
import { MiniMap } from "@vue-flow/minimap"
import "@vue-flow/minimap/dist/style.css"

const { onConnect, addEdges } = useVueFlow()

const { onDragOver, onDrop, onDragLeave, isDragOver } = useDragAndDrop()

const nodes = ref([])

onConnect(addEdges)
</script>

<template>
  <div class="flex grow">
    <VueFlow
      :nodes="nodes"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <Controls :show-fit-view="false" :show-interactive="false">
        <template #icon-zoom-in>
          <icon-lucide-plus />
        </template>
        <template #icon-zoom-out>
          <icon-lucide-minus />
        </template>
      </Controls>
      <MiniMap pannable zoomable />
      <Background
        :class="{ 'bg-muted': isDragOver }"
        class="relative transition"
      />
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { Background } from "@vue-flow/background"
import { Controls } from "@vue-flow/controls"
import { VueFlow, useVueFlow } from "@vue-flow/core"
import { MiniMap } from "@vue-flow/minimap"
import useDragAndDrop from "./useDnD"

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
      <Controls />
      <MiniMap pannable zoomable />
      <Background
        :class="{ 'bg-muted': isDragOver }"
        class="relative transition"
      />
    </VueFlow>
  </div>
</template>

<style lang="scss">
@import "@vue-flow/core/dist/style.css";
@import "@vue-flow/core/dist/theme-default.css";
@import "@vue-flow/minimap/dist/style.css";
@import "@vue-flow/controls/dist/style.css";
</style>

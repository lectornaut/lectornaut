<script setup lang="ts">
import useDragAndDrop from "./useDnD"

const { onDragStart } = useDragAndDrop()
</script>

<template>
  <div class="grid grid-cols-1 gap-4 p-4">
    <div
      class="rounded-md border"
      :draggable="true"
      @dragstart="onDragStart($event, 'input')"
    >
      Input Node
    </div>

    <div
      class="rounded-md border"
      :draggable="true"
      @dragstart="onDragStart($event, 'default')"
    >
      Default Node
    </div>

    <div
      class="rounded-md border"
      :draggable="true"
      @dragstart="onDragStart($event, 'output')"
    >
      Output Node
    </div>
  </div>
</template>

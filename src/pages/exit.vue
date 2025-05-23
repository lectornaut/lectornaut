<route lang="json">
{
  "meta": {
    "requiresUser": true,
    "title": "Exit"
  }
}
</route>

<script setup lang="ts">
import emitter from "@/modules/mitt"

useHead({
  title: "Exit",
})
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2 p-2">
      <Button variant="secondary" @click="emitter.emit('Dialog.Exit.Open')">
        Logout
      </Button>
    </div>
  </div>
</template>

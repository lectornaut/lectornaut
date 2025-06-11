<script setup lang="ts">
import emitter from "@/modules/mitt"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
  },
})

useHead({
  title: "Exit",
})
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2 p-2">
      <Button variant="secondary" @click="emitter.emit('Dialog.Exit.Open')">
        Logout
      </Button>
    </div>
  </div>
</template>

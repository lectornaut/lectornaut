<script setup lang="ts">
import emitter from "@/modules/mitt"
import IconAiAsk from "~icons/mingcute/ai-fill"
import IconBlock from "~icons/mingcute/layer-fill"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "New tab",
    breadcrumb: "New tab",
  },
})

useHead({
  title: "New tab",
})
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <EmptySection
        centered
        :icon="IconBlock"
        title="Console"
        description="No active terminal sessions. Create a new session to get started."
        action-text="Ask AI"
        @action="emitter.emit('Dialog.AiAsk.Toggle')"
      />
    </Sidebar>
  </Teleport>
  <EmptyTab />
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <EmptySection
        centered
        :icon="IconAiAsk"
        title="Get Instant Answers"
        description="Get instant help and code suggestions from our AI assistant."
        action-text="Ask AI"
        @action="emitter.emit('Dialog.AiAsk.Toggle')"
      />
    </Sidebar>
  </Teleport>
</template>

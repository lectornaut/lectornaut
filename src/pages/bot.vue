<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import { useRoute, useRouter } from "vue-router"

definePage({
  // Single component handles `/bot` (new chat) and `/bot/:id` (load specific
  // session). The optional `:id?` segment makes both addresses match here.
  path: "/bot/:id?",
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Bot",
    breadcrumb: "Bot",
  },
})

useHead({
  title: "Bot",
})

const botChat = useBotChat()
provide(BotChatContextKey, botChat)

const route = useRoute()
const router = useRouter()

const routeSessionId = computed(() => {
  const id = (route.params as { id?: string }).id
  return typeof id === "string" && id ? id : null
})

// URL → state: load whatever session the URL points at. `selectSession`
// bails silently if team/workspace haven't resolved yet, so it's safe to
// fire on an unresolved cold start — the watcher re-fires once they land.
watch(
  routeSessionId,
  (id) => {
    if (id) {
      void botChat.selectSession(id)
    } else if (botChat.sessionId.value) {
      botChat.startNewSession()
    }
  },
  { immediate: true }
)

// state → URL: when sessionId changes (e.g., the first message creates a
// new session, or removeSession clears the active one), reflect it in the
// address bar so the chat is linkable.
watch(botChat.sessionId, (id) => {
  const current = routeSessionId.value
  if (id && id !== current) {
    void router.push(`/bot/${id}`)
  } else if (!id && current) {
    void router.push("/bot")
  }
})
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <BotHistorySidebar />
  </Teleport>
  <AiChatShell />
  <Teleport defer to="#right-sidebar">
    <BotInspectorSidebar />
  </Teleport>
</template>

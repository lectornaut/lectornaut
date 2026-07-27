<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import { isTauri } from "@/composables/usePlatform"
import { IconPictureInPicture } from "@/data/icons"
import { openAiAskPopoutWindow } from "@/modules/aiAskPopout"
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

const { t } = useI18n()

const botChat = useBotChat()
provide(BotChatContextKey, botChat)

const route = useRoute()
const router = useRouter()

const routeSessionId = computed(() => {
  const id = (route.params as { id?: string }).id
  return typeof id === "string" && id ? id : null
})

// URL → state: load whatever session the URL points at. Safe to fire on
// an unresolved cold start (deep links, app restore): `selectSession`
// itself waits for team/workspace to resolve before loading.
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

// Pop the page's chat out into a detached window. With a session active
// (`/bot/:id`) it opens that session there; on a fresh `/bot` it opens a
// new-chat window. The page deliberately stays put (no reset to `/bot`)
// — both surfaces show the same session, kept in sync by the doc-level
// subscription watchers in `useBotChat`.
const popOut = () => {
  openAiAskPopoutWindow({
    sessionId: botChat.sessionId.value,
    title: t("pages.start.askAi"),
  })
}
</script>

<template>
  <Teleport defer to="#cta-dock">
    <TooltipProvider v-if="isTauri">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="outline" size="icon" @click="popOut">
            <IconPictureInPicture />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t("ai.openInNewWindow") }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </Teleport>
  <SidebarSlot side="left">
    <BotHistorySidebar />
  </SidebarSlot>
  <AiChatShell />
  <SidebarSlot side="right">
    <BotInspectorSidebar />
  </SidebarSlot>
</template>

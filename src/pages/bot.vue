<script lang="ts" setup>
import { useMacOSWindowControls } from "@/composables/useMacOSWindowControls"
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import {
  isTauri,
  useMacOSTrafficLightsVisible,
} from "@/composables/usePlatform"
import { IconSquareArrowOutUpRight, IconX } from "@/data/icons"
import { openAiAskPopoutWindow } from "@/modules/aiAskPopout"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { storeToRefs } from "pinia"
import { useRoute, useRouter } from "vue-router"

definePage({
  // Single component handles `/bot` (new chat) and `/bot/:id` (load specific
  // session). The optional `:id?` segment makes both addresses match here.
  path: "/bot/:id?",
  meta: {
    requiresUser: true,
    layout: "bot",
    sidebar: "Bot",
    breadcrumb: "Bot",
  },
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const isStandalone = computed(() => route.query.popout === "1")
const macOSTrafficLightsVisible = useMacOSTrafficLightsVisible()
const windowControlsHeader = useTemplateRef<HTMLElement>("windowControlsHeader")
useMacOSWindowControls(windowControlsHeader)

// Detached windows retain their conversation across shared preference refreshes.
// The bot layout remounts the page when switching presentation modes.
const botChat = useBotChat({ pinnedContext: isStandalone.value })
provide(BotChatContextKey, botChat)

const asParam = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null

const requestedAgentId = computed(() => asParam(route.query.agentId))

const { pickerAgents } = storeToRefs(useTeamAgentsStore())
const handedOverTitle = computed(() => asParam(route.query.title))
const chatTitle = computed(
  () =>
    botChat.activeSession.value?.title ||
    (requestedAgentId.value &&
      pickerAgents.value.find((agent) => agent.id === requestedAgentId.value)
        ?.name) ||
    handedOverTitle.value
)
const heading = computed(() => chatTitle.value || t("pages.start.askAi"))

useHead({
  title: computed(() => (isStandalone.value ? heading.value : "Bot")),
})

// Native titles do not follow document.title; retain the opener's title
// until the session or agent supplies a real one.
if (isTauri.value && isStandalone.value) {
  watch(
    chatTitle,
    (title) => {
      if (title) void getCurrentWindow().setTitle(title)
    },
    { immediate: true }
  )
}

const routeSessionId = computed(() => {
  return asParam((route.params as { id?: string }).id)
})

// URL → state: load whatever session the URL points at. Safe to fire on
// an unresolved cold start (deep links, app restore): `selectSession`
// itself waits for team/workspace to resolve before loading.
watch(
  [routeSessionId, requestedAgentId],
  ([id, agentId]) => {
    if (id) {
      if (agentId && botChat.sessionId.value !== id)
        botChat.selectAgent(agentId)
      void botChat.selectSession(id)
    } else {
      if (botChat.sessionId.value) botChat.startNewSession()
      botChat.selectAgent(agentId)
    }
  },
  { immediate: true }
)

// state → URL: when sessionId changes (e.g., the first message creates a
// new session, or removeSession clears the active one), reflect it in the
// address bar so the chat is linkable.
watch(botChat.sessionId, (id) => {
  const current = routeSessionId.value
  if (id !== current) {
    void router.push({
      path: id ? `/bot/${encodeURIComponent(id)}` : "/bot",
      query: route.query,
      hash: route.hash,
    })
  }
})

const closeWindow = () => {
  void getCurrentWindow().close()
}

// Pop the page's chat out into a detached window. With a session active
// (`/bot/:id`) it opens that session there; on a fresh `/bot` it opens a
// new-chat window. The page deliberately stays put (no reset to `/bot`)
// — both surfaces show the same session, kept in sync by the doc-level
// subscription watchers in `useBotChat`.
const popOut = () => {
  openAiAskPopoutWindow({
    sessionId: botChat.sessionId.value,
    agentId: botChat.activeAgentId.value,
    // Hand the real chat title over so the new window opens named,
    // rather than starting on the fallback and renaming itself once
    // the session doc loads there.
    title: botChat.activeSession.value?.title || t("pages.start.askAi"),
  })
}
</script>

<template>
  <div
    v-if="isStandalone"
    class="bg-background flex h-screen w-screen grow flex-col"
  >
    <header
      ref="windowControlsHeader"
      data-tauri-drag-region
      class="flex shrink-0 items-center justify-between gap-2 p-2"
      :class="{ 'pl-macos-window-controls': macOSTrafficLightsVisible }"
    >
      <h2
        data-tauri-drag-region
        class="text-foreground cn-font-heading min-w-0 flex-1 truncate text-base font-medium"
        :title="heading"
      >
        {{ heading }}
      </h2>
      <Button
        v-if="isTauri"
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        :aria-label="t('actions.close')"
        @click="closeWindow"
      >
        <IconX />
      </Button>
    </header>
    <AiChatShell />
  </div>
  <template v-else>
    <Teleport defer to="#cta-dock">
      <TooltipProvider v-if="isTauri">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="outline" size="icon" @click="popOut">
              <IconSquareArrowOutUpRight />
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
</template>

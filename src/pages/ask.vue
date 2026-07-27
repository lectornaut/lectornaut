<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import { isTauri, platform } from "@/composables/usePlatform"
import { IconX } from "@/data/icons"
import { useTeamAgentsStore } from "@/stores/teamAgentsStore"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { storeToRefs } from "pinia"
import { useRoute } from "vue-router"

// Standalone page hosted in a Tauri pop-out window (see
// `modules/aiAskPopout.ts`) — a single chat and nothing else, so it
// skips the app layout entirely.
definePage({
  meta: {
    requiresUser: true,
    layout: false,
  },
})

const { t } = useI18n()

const route = useRoute()

// Same independent-context pattern as `AiAsk.vue`: this window IS the
// chat, so the context lives for the window's lifetime. Fresh state by
// default; when the opener handed over a session, resume it.
// `pinnedContext`: this detached window keeps its chat across global
// team/workspace selection flickers (e.g. the main window refreshing
// re-settles the shared prefs docs) — without it the reset watcher
// wipes the agent pick back to the default persona.
const botChat = useBotChat({ pinnedContext: true })
provide(BotChatContextKey, botChat)

const asParam = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null

// Agent pop-outs pass `agentId` so a fresh chat starts with that persona
// pre-selected (resumed sessions restore it from the doc anyway — the
// eager set just keeps the composer correct while the load is in
// flight). The heading follows the agent's name once the store lands.
const requestedAgentId = asParam(route.query.agentId)
if (requestedAgentId) botChat.selectAgent(requestedAgentId)

const { pickerAgents } = storeToRefs(useTeamAgentsStore())
const heading = computed(
  () =>
    (requestedAgentId &&
      pickerAgents.value.find((agent) => agent.id === requestedAgentId)
        ?.name) ||
    t("pages.start.askAi")
)

useHead({ title: heading })

// Safe to fire from setup even though this window cold-boots the whole
// app: `selectSession` itself waits for team/workspace to resolve.
const requestedSessionId = asParam(route.query.sessionId)
if (requestedSessionId) {
  void botChat.selectSession(requestedSessionId)
}

// The session stays reachable from the bot page's history sidebar.
const closeWindow = () => {
  void getCurrentWindow().close()
}
</script>

<template>
  <div class="bg-background flex h-screen w-screen grow flex-col">
    <header
      data-tauri-drag-region
      class="flex items-center justify-between gap-2 p-2"
      :class="{ 'pl-22': isTauri && platform === 'macos' }"
    >
      <h2
        data-tauri-drag-region
        class="text-foreground cn-font-heading text-base font-medium"
      >
        {{ heading }}
      </h2>
      <Button
        v-if="isTauri"
        variant="ghost"
        size="icon-sm"
        @click="closeWindow"
      >
        <IconX />
      </Button>
    </header>
    <AiChatShell />
  </div>
</template>

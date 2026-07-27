<script lang="ts" setup>
import { BotChatContextKey, useBotChat } from "@/composables/useBotChat"
import type { ITeamAgent } from "@/types/domain"
import { onMounted, provide, watch } from "vue"

/**
 * AgentChatShell — drops `<AiChat />` + `<AiChatComposer />` into a
 * surface that has its OWN `BotChatContext`, with the supplied agent
 * pre-selected as the active persona.
 *
 * Why this exists: `AiChatShell` is a passive layout — it relies on a
 * parent (`pages/bot.vue`, `AiAsk.vue`, `NodeBot.vue`) having provided
 * the context before mounting it. The sidebar's agent sheets need
 * INDEPENDENT chats per agent (each with its own session list, model
 * picker, attached nodes, etc.), so each sheet creates its own
 * `useBotChat()` instance via this wrapper and provides it down to
 * children.
 *
 * Cost: each open sheet pays for one extra Firestore session-list
 * subscription. With the sidebar showing N agents and the user
 * unlikely to keep more than 1–2 sheets open at once, this is
 * negligible — and the alternative (sharing the page's context and
 * mutating its `activeAgentId` on sheet open) couples sheet lifecycle
 * to global chat state in ways that get weird fast.
 *
 * The agent is re-applied whenever the prop's `id` flips so the same
 * mounted sheet can be repointed at a different agent without
 * tear-down (e.g. if the parent ever animates between agents).
 */

const props = defineProps<{
  agent: ITeamAgent
  /** Forwarded to the composer's placeholder slot. */
  placeholder?: string
}>()

const botChat = useBotChat()
provide(BotChatContextKey, botChat)

// Apply the agent on mount AND whenever the parent swaps which agent
// this shell represents. `selectAgent(null)` first would clear any
// stale selection from a prior bind — but `useBotChat` always starts
// with `activeAgentId.value === null`, so the direct set is enough.
const applyAgent = (): void => {
  botChat.selectAgent(props.agent.id)
}
onMounted(applyAgent)
watch(() => props.agent.id, applyAgent)

// Read by `Agents.vue` when popping the sheet's chat out into a
// detached window — the live session id is what the window resumes.
defineExpose({ sessionId: botChat.sessionId })
</script>

<template>
  <div class="flex size-full min-h-0 min-w-0 grow flex-col overflow-hidden">
    <AiChat />
    <AiChatComposer :placeholder="placeholder" />
  </div>
</template>

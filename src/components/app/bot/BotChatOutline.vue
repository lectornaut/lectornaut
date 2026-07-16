<script lang="ts" setup>
import {
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller"
import { BotChatContextKey } from "@/composables/useBotChat"
import { inject } from "vue"

const { t } = useI18n()

const botChat = inject(BotChatContextKey)

// User turns double as the scroller's anchors (`scroll-anchor` in AiChat),
// so they are also the outline's entries — one row per question asked.
const userMessages = computed(() =>
  (botChat?.messages.value ?? []).filter((message) => message.role === "user")
)

const { scrollToMessage } = useMessageScroller()

// `currentAnchorId` answers "where am I": it points at the last anchor whose
// top has crossed the reading line and *stays* set after that anchor scrolls
// above the viewport — unlike `visibleMessageIds`, which only lists what is
// on screen. That persistence is what keeps exactly one row highlighted
// while the reader is deep inside a long agent reply.
const visibility = useMessageScrollerVisibility()
const currentAnchorId = computed(() => visibility.value.currentAnchorId)

// A user turn may open with the reply-quote block staged by the composer
// ("> quoted text" lines) — label the row with the first line of the actual
// ask instead of the quote.
const outlineLabel = (content: string): string => {
  for (const line of content.split("\n")) {
    const text = line.trim()
    if (text && !text.startsWith(">")) return text
  }
  return content.trim()
}

const jumpToMessage = (messageId: string) => {
  scrollToMessage(messageId, { align: "start", behavior: "smooth" })
}
</script>

<template>
  <!-- An outline of one entry is noise — the rail only appears once there
       is somewhere to jump to. -->
  <HoverCard
    v-if="userMessages.length > 1"
    :open-delay="150"
    :close-delay="100"
  >
    <HoverCardTrigger as-child>
      <button
        type="button"
        :aria-label="t('ai.outline')"
        class="focus-visible:ring-ring/30 flex w-8 flex-col items-center justify-center gap-1 overflow-hidden rounded-md transition-colors outline-none focus-visible:ring-3"
      >
        <!-- One tick per turn. `shrink min-h-px` lets long chats compress
             the ticks instead of overflowing the 36px trigger. -->
        <span
          v-for="message in userMessages"
          :key="message.id"
          :data-current="message.id === currentAnchorId"
          class="bg-muted-foreground/40 data-[current=true]:bg-foreground h-0.5 min-h-px w-2 shrink rounded-md transition-colors"
        />
      </button>
    </HoverCardTrigger>
    <HoverCardContent
      side="left"
      align="center"
      class="flex max-h-80 w-64 flex-col gap-0.5 overflow-y-auto rounded-md p-1"
    >
      <button
        v-for="message in userMessages"
        :key="message.id"
        type="button"
        :aria-current="currentAnchorId === message.id ? 'location' : undefined"
        :data-current="currentAnchorId === message.id"
        class="hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-[current=true]:bg-accent data-[current=true]:text-accent-foreground flex min-h-7 items-center rounded-xl px-2 py-1.5 text-left text-sm transition-colors outline-none"
        @click="jumpToMessage(message.id)"
      >
        <span class="line-clamp-1 min-w-0">
          {{ outlineLabel(message.content) }}
        </span>
      </button>
    </HoverCardContent>
  </HoverCard>
</template>

<script lang="ts" setup>
import {
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller"
import { BotChatContextKey } from "@/composables/useBotChat"
import { splitUploadedFileLabels } from "@lectornaut/shared/domain"
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
// ask instead of the quote. `[Uploaded file …]` labels render as chips in
// the bubble, so they're stripped here too; an attachment-only turn falls
// back to its first file name.
const outlineLabel = (content: string): string => {
  const { text, attachments } = splitUploadedFileLabels(content)
  for (const line of text.split("\n")) {
    const lineText = line.trim()
    if (lineText && !lineText.startsWith(">")) return lineText
  }
  return attachments[0] ?? text
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
      <Button
        type="button"
        :aria-label="t('ai.outline')"
        variant="ghost"
        class="grid h-full grid-cols-1 items-center justify-center gap-1 overflow-hidden py-2"
      >
        <!-- One tick per turn. `shrink min-h-px` lets long chats compress
             the ticks instead of overflowing the 36px trigger. -->
        <span
          v-for="message in userMessages"
          :key="message.id"
          :data-current="message.id === currentAnchorId"
          class="bg-muted-foreground/50 data-[current=true]:bg-foreground h-0.5 min-h-px w-2 shrink rounded-4xl transition-colors"
        />
      </Button>
    </HoverCardTrigger>
    <HoverCardContent
      side="left"
      align="center"
      class="aspect-square w-64 overflow-clip p-0"
    >
      <!-- The height cap must sit on the OS viewport itself: the popover's
           height is auto, so percentage/stretch sizing never reaches the
           scroll element and OS measures zero overflow (dead wheel). The
           outer max-h-80 only guards the frame before deferred init. -->
      <ScrollContainer class="p-1">
        <Button
          v-for="message in userMessages"
          :key="message.id"
          type="button"
          :variant="currentAnchorId === message.id ? 'secondary' : 'ghost'"
          :aria-current="
            currentAnchorId === message.id ? 'location' : undefined
          "
          class="justify-start text-left"
          @click="jumpToMessage(message.id)"
        >
          <span class="min-w-0 truncate">
            {{ outlineLabel(message.content) }}
          </span>
        </Button>
      </ScrollContainer>
    </HoverCardContent>
  </HoverCard>
</template>

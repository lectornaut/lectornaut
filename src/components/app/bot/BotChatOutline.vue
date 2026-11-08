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

// An outline of one entry is noise, so the rail only appears once there is
// somewhere to jump to. Every turn is one level, so all bars share a width.
const railItems = computed(() =>
  userMessages.value.length > 1
    ? userMessages.value.map((message) => ({
        id: message.id,
        label: outlineLabel(message.content),
        active: message.id === currentAnchorId.value,
      }))
    : []
)

const jumpToMessage = (messageId: string) => {
  scrollToMessage(messageId, { align: "start", behavior: "smooth" })
}
</script>

<template>
  <OutlineRail
    :items="railItems"
    :label="t('ai.outline')"
    @select="jumpToMessage"
  />
</template>

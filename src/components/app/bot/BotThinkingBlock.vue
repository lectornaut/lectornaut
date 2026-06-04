<script lang="ts" setup>
/**
 * BotThinkingBlock — renders `<thinking>…</thinking>` blocks the model
 * may emit when reasoning before its answer. It's wired up in two
 * halves, BOTH required and both scoped to the `chat` surface:
 *   1. `registerMarkdownOverrides.ts` maps the `thinking` tag → this
 *      component via `setCustomComponents("chat", …)`.
 *   2. `AppMarkdown.vue` allow-lists `thinking` for parsing via its
 *      `custom-html-tags` prop (chat surface only).
 *
 * markstream hands a custom tag to its component as a `node` prop whose
 * `content` is the inner Markdown STRING — not a pre-rendered default
 * slot. So we render `node.content` through a nested `AppMarkdown` on the
 * same `chat` surface (which re-applies the chat overrides, the `safe`
 * HTML policy, the theme, and the `thinking` allowlist) inside a
 * collapsed-by-default disclosure — keeping reasoning out of the way
 * without hiding it.
 *
 * The disclosure mirrors `BotChatToolCall`: the same muted `Item`
 * trigger, and the expanded reasoning sits in a `Card` > `CardContent`
 * (no header — there's no input to echo) so a thinking block reads as
 * the same kind of card as a tool-call result.
 */

import { IconChevronRight } from "@/data/icons"

const props = defineProps<{
  /** Custom-tag node from markstream; `content` is the inner Markdown. */
  node: { content?: string }
  /** Scope key forwarded by the parent renderer (always "chat" here). */
  customId?: string
}>()

const { t } = useI18n()
const open = ref(false)

const reasoning = computed(() => props.node?.content ?? "")
</script>

<template>
  <Collapsible v-model:open="open" class="bot-thinking-block grid gap-2">
    <CollapsibleTrigger as-child>
      <Item size="xs" class="group/thinking p-0 text-xs select-none">
        <ItemContent>
          <ItemTitle
            class="text-muted-foreground/80 group-hover/thinking:text-muted-foreground flex items-center gap-1 text-xs"
          >
            {{ t("ai.reasoning") }}
            <IconChevronRight
              class="text-muted-foreground/80 group-hover/thinking:text-muted-foreground size-3! transition-transform will-change-transform"
              :class="{ 'rotate-90': open }"
            />
          </ItemTitle>
        </ItemContent>
      </Item>
    </CollapsibleTrigger>
    <CollapsibleContent class="select-auto">
      <Card size="sm">
        <CardContent>
          <AppMarkdown surface="chat" :content="reasoning" />
        </CardContent>
      </Card>
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
/* Flatten the reasoning card: the chat surface is painted with the card
   color (body bg in `@/styles/index.css`), so the default shadow/ring add
   no contrast — and the shadow is invisible in dark mode. Shadow + ring
   are both composed into `box-shadow`, so one reset clears both. Matches
   BotChatToolCall's cards. */
:deep([data-slot="card"]) {
  box-shadow: none;
}
</style>

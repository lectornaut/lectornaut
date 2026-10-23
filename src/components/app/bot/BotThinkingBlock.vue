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
 * The shared Trace components give reasoning and tool calls one expandable
 * activity-row treatment. Expanded reasoning renders inline beneath its
 * trace row rather than in a second card surface.
 */

import { IconBrain } from "@/data/icons"

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
  <Trace class="bot-thinking-block">
    <TraceCollapsible
      v-model:open="open"
      class="before:bg-border relative grid gap-2 pl-5 before:absolute before:top-3 before:bottom-0 before:left-[7px] before:w-px"
    >
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon class="bg-background -ml-5">
            <IconBrain />
          </TraceIcon>
          <TraceTitle>{{ t("ai.reasoning") }}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent class="select-auto">
        <AppMarkdown surface="chat" :content="reasoning" />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>
</template>

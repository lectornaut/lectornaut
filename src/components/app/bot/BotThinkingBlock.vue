<script lang="ts" setup>
/**
 * BotThinkingBlock — renders `<thinking>…</thinking>` blocks the model
 * may emit when reasoning before its answer. Registered against the
 * `chat` custom-id via `setCustomComponents` in `AppMarkdown.vue`, so
 * it only kicks in for chat bubbles.
 *
 * Markstream passes the contents of the custom tag as the default slot
 * already rendered into markdown nodes, so we just wrap them in a
 * collapsed-by-default disclosure to keep reasoning out of the way
 * without hiding it.
 */
import { IconChevronDown, IconSparkles } from "@/data/icons"

const { t } = useI18n()
const open = ref(false)
</script>

<template>
  <Collapsible v-model:open="open">
    <CollapsibleTrigger>
      <IconSparkles />
      <span>{{ t("ai.reasoning") }}</span>
      <IconChevronDown
        class="ml-auto transition-transform"
        :class="{ 'rotate-180': open }"
      />
    </CollapsibleTrigger>
    <CollapsibleContent class="text-muted-foreground text-xs">
      <slot />
    </CollapsibleContent>
  </Collapsible>
</template>

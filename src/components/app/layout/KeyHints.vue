<script lang="ts" setup>
import { useKeyHints } from "@/composables/useKeyHints"

const { t } = useI18n()
const { hint } = useKeyHints()
</script>

<template>
  <!-- The live region stays mounted so assistive tech announces changes;
       only its content comes and goes. -->
  <div
    role="status"
    aria-live="polite"
    :aria-label="t('components.global.shortcuts.hints')"
    class="flex min-w-0"
  >
    <div
      v-if="hint"
      v-motion-fade
      class="text-muted-foreground flex min-w-0 items-center rounded-2xl text-xs whitespace-nowrap"
    >
      <KbdGroup class="shrink-0 rounded-2xl p-1 shadow">
        <span class="sr-only">{{
          t("components.global.shortcuts.hintPressed", {
            keys: hint.pressed.join(" "),
          })
        }}</span>
        <Kbd
          v-for="(key, index) in hint.pressed"
          :key="`${index}-${key}`"
          aria-hidden="true"
          class="bg-primary text-primary-foreground"
        >
          {{ key }}
        </Kbd>
      </KbdGroup>
      <ul
        class="no-scrollbar scroll-fade-x flex min-w-0 items-center overflow-x-auto"
      >
        <li
          v-for="option in hint.options"
          :key="option.id"
          class="flex shrink-0 items-center gap-1 px-2 py-1"
        >
          <span class="sr-only">{{
            t("components.global.shortcuts.hintPressFor", {
              keys: option.keys.join(" "),
              action: option.label,
            })
          }}</span>
          <KbdGroup aria-hidden="true">
            <Kbd v-for="(key, index) in option.keys" :key="`${index}-${key}`">
              {{ key }}
            </Kbd>
          </KbdGroup>
          <span aria-hidden="true">{{ option.label }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

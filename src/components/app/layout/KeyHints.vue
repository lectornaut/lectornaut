<script lang="ts" setup>
import { useKeyHints, type KeyHint } from "@/composables/useKeyHints"
import { getHotkeyManager } from "@tanstack/vue-hotkeys"

const { t } = useI18n()
const { hint: liveHint } = useKeyHints()

// Keep the last hint up while the pointer is over it, so releasing the keys
// doesn't yank it away mid-read; it clears once the pointer leaves.
const root = useTemplateRef("root")
const hovered = useElementHover(root)
const hint = ref<KeyHint | null>(null)
watchEffect(() => {
  if (liveHint.value) hint.value = liveHint.value
  else if (!hovered.value) hint.value = null
})

// Clicking an option runs it, so a hint kept up by hover still works after
// the keyboard has timed out. Reset sequence progress so a half-typed `G`
// doesn't linger behind the click.
// ponytail: 0.20 dropped `triggerRegistration`, so call the registered
// callback directly with a synthetic event, as that method used to.
const run = (id: string) => {
  const manager = getHotkeyManager()
  manager.resetSequenceProgress()
  hint.value = null
  const registration = manager.registrations.state.get(id)
  if (!registration) return
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
  })
  if (registration.kind === "chord") {
    const { hotkey, parsedChord } = registration
    registration.callback(event, { kind: "chord", hotkey, parsedChord })
  } else {
    const { hotkey, parsedSequence } = registration
    registration.callback(event, { kind: "sequence", hotkey, parsedSequence })
  }
}
</script>

<template>
  <!-- The live region stays mounted so assistive tech announces changes;
       only its content comes and goes. -->
  <div
    ref="root"
    role="status"
    aria-live="polite"
    :aria-label="t('components.global.shortcuts.hints')"
    class="flex min-w-0"
  >
    <div
      v-if="hint"
      v-motion-fade
      class="text-muted-foreground rounded-item flex min-w-0 items-center gap-2 text-xs whitespace-nowrap"
    >
      <KbdGroup class="rounded-item shrink-0 p-1 shadow">
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
        class="no-scrollbar scroll-fade-x relative flex min-w-0 items-center gap-2 overflow-x-auto"
      >
        <li v-for="option in hint.options" :key="option.id" class="shrink-0">
          <Button
            variant="secondary"
            size="sm"
            class="pl-0"
            @click="run(option.id)"
          >
            <span class="sr-only">{{
              t("components.global.shortcuts.hintPressFor", {
                keys: option.keys.join(" "),
                action: option.label,
              })
            }}</span>
            <KbdGroup
              aria-hidden="true"
              class="rounded-item shrink-0 p-1 shadow"
            >
              <Kbd v-for="(key, index) in option.keys" :key="`${index}-${key}`">
                {{ key }}
              </Kbd>
            </KbdGroup>
            <span aria-hidden="true">{{ option.label }}</span>
          </Button>
        </li>
      </ul>
    </div>
  </div>
</template>

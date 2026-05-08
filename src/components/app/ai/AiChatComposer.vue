<script lang="ts" setup>
import {
  BotChatContextKey,
  BOT_CHAT_MODE_OPTIONS,
  type BotChatMode,
} from "@/composables/useBotChat"
import { IconArrowUp, IconPlus } from "@/data/icons"
import { computed, inject } from "vue"

const props = withDefaults(
  defineProps<{
    placeholder?: string
    usageLabel?: string
  }>(),
  {
    usageLabel: "52% used",
  }
)

const { t } = useI18n()
const userInput = ref("")

const botChat = inject(BotChatContextKey)
const isSending = computed(() => botChat?.isSending.value ?? false)
const canSend = computed(() => botChat?.canSend.value ?? false)
const canEditActive = computed(() => botChat?.canEditActive.value ?? true)
const isActiveArchived = computed(
  () => botChat?.isActiveArchived.value ?? false
)
const isReadOnly = computed(
  () => !!botChat?.sessionId.value && !canEditActive.value
)

// Mode selector — the dropdown in the composer toolbar. We bind to
// `botChat.mode` directly so the side panel and composer stay in sync,
// and so the next `sendMessage` automatically picks up the new mode.
// Options live in `useBotChat` so labels and descriptions are shared
// with the side-panel explainer (single source of truth).
const modeOptions = BOT_CHAT_MODE_OPTIONS
const mode = computed<BotChatMode>(() => botChat?.mode.value ?? "auto")
const onModeChange = (next: unknown) => {
  if (!botChat) return
  if (typeof next !== "string") return
  if (!modeOptions.some((o) => o.value === next)) return
  botChat.mode.value = next as BotChatMode
}

const modeLabel = (value: BotChatMode): string => {
  // Map mode → i18n key. Keeping this explicit (rather than `t(\`ai.${value}\`)`)
  // so the i18n-extractor toolchain can statically discover the keys.
  if (value === "auto") return t("ai.auto")
  if (value === "agent") return t("ai.agent")
  return t("ai.manual")
}

const inputPlaceholder = computed(() => {
  if (isActiveArchived.value)
    return "This chat is archived. Restore it to continue."
  if (isReadOnly.value) return "This chat is read-only"
  return props.placeholder ?? t("ai.placeholder")
})

const isDisabled = computed(
  () => userInput.value.trim().length === 0 || !canSend.value
)

const handleSend = async () => {
  if (isDisabled.value || !botChat) return
  const text = userInput.value
  userInput.value = ""
  await botChat.sendMessage(text)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <InputGroup class="bg-secondary">
    <InputGroupTextarea
      v-model="userInput"
      :placeholder="inputPlaceholder"
      :disabled="isSending || isReadOnly"
      @keydown="handleKeydown"
    />
    <InputGroupAddon align="block-end">
      <InputGroupButton variant="outline" size="icon-xs">
        <IconPlus />
      </InputGroupButton>
      <Select :model-value="mode" @update:model-value="onModeChange">
        <InputGroupButton variant="ghost" as-child>
          <SelectTrigger>
            <SelectValue :placeholder="t('ai.mode')" />
          </SelectTrigger>
        </InputGroupButton>
        <SelectContent>
          <SelectGroup>
            <SelectItem
              v-for="option in modeOptions"
              :key="option.value"
              :value="option.value"
            >
              <div class="flex flex-col gap-0.5">
                <span class="text-sm font-medium">
                  {{ modeLabel(option.value) }}
                </span>
                <span class="text-muted-foreground text-xs">
                  {{ option.shortDescription }}
                </span>
              </div>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <InputGroupText class="ml-auto text-xs">
        {{ usageLabel }}
      </InputGroupText>
      <Separator orientation="vertical" class="my-2" />
      <InputGroupButton
        variant="default"
        size="icon-xs"
        :disabled="isDisabled"
        @click="handleSend"
      >
        <IconArrowUp />
        <span class="sr-only">{{ t("actions.send") }}</span>
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>

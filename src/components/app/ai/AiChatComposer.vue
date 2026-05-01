<script lang="ts" setup>
import { BotChatContextKey } from "@/composables/useBotChat"
import { IconArrowUp, IconPlus } from "@/data/icons"
import { inject } from "vue"

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
      <Select>
        <InputGroupButton variant="ghost" as-child>
          <SelectTrigger>
            <SelectValue :placeholder="t('ai.mode')" />
          </SelectTrigger>
        </InputGroupButton>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="auto">{{ t("ai.auto") }}</SelectItem>
            <SelectItem value="agent">{{ t("ai.agent") }}</SelectItem>
            <SelectItem value="manual">{{ t("ai.manual") }}</SelectItem>
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

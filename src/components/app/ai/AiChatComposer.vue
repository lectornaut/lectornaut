<script lang="ts" setup>
import {
  BotChatContextKey,
  BOT_CHAT_MODE_OPTIONS,
  type BotChatMode,
} from "@/composables/useBotChat"
import { BOT_TOOL_CATALOG, type BotToolDescriptor } from "@/data/botTools"
import { IconAiFill, IconArrowUp, IconPlus } from "@/data/icons"
import { computed, inject, nextTick } from "vue"

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
const textareaRef = ref<{ $el?: HTMLTextAreaElement } | null>(null)

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

// ── Tool picker ──────────────────────────────────────────────────────────────
//
// Click the AI badge on top of the composer to expand a list of tools the
// bot can call. Picking one inserts that tool's example prompt into the
// textarea at the current caret (or appends to the end if the textarea
// hasn't been focused). The picker auto-collapses after a pick. Tool
// dispatch on the model side is driven by natural-language intent, not by
// any sigil syntax — that's why we insert a full sentence, not "/cmd".

const toolsOpen = ref(false)

const insertToolPrompt = (tool: BotToolDescriptor) => {
  const el = textareaRef.value?.$el
  if (el) {
    const start = el.selectionStart ?? userInput.value.length
    const end = el.selectionEnd ?? userInput.value.length
    const before = userInput.value.slice(0, start)
    const after = userInput.value.slice(end)
    userInput.value = `${before}${tool.example}${after}`
    const caret = before.length + tool.example.length
    nextTick(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  } else {
    userInput.value = `${userInput.value}${tool.example}`
  }
  toolsOpen.value = false
}
</script>

<template>
  <Collapsible v-model:open="toolsOpen" class="bg-secondary mx-2 mb-2 rounded">
    <TooltipProvider>
      <Tooltip>
        <CollapsibleTrigger as-child>
          <TooltipTrigger as-child>
            <Badge variant="ghost" class="m-1">
              <IconAiFill />
            </Badge>
          </TooltipTrigger>
        </CollapsibleTrigger>
        <TooltipContent>
          {{ toolsOpen ? "Hide tools" : "Show tools" }}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <CollapsibleContent>
      <ItemGroup class="p-1">
        <Item
          v-for="tool in BOT_TOOL_CATALOG"
          :key="tool.name"
          size="xs"
          class="hover:bg-muted"
          :disabled="isReadOnly"
          @click="insertToolPrompt(tool)"
        >
          <ItemMedia variant="icon">
            <Component :is="tool.icon" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{{ tool.label }}</ItemTitle>
            <ItemDescription>{{ tool.description }}</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    </CollapsibleContent>
    <InputGroup class="bg-background">
      <InputGroupTextarea
        ref="textareaRef"
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
  </Collapsible>
</template>

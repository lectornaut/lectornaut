<script lang="ts" setup>
import { IconArrowUp, IconPlus } from "@/data/icons"

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

const inputPlaceholder = computed(
  () => props.placeholder ?? t("ai.placeholder")
)
</script>

<template>
  <InputGroup>
    <InputGroupTextarea v-model="userInput" :placeholder="inputPlaceholder" />
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
      <Separator orientation="vertical" />
      <InputGroupButton
        variant="default"
        size="icon-xs"
        :disabled="userInput.trim().length === 0"
      >
        <IconArrowUp />
        <span class="sr-only">{{ t("actions.send") }}</span>
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>

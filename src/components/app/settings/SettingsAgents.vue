<script lang="ts" setup>
import { useAgentConfig } from "@/composables/useAgentConfig"
import { IconRotateCcw } from "@/data/icons"
import {
  botAgentBounds,
  botChatModes,
  botModelProviders,
  botModels,
  defaultBotModelProviderToggles,
  defaultBotAgentConfig,
} from "@/helpers/defaults"
import type { IBotAgentConfig, IBotModelProvider } from "@/types/domain"

const { t } = useI18n()

const cloneConfig = (source: IBotAgentConfig): IBotAgentConfig => ({
  ...source,
  providers: {
    ...defaultBotModelProviderToggles,
    ...source.providers,
  },
  promptSuffixes: { ...source.promptSuffixes },
  tools: { ...source.tools },
})

// i18n strings handed to the composable as a getter so it can toast
// without reaching into useI18n itself (the composable stays UI-
// framework agnostic). Passed as a function (not a snapshot) so locale
// changes flow into the composable's toasts and `cannotEditReason`
// tooltip without the form needing to remount.
const messagesGetter = () => ({
  permissionRequired: t("settings.agents.permissionRequired"),
  saveSuccess: t("settings.agents.saveSuccess"),
  saveError: t("settings.agents.saveError"),
  loadError: t("settings.agents.loadError"),
})

const { config, isLoading, isSaving, canEdit, cannotEditReason, save } =
  useAgentConfig(messagesGetter)

// Local draft — what the form binds to. Replaced wholesale whenever
// `config` flips (after a fetch / successful save) so the form snaps
// back to the canonical state. Sliders/textareas mutate this draft;
// nothing escapes to the server until the user clicks Save.
const draft = ref<IBotAgentConfig>(cloneConfig(config.value))

watch(
  config,
  (next) => {
    draft.value = cloneConfig(next)
  },
  { deep: true }
)

const isDirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(config.value)
)

const availableModels = computed(() =>
  botModels.filter((model) => draft.value.providers[model.provider])
)

// Group the flat model catalog by enabled provider for the picker.
// Iterating `botModelProviders` first preserves the canonical display
// order (Google → Anthropic → OpenAI) regardless of how `botModels` is
// sorted.
const modelsByProvider = computed(() =>
  botModelProviders
    .map((provider) => ({
      ...provider,
      models: draft.value.providers[provider.id]
        ? botModels.filter((model) => model.provider === provider.id)
        : [],
    }))
    .filter((group) => group.models.length > 0)
)

const enabledProviderCount = computed(
  () =>
    botModelProviders.filter((provider) => draft.value.providers[provider.id])
      .length
)

const isLastEnabledProvider = (providerId: IBotModelProvider) =>
  draft.value.providers[providerId] && enabledProviderCount.value <= 1

const getProviderModelCount = (providerId: IBotModelProvider) =>
  botModels.filter((model) => model.provider === providerId).length

const ensureSelectedModelIsAvailable = () => {
  if (availableModels.value.some((model) => model.id === draft.value.model)) {
    return
  }
  draft.value.model =
    availableModels.value[0]?.id ?? defaultBotAgentConfig.model
}

const setProviderEnabled = (
  providerId: IBotModelProvider,
  enabled: boolean
) => {
  if (!enabled && isLastEnabledProvider(providerId)) return

  draft.value.providers[providerId] = enabled
  ensureSelectedModelIsAvailable()
}

watch(
  () => draft.value.providers,
  () => {
    ensureSelectedModelIsAvailable()
  },
  { deep: true }
)

// Slider bindings — reka-ui's Slider expects an array model even for
// single-thumb usage. These computed wrappers translate between the
// scalar field on the draft and the [n] array the slider needs.
const sliderModel = (key: keyof IBotAgentConfig) =>
  computed<number[]>({
    get: () => [draft.value[key] as number],
    set: (value) => {
      ;(draft.value as Record<string, unknown>)[key] = value[0]
    },
  })

const temperatureModel = sliderModel("temperature")
const topPModel = sliderModel("topP")
const topKModel = sliderModel("topK")
const maxOutputTokensModel = sliderModel("maxOutputTokens")
const titleMaxLengthModel = sliderModel("titleMaxLength")
const previewMaxLengthModel = sliderModel("previewMaxLength")

const handleSave = async () => {
  // Server accepts a partial patch but we just send everything from
  // the draft — simpler, the server merges idempotently. The full
  // payload is small (<2 KB) so there's no real cost.
  await save({
    model: draft.value.model,
    providers: { ...draft.value.providers },
    temperature: draft.value.temperature,
    topP: draft.value.topP,
    topK: draft.value.topK,
    maxOutputTokens: draft.value.maxOutputTokens,
    defaultMode: draft.value.defaultMode,
    systemPromptBase: draft.value.systemPromptBase,
    promptSuffixes: { ...draft.value.promptSuffixes },
    tools: { ...draft.value.tools },
    titleMaxLength: draft.value.titleMaxLength,
    previewMaxLength: draft.value.previewMaxLength,
  })
}

const handleDiscard = () => {
  draft.value = cloneConfig(config.value)
}

const handleResetDefaults = () => {
  // Replace draft with bundled defaults — user still has to click
  // Save to commit, so this is a non-destructive preview.
  draft.value = cloneConfig(defaultBotAgentConfig)
}

const formatTemperature = (value: number) => value.toFixed(2)
const formatTopP = (value: number) => value.toFixed(2)
</script>

<template>
  <div class="flex grow flex-col justify-between">
    <div class="p-6">
      <div v-if="isLoading" class="flex justify-center py-8">
        <Spinner />
      </div>
      <FieldGroup v-else>
        <!-- Providers -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.providers.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.providers.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <TooltipProvider>
            <Field
              v-for="provider in botModelProviders"
              :key="provider.id"
              orientation="horizontal"
            >
              <FieldContent>
                <FieldLabel :for="`agent-provider-${provider.id}`">
                  {{ provider.name }}
                </FieldLabel>
                <FieldDescription>
                  {{
                    t(`settings.agents.providers.${provider.id}.description`, {
                      count: getProviderModelCount(provider.id),
                    })
                  }}
                </FieldDescription>
              </FieldContent>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="inline-block">
                    <Switch
                      :id="`agent-provider-${provider.id}`"
                      :model-value="draft.providers[provider.id]"
                      :disabled="!canEdit || isLastEnabledProvider(provider.id)"
                      @update:model-value="
                        (value) =>
                          setProviderEnabled(provider.id, Boolean(value))
                      "
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  v-if="!canEdit || isLastEnabledProvider(provider.id)"
                >
                  {{
                    !canEdit
                      ? cannotEditReason
                      : t("settings.agents.providers.minimumRequired")
                  }}
                </TooltipContent>
              </Tooltip>
            </Field>
          </TooltipProvider>
        </FieldSet>

        <FieldSeparator />

        <!-- Model -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-model">
                {{ t("settings.agents.model.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.model.description") }}
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <div class="w-72">
                    <Select
                      id="agent-model"
                      v-model="draft.model"
                      :disabled="!canEdit"
                    >
                      <SelectTrigger class="w-full">
                        <SelectValue
                          :placeholder="t('settings.agents.model.placeholder')"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <template
                          v-for="(group, groupIndex) in modelsByProvider"
                          :key="group.id"
                        >
                          <SelectGroup v-if="group.models.length > 0">
                            <SelectLabel>{{ group.name }}</SelectLabel>
                            <SelectItem
                              v-for="model in group.models"
                              :key="model.id"
                              :value="model.id"
                            >
                              <div class="flex flex-col items-start gap-0.5">
                                <span class="flex items-center gap-2">
                                  {{ model.name }}
                                  <Badge
                                    v-if="model.badge"
                                    variant="secondary"
                                    class="text-xs"
                                  >
                                    {{ model.badge }}
                                  </Badge>
                                </span>
                                <span class="text-muted-foreground text-xs">
                                  {{ model.description }}
                                </span>
                              </div>
                            </SelectItem>
                          </SelectGroup>
                          <SelectSeparator
                            v-if="
                              group.models.length > 0 &&
                              groupIndex < modelsByProvider.length - 1
                            "
                          />
                        </template>
                      </SelectContent>
                    </Select>
                  </div>
                </TooltipTrigger>
                <TooltipContent v-if="!canEdit">
                  {{ cannotEditReason }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-default-mode">
                {{ t("settings.agents.defaultMode.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.defaultMode.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="w-72">
              <Select
                id="agent-default-mode"
                v-model="draft.defaultMode"
                :disabled="!canEdit"
              >
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem
                      v-for="mode in botChatModes"
                      :key="mode.id"
                      :value="mode.id"
                    >
                      <div class="flex flex-col items-start gap-0.5">
                        <span>{{ mode.name }}</span>
                        <span class="text-muted-foreground text-xs">
                          {{ mode.description }}
                        </span>
                      </div>
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <!-- Generation parameters -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.generation.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.generation.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-temperature">
                {{ t("settings.agents.temperature.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.temperature.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex w-72 items-center gap-3">
              <Slider
                id="agent-temperature"
                v-model="temperatureModel"
                :min="botAgentBounds.temperature.min"
                :max="botAgentBounds.temperature.max"
                :step="botAgentBounds.temperature.step"
                :disabled="!canEdit"
              />
              <span
                class="text-muted-foreground w-12 text-right text-sm tabular-nums"
              >
                {{ formatTemperature(draft.temperature) }}
              </span>
            </div>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-top-p">
                {{ t("settings.agents.topP.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.topP.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex w-72 items-center gap-3">
              <Slider
                id="agent-top-p"
                v-model="topPModel"
                :min="botAgentBounds.topP.min"
                :max="botAgentBounds.topP.max"
                :step="botAgentBounds.topP.step"
                :disabled="!canEdit"
              />
              <span
                class="text-muted-foreground w-12 text-right text-sm tabular-nums"
              >
                {{ formatTopP(draft.topP) }}
              </span>
            </div>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-top-k">
                {{ t("settings.agents.topK.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.topK.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex w-72 items-center gap-3">
              <Slider
                id="agent-top-k"
                v-model="topKModel"
                :min="botAgentBounds.topK.min"
                :max="botAgentBounds.topK.max"
                :step="botAgentBounds.topK.step"
                :disabled="!canEdit"
              />
              <span
                class="text-muted-foreground w-12 text-right text-sm tabular-nums"
              >
                {{ draft.topK }}
              </span>
            </div>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-max-tokens">
                {{ t("settings.agents.maxOutputTokens.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.maxOutputTokens.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex w-72 items-center gap-3">
              <Slider
                id="agent-max-tokens"
                v-model="maxOutputTokensModel"
                :min="botAgentBounds.maxOutputTokens.min"
                :max="botAgentBounds.maxOutputTokens.max"
                :step="botAgentBounds.maxOutputTokens.step"
                :disabled="!canEdit"
              />
              <span
                class="text-muted-foreground w-16 text-right text-sm tabular-nums"
              >
                {{ draft.maxOutputTokens }}
              </span>
            </div>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <!-- System prompt -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.systemPrompt.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.systemPrompt.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel for="agent-system-prompt-base">
                {{ t("settings.agents.systemPromptBase.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.systemPromptBase.description") }}
              </FieldDescription>
            </FieldContent>
            <Textarea
              id="agent-system-prompt-base"
              v-model="draft.systemPromptBase"
              :placeholder="t('settings.agents.systemPromptBase.placeholder')"
              :maxlength="botAgentBounds.systemPromptBase.max"
              :disabled="!canEdit"
              rows="3"
            />
          </Field>

          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.promptSuffixes.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.promptSuffixes.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel for="agent-suffix-auto">
                {{ t("settings.agents.promptSuffixes.auto") }}
              </FieldLabel>
            </FieldContent>
            <Textarea
              id="agent-suffix-auto"
              v-model="draft.promptSuffixes.auto"
              :maxlength="botAgentBounds.promptSuffix.max"
              :disabled="!canEdit"
              rows="3"
            />
          </Field>

          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel for="agent-suffix-agent">
                {{ t("settings.agents.promptSuffixes.agent") }}
              </FieldLabel>
            </FieldContent>
            <Textarea
              id="agent-suffix-agent"
              v-model="draft.promptSuffixes.agent"
              :maxlength="botAgentBounds.promptSuffix.max"
              :disabled="!canEdit"
              rows="3"
            />
          </Field>

          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel for="agent-suffix-manual">
                {{ t("settings.agents.promptSuffixes.manual") }}
              </FieldLabel>
            </FieldContent>
            <Textarea
              id="agent-suffix-manual"
              v-model="draft.promptSuffixes.manual"
              :maxlength="botAgentBounds.promptSuffix.max"
              :disabled="!canEdit"
              rows="3"
            />
          </Field>
        </FieldSet>

        <FieldSeparator />

        <!-- Tools -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.tools.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.tools.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-tool-weather">
                {{ t("settings.agents.tools.getWeather.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.tools.getWeather.description") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-tool-weather"
              v-model="draft.tools.getWeather"
              :disabled="!canEdit"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-tool-dice">
                {{ t("settings.agents.tools.rollDice.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.tools.rollDice.description") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-tool-dice"
              v-model="draft.tools.rollDice"
              :disabled="!canEdit"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-tool-ask">
                {{ t("settings.agents.tools.askQuestion.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.tools.askQuestion.description") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-tool-ask"
              v-model="draft.tools.askQuestion"
              :disabled="!canEdit"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-tool-search-nodes">
                {{ t("settings.agents.tools.searchWorkspaceNodes.label") }}
              </FieldLabel>
              <FieldDescription>
                {{
                  t("settings.agents.tools.searchWorkspaceNodes.description")
                }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-tool-search-nodes"
              v-model="draft.tools.searchWorkspaceNodes"
              :disabled="!canEdit"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-tool-summarize-node">
                {{ t("settings.agents.tools.summarizeNode.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.tools.summarizeNode.description") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-tool-summarize-node"
              v-model="draft.tools.summarizeNode"
              :disabled="!canEdit"
            />
          </Field>
        </FieldSet>

        <FieldSeparator />

        <!-- Display limits -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.limits.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.limits.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-title-max">
                {{ t("settings.agents.titleMaxLength.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.titleMaxLength.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex w-72 items-center gap-3">
              <Slider
                id="agent-title-max"
                v-model="titleMaxLengthModel"
                :min="botAgentBounds.titleMaxLength.min"
                :max="botAgentBounds.titleMaxLength.max"
                :step="botAgentBounds.titleMaxLength.step"
                :disabled="!canEdit"
              />
              <span
                class="text-muted-foreground w-12 text-right text-sm tabular-nums"
              >
                {{ draft.titleMaxLength }}
              </span>
            </div>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-preview-max">
                {{ t("settings.agents.previewMaxLength.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.previewMaxLength.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex w-72 items-center gap-3">
              <Slider
                id="agent-preview-max"
                v-model="previewMaxLengthModel"
                :min="botAgentBounds.previewMaxLength.min"
                :max="botAgentBounds.previewMaxLength.max"
                :step="botAgentBounds.previewMaxLength.step"
                :disabled="!canEdit"
              />
              <span
                class="text-muted-foreground w-12 text-right text-sm tabular-nums"
              >
                {{ draft.previewMaxLength }}
              </span>
            </div>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <!-- Reset to defaults -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.agents.resetDefaults") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.resetDefaultsDescription") }}
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="outline"
                    :disabled="!canEdit || isSaving"
                    @click="handleResetDefaults"
                  >
                    <IconRotateCcw />
                    {{ t("settings.agents.resetDefaults") }}
                  </Button>
                </TooltipTrigger>
                <TooltipContent v-if="!canEdit">
                  {{ cannotEditReason }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Field>
        </FieldSet>
      </FieldGroup>
    </div>
    <DialogFooter
      v-if="!isLoading && isDirty && canEdit"
      class="bg-background/50 sticky bottom-3 z-10 m-3 flex items-center gap-2 border p-2 backdrop-blur-lg"
    >
      <p class="text-muted-foreground mr-auto ml-2 text-xs">
        {{ t("settings.unsavedChanges") }}
      </p>
      <Button variant="secondary" :disabled="isSaving" @click="handleDiscard">
        {{ t("common.discard") }}
      </Button>
      <Button :disabled="isSaving" @click="handleSave">
        <Spinner v-if="isSaving" />
        {{ t("common.save") }}
      </Button>
    </DialogFooter>
  </div>
</template>

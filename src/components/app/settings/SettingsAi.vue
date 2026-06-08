<script lang="ts" setup>
import { useCanViewTeamSettings } from "@/composables/useCanViewTeamSettings"
import {
  cloneAgentConfig,
  pickAiAgentConfig,
  useAgentConfig,
} from "@/composables/useAgentConfig"
import { IconRotateCcw, IconSettings } from "@/data/icons"
import {
  botAgentBounds,
  botChatModes,
  botModelProviders,
  botModels,
  defaultBotAgentConfig,
} from "@/helpers/defaults"
import type {
  IBotAgentConfig,
  IBotAgentModel,
  IBotModelProvider,
} from "@/types/domain"

/**
 * SettingsAi — high-level AI configuration for the team's bot.
 *
 * Owns the AI side of the team's `agentConfig`:
 *   - Providers (Google / Anthropic / OpenAI) + per-model toggles
 *   - Default model + default chat mode
 *   - Generation parameters (temperature, topP, topK, maxOutputTokens)
 *   - System prompt base + per-mode suffixes
 *   - Display limits (title + preview max length)
 *   - Restore-defaults action (scoped to AI fields only)
 *
 * Tools toggles + custom agents live in the sibling `SettingsAgents`
 * page. Both pages back the same Pinia-backed `useAgentConfig` store
 * (single source of truth); each keeps its own local `draft` cloned
 * from the canonical config and only mutates / persists its owned
 * fields. The save handler intentionally omits `tools` so a parallel
 * edit on the Agents tab can't get clobbered when this page saves.
 *
 * The deep watcher that re-seeds the draft from `config` is
 * dirty-aware: it skips re-cloning when this page has unsaved
 * changes, which preserves an in-flight edit if the Agents tab
 * happens to save in the same window.
 */

const { t } = useI18n()

const { canViewTeamSettings } = useCanViewTeamSettings()

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

const draft = ref<IBotAgentConfig>(cloneAgentConfig(config.value))

const isDirty = computed(
  () =>
    JSON.stringify(pickAiAgentConfig(draft.value)) !==
    JSON.stringify(pickAiAgentConfig(config.value))
)

// Dirty-aware re-clone. When this page is clean, snap the draft to the
// canonical config so external updates (e.g. the Agents tab just
// saved a tools change which the server returns as the full config)
// propagate. When this page is dirty, leave the user's in-flight edit
// alone — the Agents tab's save doesn't conflict with AI fields, and
// silently overwriting them would lose work.
watch(
  config,
  (next) => {
    if (!isDirty.value) draft.value = cloneAgentConfig(next)
  },
  { deep: true }
)

// A model is *enabled* when its per-model toggle is on. Missing keys are
// treated as `true` so a brand-new model id (catalog ahead of saved doc)
// starts available without requiring an explicit save.
const isModelEnabled = (modelId: IBotAgentModel): boolean =>
  draft.value.models[modelId] !== false

// A model is *available* when both its provider AND its per-model
// toggle are on — the picker only ever surfaces models matching both.
const availableModels = computed(() =>
  botModels.filter(
    (model) => draft.value.providers[model.provider] && isModelEnabled(model.id)
  )
)

// The model/mode `<SelectItem>`s render a rich two-line layout (name +
// description). Without overriding the `<SelectValue>` slot, reka-ui
// clones that same multi-line content into the trigger and the field
// grows two rows tall. These computeds let the trigger render *just*
// the name (the first line) while the dropdown keeps its richer layout.
const selectedModel = computed(
  () => botModels.find((model) => model.id === draft.value.model) ?? null
)
const selectedMode = computed(
  () => botChatModes.find((mode) => mode.id === draft.value.defaultMode) ?? null
)

// Group the flat model catalog by enabled provider for the picker.
// Iterating `botModelProviders` first preserves the canonical display
// order (Google → Anthropic → OpenAI) regardless of how `botModels` is
// sorted. Per-provider lists also respect the per-model toggles so a
// fully-disabled provider (zero enabled models) drops out of the picker
// even when its provider switch is on.
const modelsByProvider = computed(() =>
  botModelProviders
    .map((provider) => ({
      ...provider,
      models: draft.value.providers[provider.id]
        ? botModels.filter(
            (model) =>
              model.provider === provider.id && isModelEnabled(model.id)
          )
        : [],
    }))
    .filter((group) => group.models.length > 0)
)

const enabledProviderCount = computed(
  () =>
    botModelProviders.filter((provider) => draft.value.providers[provider.id])
      .length
)

const getProviderModelCount = (providerId: IBotModelProvider) =>
  botModels.filter((model) => model.provider === providerId).length

// Per-provider catalog used to populate each provider's "Configure
// models" dropdown. Independent of the provider's switch state so the
// menu still lists every model — the disabled state of individual
// checkboxes communicates the constraints instead.
const getProviderModels = (providerId: IBotModelProvider) =>
  botModels.filter((model) => model.provider === providerId)

// Count of enabled models within a provider — drives the "X of Y
// enabled" caption shown under the provider's label.
const getProviderEnabledModelCount = (providerId: IBotModelProvider) =>
  getProviderModels(providerId).filter((model) => isModelEnabled(model.id))
    .length

// Lookup map: model id → its provider id. Used by the per-model guard
// to answer "is this model *currently* contributing to the available
// pool?" in O(1) instead of re-scanning `botModels`.
const modelProviderById = computed<Record<IBotAgentModel, IBotModelProvider>>(
  () =>
    botModels.reduce(
      (acc, model) => {
        acc[model.id] = model.provider
        return acc
      },
      {} as Record<IBotAgentModel, IBotModelProvider>
    )
)

// Count of *available* models — those where BOTH the provider toggle
// and the per-model toggle are on. Mirrors the server's
// `hasEnabledModel(providers, models)` check exactly; both guards below
// gate on this same count so the form can never reach a state the
// server would reject on save.
const availableModelCount = computed(() => availableModels.value.length)

const isLastEnabledProvider = (providerId: IBotModelProvider): boolean => {
  if (!draft.value.providers[providerId]) return false
  if (enabledProviderCount.value <= 1) return true
  const survivors = botModels.filter(
    (model) =>
      model.provider !== providerId &&
      draft.value.providers[model.provider] &&
      isModelEnabled(model.id)
  )
  return survivors.length === 0
}

const isLastEnabledModel = (modelId: IBotAgentModel): boolean => {
  if (!isModelEnabled(modelId)) return false
  const providerId = modelProviderById.value[modelId]
  if (!providerId || !draft.value.providers[providerId]) return false
  return availableModelCount.value <= 1
}

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

const setModelEnabled = (modelId: IBotAgentModel, enabled: boolean) => {
  if (!enabled && isLastEnabledModel(modelId)) return
  draft.value.models[modelId] = enabled
  ensureSelectedModelIsAvailable()
}

const providerDisableReason = computed<string>(() => {
  if (!canEdit.value) return cannotEditReason.value ?? ""
  if (enabledProviderCount.value <= 1) {
    return t("settings.agents.providers.minimumRequired")
  }
  return t("settings.agents.providers.modelsMinimum")
})

watch(
  () => draft.value.providers,
  () => {
    ensureSelectedModelIsAvailable()
  },
  { deep: true }
)

watch(
  () => draft.value.models,
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

/**
 * Save AI-side fields only. Tools are deliberately excluded — that
 * field is owned by `SettingsAgents` and we don't want to clobber it
 * from this page (a parallel edit on the Agents tab would lose its
 * pending changes if we sent the tools field along here). The payload
 * shape is derived from `AI_CONFIG_KEYS` so adding a new AI field is
 * a one-touch edit on the composable, not a three-touch edit here.
 */
const handleSave = async () => {
  await save(pickAiAgentConfig(draft.value))
}

const handleDiscard = () => {
  draft.value = cloneAgentConfig(config.value)
}

/**
 * Restore AI fields to bundled defaults. We replace the WHOLE draft
 * with the defaults clone for code simplicity — but only the AI
 * fields ever ship on the next save (`handleSave` uses
 * `pickAiAgentConfig`), so tools server-side stay untouched even if
 * this button is hit by mistake. The Tools section in the sibling
 * Agents page keeps its own reset path (or admins toggle individually).
 */
const handleResetDefaults = () => {
  draft.value = cloneAgentConfig(defaultBotAgentConfig)
}

const formatTemperature = (value: number) => value.toFixed(2)
const formatTopP = (value: number) => value.toFixed(2)

// Keep the per-provider model dropdown open while the user toggles
// multiple checkboxes. `DropdownMenuCheckboxItem` auto-closes the
// menu on select; preventing the default `select` event keeps it open
// so admins can adjust several models in a row without re-opening
// the trigger between each click.
const keepMenuOpen = (event: Event) => {
  event.preventDefault()
}
</script>

<template>
  <div v-if="canViewTeamSettings" class="flex grow flex-col justify-between">
    <div class="p-6">
      <LoadingState v-if="isLoading" />
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
                  ·
                  {{
                    t("settings.agents.providers.modelsEnabledCount", {
                      enabled: getProviderEnabledModelCount(provider.id),
                      total: getProviderModelCount(provider.id),
                    })
                  }}
                </FieldDescription>
              </FieldContent>

              <Tooltip>
                <DropdownMenu>
                  <TooltipTrigger as-child>
                    <DropdownMenuTrigger as-child>
                      <InputGroupButton
                        variant="ghost"
                        size="icon-xs"
                        :disabled="!canEdit || !draft.providers[provider.id]"
                      >
                        <IconSettings />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("settings.agents.providers.configureModels") }}
                  </TooltipContent>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      {{ t("settings.agents.providers.modelsLabel") }} ·
                      {{ provider.name }}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      v-for="model in getProviderModels(provider.id)"
                      :key="model.id"
                      :model-value="isModelEnabled(model.id)"
                      :disabled="
                        !canEdit ||
                        (isModelEnabled(model.id) &&
                          isLastEnabledModel(model.id))
                      "
                      @update:model-value="
                        (value) => setModelEnabled(model.id, Boolean(value))
                      "
                      @select="keepMenuOpen"
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
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Tooltip>

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
                  {{ providerDisableReason }}
                </TooltipContent>
              </Tooltip>
            </Field>
          </TooltipProvider>
        </FieldSet>

        <FieldSeparator />

        <!-- Model + Default Mode -->
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
            <div>
              <Select
                id="agent-model"
                v-model="draft.model"
                :disabled="!canEdit"
              >
                <SelectTrigger>
                  <SelectValue
                    :placeholder="t('settings.agents.model.placeholder')"
                  >
                    <span v-if="selectedModel" class="flex items-center gap-2">
                      {{ selectedModel.name }}
                      <Badge
                        v-if="selectedModel.badge"
                        variant="secondary"
                        class="text-xs"
                      >
                        {{ selectedModel.badge }}
                      </Badge>
                    </span>
                  </SelectValue>
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
            <div>
              <Select
                id="agent-default-mode"
                v-model="draft.defaultMode"
                :disabled="!canEdit"
              >
                <SelectTrigger>
                  <SelectValue>
                    <span v-if="selectedMode">{{ selectedMode.name }}</span>
                  </SelectValue>
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

        <!-- Reasoning -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-thinking">
                {{ t("settings.agents.thinking.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.thinking.description") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-thinking"
              :model-value="draft.thinking"
              :disabled="!canEdit"
              @update:model-value="(value) => (draft.thinking = Boolean(value))"
            />
          </Field>
        </FieldSet>

        <FieldSeparator />

        <!-- Workspace grounding -->
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="agent-auto-context">
                {{ t("settings.agents.autoContext.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.agents.autoContext.description") }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-auto-context"
              :model-value="draft.autoContext"
              :disabled="!canEdit"
              @update:model-value="
                (value) => (draft.autoContext = Boolean(value))
              "
            />
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
                class="text-muted-foreground w-16 text-right text-sm tabular-nums"
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
                class="text-muted-foreground w-16 text-right text-sm tabular-nums"
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
                class="text-muted-foreground w-16 text-right text-sm tabular-nums"
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
                class="text-muted-foreground w-16 text-right text-sm tabular-nums"
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
                class="text-muted-foreground w-16 text-right text-sm tabular-nums"
              >
                {{ draft.previewMaxLength }}
              </span>
            </div>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <!-- Restore defaults (AI-scoped) -->
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
            <Button
              variant="outline"
              :disabled="!canEdit || isSaving"
              @click="handleResetDefaults"
            >
              <IconRotateCcw />
              {{ t("settings.agents.resetDefaults") }}
            </Button>
          </Field>
        </FieldSet>
      </FieldGroup>
    </div>
    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="translate-y-2 opacity-0"
      leave-to-class="translate-y-2 opacity-0"
    >
      <SettingsUnsavedBar
        v-if="!isLoading && isDirty && canEdit"
        :saving="isSaving"
        @discard="handleDiscard"
        @save="handleSave"
      />
    </Transition>
  </div>
  <SettingsRestricted v-else />
</template>

<script lang="ts" setup>
import type {
  AccentId,
  BaseId,
  FontId,
  LanguageId,
  SizeId,
} from "@/helpers/defaults"
import {
  accents,
  bases,
  defaultCustomAccentColor,
  defaultCustomBaseColor,
  fonts,
  languages,
  sizes,
  themes,
} from "@/helpers/defaults"
import { useSettingsStore } from "@/stores/settingsStore"
import type { ThemeMode } from "@/types/settings"
import { normalizeHexColor } from "@/utils/theme/customTheme"
import { storeToRefs } from "pinia"

const { t } = useI18n()

const settingsStore = useSettingsStore()
const { themeSettings } = storeToRefs(settingsStore)

const selectedTheme = computed({
  get: () => themeSettings.value.mode,
  set: (value: ThemeMode) => {
    themeSettings.value.mode = value
  },
})

const selectedBase = computed({
  get: () => themeSettings.value.base,
  set: (value: BaseId) => {
    themeSettings.value.base = value
  },
})

const selectedAccent = computed({
  get: () => themeSettings.value.accent,
  set: (value: AccentId) => {
    themeSettings.value.accent = value
  },
})

const selectedLanguage = computed({
  get: () => themeSettings.value.language,
  set: (value: LanguageId) => {
    themeSettings.value.language = value
  },
})

const selectedCustomBaseColor = computed({
  get: () => themeSettings.value.customBaseColor,
  set: (value: string) => {
    themeSettings.value.customBaseColor = normalizeHexColor(
      value,
      defaultCustomBaseColor
    )
  },
})

const selectedCustomAccentColor = computed({
  get: () => themeSettings.value.customAccentColor,
  set: (value: string) => {
    themeSettings.value.customAccentColor = normalizeHexColor(
      value,
      defaultCustomAccentColor
    )
  },
})

const selectedFont = computed({
  get: () => themeSettings.value.font,
  set: (value: FontId) => {
    themeSettings.value.font = value
  },
})

const selectedSize = computed({
  get: () => themeSettings.value.size,
  set: (value: SizeId) => {
    themeSettings.value.size = value
  },
})

const groupedBaseOptions = bases.filter(
  (color) => color.id === "accent" || color.id === "custom"
)
const baseOptions = bases.filter(
  (color) => color.id !== "accent" && color.id !== "custom"
)

const groupedAccentOptions = accents.filter(
  (color) => color.id === "base" || color.id === "custom"
)
const accentOptions = accents.filter(
  (color) => color.id !== "base" && color.id !== "custom"
)

const isAccentBaseSelected = computed(() => selectedAccent.value === "base")
const isBaseAccentSelected = computed(() => selectedBase.value === "accent")

const getOptionClass = (optionId: BaseId | AccentId, fallbackClass: string) =>
  optionId === "custom" ? "" : fallbackClass

const getBaseOptionStyle = (optionId: BaseId) =>
  optionId === "custom"
    ? { backgroundColor: selectedCustomBaseColor.value }
    : undefined

const getAccentOptionStyle = (optionId: AccentId) =>
  optionId === "custom"
    ? { backgroundColor: selectedCustomAccentColor.value }
    : undefined
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.appearance.customization.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.appearance.customization.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="theme">{{
              t("settings.preferences.theme.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.theme.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="theme" v-model="selectedTheme">
            <SelectTrigger>
              <SelectValue
                :placeholder="t('settings.preferences.theme.placeholder')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="mode in themes"
                  :key="mode.id"
                  :value="mode.id"
                >
                  <Component :is="mode.icon" />
                  {{ mode.name }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="base">
              {{ t("settings.preferences.base.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.base.description") }}
            </FieldDescription>
          </FieldContent>
          <div class="flex items-center gap-2">
            <input
              v-if="selectedBase === 'custom'"
              id="custom-base-color"
              v-model="selectedCustomBaseColor"
              type="color"
              class="bg-background appearance-noneborder aspect-square size-9 cursor-pointer p-2.75 shadow-xs"
            />
            <Select id="base" v-model="selectedBase">
              <SelectTrigger>
                <SelectValue
                  :placeholder="t('settings.preferences.base.placeholder')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem
                    v-for="color in baseOptions"
                    :key="color.id"
                    :value="color.id"
                  >
                    <span
                      class="size-3 rounded-xs"
                      :class="getOptionClass(color.id, color.style)"
                      :style="getBaseOptionStyle(color.id)"
                    />
                    {{ color.name }}
                  </SelectItem>
                </SelectGroup>
                <SelectSeparator
                  v-if="groupedBaseOptions.length > 0 && baseOptions.length > 0"
                />
                <SelectGroup v-if="groupedBaseOptions.length > 0">
                  <SelectItem
                    v-for="color in groupedBaseOptions"
                    :key="color.id"
                    :value="color.id"
                    :disabled="color.id === 'accent' && isAccentBaseSelected"
                  >
                    <span
                      class="size-3 rounded-xs"
                      :class="getOptionClass(color.id, color.style)"
                      :style="getBaseOptionStyle(color.id)"
                    />
                    {{ color.name }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="accent">{{
              t("settings.preferences.accent.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.accent.description") }}
            </FieldDescription>
          </FieldContent>
          <div class="flex items-center gap-2">
            <input
              v-if="selectedAccent === 'custom'"
              id="custom-accent-color"
              v-model="selectedCustomAccentColor"
              type="color"
              class="bg-background appearance-noneborder aspect-square size-9 cursor-pointer p-2.75 shadow-xs"
            />
            <Select id="accent" v-model="selectedAccent">
              <SelectTrigger>
                <SelectValue
                  :placeholder="t('settings.preferences.accent.placeholder')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup v-if="groupedAccentOptions.length > 0">
                  <SelectItem
                    v-for="color in groupedAccentOptions"
                    :key="color.id"
                    :value="color.id"
                    :disabled="color.id === 'base' && isBaseAccentSelected"
                  >
                    <span
                      class="size-3 rounded-xs"
                      :class="getOptionClass(color.id, color.style)"
                      :style="getAccentOptionStyle(color.id)"
                    />
                    {{ color.name }}
                  </SelectItem>
                </SelectGroup>
                <SelectSeparator
                  v-if="
                    groupedAccentOptions.length > 0 && accentOptions.length > 0
                  "
                />
                <SelectGroup>
                  <SelectItem
                    v-for="color in accentOptions"
                    :key="color.id"
                    :value="color.id"
                  >
                    <span
                      class="size-3 rounded-xs"
                      :class="getOptionClass(color.id, color.style)"
                      :style="getAccentOptionStyle(color.id)"
                    />
                    {{ color.name }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="language">{{
              t("settings.preferences.language.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.language.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="language" v-model="selectedLanguage">
            <SelectTrigger>
              <SelectValue
                :placeholder="t('settings.preferences.language.placeholder')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="language in languages"
                  :key="language.id"
                  :value="language.id"
                >
                  <Component :is="language.icon" />
                  {{ language.name }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="font">{{
              t("settings.preferences.font.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.font.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="font" v-model="selectedFont">
            <SelectTrigger>
              <SelectValue
                :placeholder="t('settings.preferences.font.placeholder')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="family in fonts"
                  :key="family.id"
                  :value="family.id"
                >
                  <Component :is="family.icon" />
                  <span :class="family.style">
                    {{ family.name }}
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="text-size">{{
              t("settings.preferences.text.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.text.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="text-size" v-model="selectedSize">
            <SelectTrigger>
              <SelectValue
                :placeholder="t('settings.preferences.text.placeholder')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="scale in sizes"
                  :key="scale.id"
                  :value="scale.id"
                >
                  <Component :is="scale.icon" />
                  <span :class="scale.style">
                    {{ scale.name }}
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>

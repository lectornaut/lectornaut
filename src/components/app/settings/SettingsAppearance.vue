<script lang="ts" setup>
import { IconCircleDot } from "@/data/icons"
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
  fonts,
  languages,
  sizes,
  themes,
} from "@/helpers/defaults"
import { useSettingsStore } from "@/stores/settingsStore"
import type { ThemeMode } from "@/types/settings"
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

const isAccentBaseSelected = computed(() => selectedAccent.value === "base")
const isBaseAccentSelected = computed(() => selectedBase.value === "accent")
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
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
            <SelectContent align="end">
              <SelectItem
                v-for="mode in themes"
                :key="mode.id"
                :value="mode.id"
              >
                <Component :is="mode.icon" />
                {{ mode.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="base">Base</FieldLabel>
            <FieldDescription>
              Select the base color for the application.
            </FieldDescription>
          </FieldContent>
          <Select id="base" v-model="selectedBase">
            <SelectTrigger>
              <SelectValue placeholder="Select a base color" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem
                v-for="color in bases"
                :key="color.id"
                :value="color.id"
                :disabled="isAccentBaseSelected && color.id === 'accent'"
              >
                <IconCircleDot :class="color.style" />
                {{ color.name }}
              </SelectItem>
            </SelectContent>
          </Select>
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
          <Select id="accent" v-model="selectedAccent">
            <SelectTrigger>
              <SelectValue
                :placeholder="t('settings.preferences.accent.placeholder')"
              />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem
                v-for="color in accents"
                :key="color.id"
                :value="color.id"
                :disabled="isBaseAccentSelected && color.id === 'base'"
              >
                <IconCircleDot :class="color.style" />
                {{ color.name }}
              </SelectItem>
            </SelectContent>
          </Select>
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
            <SelectContent align="end">
              <SelectItem
                v-for="language in languages"
                :key="language.id"
                :value="language.id"
              >
                <Component :is="language.icon" />
                {{ language.name }}
              </SelectItem>
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
            <SelectContent align="end">
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
          <Select id="text-size" v-model="selectedSize" class="w-40">
            <SelectTrigger>
              <SelectValue
                :placeholder="t('settings.preferences.text.placeholder')"
              />
            </SelectTrigger>
            <SelectContent align="end">
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
            </SelectContent>
          </Select>
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>

<script lang="ts" setup>
import { IconCircleDot } from "@/data/icons"
import { accents, bases, languages, themes } from "@/helpers/defaults"
import { accent, base, store } from "@/modules/theme"

const { locale, t } = useI18n()

const isAccentBaseSelected = computed(() => accent.value === "base")
const isBaseAccentSelected = computed(() => base.value === "accent")
</script>

<template>
  <div class="p-4">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="onboarding-theme">{{
              t("settings.preferences.theme.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.theme.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="onboarding-theme" v-model="store">
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
            <FieldLabel for="onboarding-base">Base</FieldLabel>
            <FieldDescription>
              Select the base color for the application.
            </FieldDescription>
          </FieldContent>
          <Select id="onboarding-base" v-model="base">
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
            <FieldLabel for="onboarding-accent">{{
              t("settings.preferences.accent.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.accent.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="onboarding-accent" v-model="accent">
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
            <FieldLabel for="onboarding-language">{{
              t("settings.preferences.language.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.language.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="onboarding-language" v-model="locale">
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
      </FieldSet>
    </FieldGroup>
  </div>
</template>

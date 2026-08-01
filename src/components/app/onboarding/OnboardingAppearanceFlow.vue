<script lang="ts" setup>
import type { AccentId, BaseId, ColorSwatch } from "@/helpers/defaults"
import { accents, bases, languages, themes } from "@/helpers/defaults"
import {
  accent,
  base,
  customAccentColor,
  customBaseColor,
  store,
} from "@/modules/theme"

const { locale, t } = useI18n()

const isAccentBaseSelected = computed(() => accent.value === "base")
const isBaseAccentSelected = computed(() => base.value === "accent")

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

// Paint each swatch dot from the option's CSS-var color; `custom` uses the
// live picked color. Inline style (not a `bg-*` class) so dynamically-listed
// palette colors don't depend on Tailwind's static class scanning.
const baseSwatchStyle = (option: ColorSwatch<BaseId>) => ({
  backgroundColor:
    option.id === "custom" ? customBaseColor.value : option.swatch,
})

const accentSwatchStyle = (option: ColorSwatch<AccentId>) => ({
  backgroundColor:
    option.id === "custom" ? customAccentColor.value : option.swatch,
})
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
            <FieldLabel for="onboarding-base">{{
              t("pages.welcome.onboarding.appearanceFlow.baseLabel")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("pages.welcome.onboarding.appearanceFlow.baseDescription") }}
            </FieldDescription>
          </FieldContent>
          <div class="flex items-center gap-2">
            <input
              v-if="base === 'custom'"
              id="onboarding-custom-base-color"
              v-model="customBaseColor"
              type="color"
              class="bg-background aspect-square size-9 cursor-pointer appearance-none rounded-4xl border p-2.75"
            />
            <Select id="onboarding-base" v-model="base">
              <SelectTrigger>
                <SelectValue
                  :placeholder="
                    t('pages.welcome.onboarding.appearanceFlow.basePlaceholder')
                  "
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem
                    v-for="color in baseOptions"
                    :key="color.id"
                    :value="color.id"
                  >
                    <span class="size-3" :style="baseSwatchStyle(color)" />
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
                    <span class="size-3" :style="baseSwatchStyle(color)" />
                    {{ color.name }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
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
          <div class="flex items-center gap-2">
            <input
              v-if="accent === 'custom'"
              id="onboarding-custom-accent-color"
              v-model="customAccentColor"
              type="color"
              class="bg-background aspect-square size-9 cursor-pointer appearance-none rounded-4xl border p-2.75"
            />
            <Select id="onboarding-accent" v-model="accent">
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
                    <span class="size-3" :style="accentSwatchStyle(color)" />
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
                    <span class="size-3" :style="accentSwatchStyle(color)" />
                    {{ color.name }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
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
      </FieldSet>
    </FieldGroup>
  </div>
</template>

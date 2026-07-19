<script lang="ts" setup>
import type {
  AccentId,
  BaseId,
  ColorSwatch,
  EditorFontSizeId,
  EditorThemeId,
  FontId,
  LanguageId,
  SizeId,
} from "@/helpers/defaults"
import {
  accents,
  bases,
  defaultCustomAccentColor,
  defaultCustomBaseColor,
  editorFontSizes,
  editorThemes,
  fonts,
  languages,
  sizes,
  themes,
} from "@/helpers/defaults"
import { useThemeStore } from "@/stores/themeStore"
import type { ThemeMode } from "@/types/settings"
import { normalizeHexColor } from "@/utils/theme/customTheme"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()

const themeStore = useThemeStore()
const { themeSettings } = storeToRefs(themeStore)

const selectedTheme = computed({
  get: () => themeSettings.value.mode,
  set: (value: ThemeMode) => {
    themeSettings.value.mode = value
  },
})

const selectedEditorTheme = computed({
  get: () => themeSettings.value.editorTheme,
  set: (value: EditorThemeId) => {
    themeSettings.value.editorTheme = value
  },
})

const selectedEditorFontSize = computed({
  get: () => themeSettings.value.editorFontSize,
  set: (value: EditorFontSizeId) => {
    themeSettings.value.editorFontSize = value
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

const selectedTranslucentSidebar = computed({
  get: () => themeSettings.value.translucentSidebar,
  set: (value: boolean) => {
    themeSettings.value.translucentSidebar = value
  },
})

const selectedReducedMotion = computed({
  get: () => themeSettings.value.reducedMotion,
  set: (value: boolean) => {
    themeSettings.value.reducedMotion = value
  },
})

// Boolean prefs persist immediately (no unsaved bar) — confirm with a toast.
const handleToggleTranslucentSidebar = (value: unknown) => {
  selectedTranslucentSidebar.value = value === true
  toast.success(t("settings.appearance.updateSuccess"))
}

const handleToggleReducedMotion = (value: unknown) => {
  selectedReducedMotion.value = value === true
  toast.success(t("settings.appearance.updateSuccess"))
}

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

// Paint each swatch dot from the option's CSS-var color; `custom` uses the
// live picked color. Inline style (not a `bg-*` class) so dynamically-listed
// palette colors don't depend on Tailwind's static class scanning.
const baseSwatchStyle = (option: ColorSwatch<BaseId>) => ({
  backgroundColor:
    option.id === "custom" ? selectedCustomBaseColor.value : option.swatch,
})

const accentSwatchStyle = (option: ColorSwatch<AccentId>) => ({
  backgroundColor:
    option.id === "custom" ? selectedCustomAccentColor.value : option.swatch,
})
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
      </FieldSet>
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
              class="bg-background aspect-square size-9 cursor-pointer appearance-none rounded border p-2.75"
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
                      class="size-3 rounded-md"
                      :style="baseSwatchStyle(color)"
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
                      class="size-3 rounded-md"
                      :style="baseSwatchStyle(color)"
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
              class="bg-background aspect-square size-9 cursor-pointer appearance-none rounded border p-2.75"
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
                      class="size-3 rounded-md"
                      :style="accentSwatchStyle(color)"
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
                      class="size-3 rounded-md"
                      :style="accentSwatchStyle(color)"
                    />
                    {{ color.name }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </Field>
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
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
      <FieldSeparator />
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="editor-theme">{{
              t("settings.preferences.editorTheme.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.editorTheme.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="editor-theme" v-model="selectedEditorTheme">
            <SelectTrigger>
              <SelectValue
                :placeholder="t('settings.preferences.editorTheme.placeholder')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="theme in editorThemes"
                  :key="theme.id"
                  :value="theme.id"
                >
                  <Component :is="theme.icon" />
                  {{ theme.name }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="editor-font-size">{{
              t("settings.preferences.editorFontSize.label")
            }}</FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.editorFontSize.description") }}
            </FieldDescription>
          </FieldContent>
          <Select id="editor-font-size" v-model="selectedEditorFontSize">
            <SelectTrigger>
              <SelectValue
                :placeholder="
                  t('settings.preferences.editorFontSize.placeholder')
                "
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="fontSize in editorFontSizes"
                  :key="fontSize.id"
                  :value="fontSize.id"
                >
                  <Component :is="fontSize.icon" />
                  <span :class="fontSize.style">
                    {{ fontSize.name }}
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="translucent-sidebar">
              {{ t("settings.appearance.translucentSidebar.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.appearance.translucentSidebar.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="translucent-sidebar"
            :model-value="selectedTranslucentSidebar"
            @update:model-value="handleToggleTranslucentSidebar"
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="reduced-motion">
              {{ t("settings.appearance.reducedMotion.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.appearance.reducedMotion.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="reduced-motion"
            :model-value="selectedReducedMotion"
            @update:model-value="handleToggleReducedMotion"
          />
        </Field>
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
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
      </FieldSet>
    </FieldGroup>
  </div>
</template>

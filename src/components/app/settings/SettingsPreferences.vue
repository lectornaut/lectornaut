<script lang="ts" setup>
import { useSettingsStore } from "@/stores/settingsStore"
import { storeToRefs } from "pinia"

const { t } = useI18n()

const settingsStore = useSettingsStore()
const { runOnStartup, menuBar, isUpdatingPreferences } =
  storeToRefs(settingsStore)
const { updatePreference } = settingsStore

const toBoolean = (value: unknown): boolean => value === true
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="run-on-startup">
              {{ t("settings.preferences.runOnStartup.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.runOnStartup.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="run-on-startup"
            :disabled="isUpdatingPreferences"
            :model-value="runOnStartup"
            @update:model-value="
              updatePreference('runOnStartup', toBoolean($event))
            "
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="menu-bar">
              {{ t("settings.preferences.menuBar.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.menuBar.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="menu-bar"
            :disabled="isUpdatingPreferences"
            :model-value="menuBar"
            @update:model-value="updatePreference('menuBar', toBoolean($event))"
          />
        </Field>
      </FieldSet>
    </FieldGroup>
  </div>
</template>

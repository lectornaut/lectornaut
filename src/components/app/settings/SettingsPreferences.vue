<script lang="ts" setup>
import { isTauri } from "@/composables/usePlatform"
import {
  checkForUpdates,
  downloadAndInstallUpdate,
  isCheckingForUpdates,
  lastCheckResult,
} from "@/modules/updater"
import { useSettingsStore } from "@/stores/settingsStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const { t } = useI18n()

const settingsStore = useSettingsStore()
const {
  runOnStartup,
  menuBar,
  badgeCount,
  automaticUpdates,
  lastUpdateCheck,
  isUpdatingPreferences,
} = storeToRefs(settingsStore)
const { updatePreference } = settingsStore

const toBoolean = (value: unknown): boolean => value === true

const version = __APP_VERSION__

const lastCheckedTimeAgo = useTimeAgo(
  computed(() => lastUpdateCheck.value || Date.now())
)

const handleCheckForUpdates = async () => {
  try {
    const result = await checkForUpdates()
    lastUpdateCheck.value = Date.now()

    if (result.status === "up-to-date") {
      toast.success(t("settings.preferences.checkForUpdates.labelUpToDate"), {
        description: t("settings.preferences.checkForUpdates.description", {
          version,
        }),
      })
    }
  } catch (error) {
    console.error("Error checking for updates:", error)
  }
}

const handleUpdateNow = async () => {
  if (lastCheckResult.value?.update) {
    await downloadAndInstallUpdate(lastCheckResult.value.update)
  }
}
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <FieldLabel>
          {{ t("settings.preferences.system.label") }}
        </FieldLabel>
        <Field v-if="isTauri" orientation="horizontal">
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
        <Field v-if="isTauri" orientation="horizontal">
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
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="badge-count">
              {{ t("settings.preferences.badgeCount.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.badgeCount.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="badge-count"
            :disabled="isUpdatingPreferences"
            :model-value="badgeCount"
            @update:model-value="
              updatePreference('badgeCount', toBoolean($event))
            "
          />
        </Field>
      </FieldSet>
      <template v-if="isTauri">
        <FieldSeparator />
        <FieldSet>
          <FieldLabel>
            {{ t("settings.preferences.updates.label") }}
          </FieldLabel>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                <template v-if="lastCheckResult?.status === 'available'">
                  {{
                    t(
                      "settings.preferences.checkForUpdates.labelUpdateAvailable"
                    )
                  }}
                </template>
                <template v-else-if="lastCheckResult?.status === 'up-to-date'">
                  {{ t("settings.preferences.checkForUpdates.labelUpToDate") }}
                </template>
                <template v-else>
                  {{ t("settings.preferences.checkForUpdates.label") }}
                </template>
              </FieldLabel>
              <FieldDescription>
                <template v-if="lastCheckResult?.status === 'available'">
                  {{
                    t(
                      "settings.preferences.checkForUpdates.descriptionAvailable",
                      { version: lastCheckResult.version }
                    )
                  }}
                </template>
                <template v-else>
                  {{
                    t("settings.preferences.checkForUpdates.description", {
                      version,
                    })
                  }}
                </template>
              </FieldDescription>
            </FieldContent>
            <Button
              v-if="lastCheckResult?.status === 'available'"
              size="sm"
              @click="handleUpdateNow"
            >
              {{ t("settings.preferences.checkForUpdates.actionUpdate") }}
            </Button>
            <Button
              v-else
              variant="secondary"
              size="sm"
              :disabled="isCheckingForUpdates"
              @click="handleCheckForUpdates"
            >
              <Spinner v-if="isCheckingForUpdates" />
              {{ t("settings.preferences.checkForUpdates.action") }}
            </Button>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="automatic-updates">
                {{ t("settings.preferences.automaticUpdates.label") }}
              </FieldLabel>
              <FieldDescription>
                {{
                  t("settings.preferences.automaticUpdates.description", {
                    timeAgo: lastUpdateCheck
                      ? lastCheckedTimeAgo
                      : t("settings.preferences.checkForUpdates.action"),
                  })
                }}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="automatic-updates"
              :disabled="isUpdatingPreferences"
              :model-value="automaticUpdates"
              @update:model-value="
                updatePreference('automaticUpdates', toBoolean($event))
              "
            />
          </Field>
        </FieldSet>
      </template>
    </FieldGroup>
  </div>
</template>

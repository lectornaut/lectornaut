<script lang="ts" setup>
import { isTauri } from "@/composables/usePlatform"
import {
  type ShortcutRecorderTarget,
  useShortcutRecorder,
} from "@/composables/useShortcutRecorder"
import { IconCheck, IconRotateCcw, IconSettings2 } from "@/data/icons"
import { defaultFileDropOverlayShortcutKeys } from "@/helpers/defaults"
import {
  getHotkeyCombos,
  hotkeyToDisplayKeys,
  normalizeHotkeyCombo,
} from "@/helpers/shortcuts"
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
  fileDropOverlayDragDrop,
  fileDropOverlayShortcut,
  fileDropOverlayShortcutKeys,
  openInDesktopApp,
  readAloudEnabled,
  dictationEnabled,
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

// Keyboard shortcut recorder (using shared composable)
const recorderRef = ref<ShortcutRecorderTarget>(null)

const {
  isRecording,
  startRecording: startRecordingBase,
  handleRecorderFocus,
  handleRecorderBlur,
  handleRecorderClick,
  handleRecorderKeydown,
} = useShortcutRecorder({
  onRecord: (hotkeys) => {
    // The recorder emits a single Mod-notation combo (e.g. "Mod+Shift+D");
    // store it verbatim for the Tauri global-shortcut registration.
    fileDropOverlayShortcutKeys.value = getHotkeyCombos(hotkeys)[0] ?? ""
  },
})

const startRecording = () => {
  startRecordingBase(recorderRef.value)
}

const handleRecorderGroupClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null
  if (target?.closest("button, a, [role='button']")) {
    return
  }

  startRecordingBase(event.currentTarget)
}

const displayKeys = computed(() =>
  hotkeyToDisplayKeys(fileDropOverlayShortcutKeys.value)
)

const isDefaultShortcut = computed(
  () =>
    normalizeHotkeyCombo(fileDropOverlayShortcutKeys.value) ===
    normalizeHotkeyCombo(defaultFileDropOverlayShortcutKeys)
)

const restoreDefaultShortcut = () => {
  fileDropOverlayShortcutKeys.value = defaultFileDropOverlayShortcutKeys
}
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.preferences.system.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.system.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field v-if="isTauri" orientation="horizontal">
          <FieldContent>
            <FieldLabel for="run-on-startup">
              {{ t("settings.preferences.runOnStartup.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.runOnStartup.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="run-on-startup" v-model="runOnStartup" />
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
          <Switch id="menu-bar" v-model="menuBar" />
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
          <InputGroupButton
            v-if="isUpdatingPreferences === 'badgeCount'"
            variant="ghost"
            size="icon-xs"
            disabled
          >
            <Spinner />
          </InputGroupButton>
          <Switch
            id="badge-count"
            :disabled="isUpdatingPreferences !== null"
            :model-value="badgeCount"
            @update:model-value="
              updatePreference('badgeCount', toBoolean($event))
            "
          />
        </Field>
        <Field v-if="!isTauri" orientation="horizontal">
          <FieldContent>
            <FieldLabel for="open-in-desktop-app">
              {{ t("settings.preferences.openInDesktopApp.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.openInDesktopApp.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="open-in-desktop-app" v-model="openInDesktopApp" />
        </Field>
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>
              {{ t("settings.preferences.speech.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.speech.description") }}
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="read-aloud">
              {{ t("settings.preferences.readAloud.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.readAloud.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="read-aloud" v-model="readAloudEnabled" />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="dictation">
              {{ t("settings.preferences.dictation.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.preferences.dictation.description") }}
            </FieldDescription>
          </FieldContent>
          <Switch id="dictation" v-model="dictationEnabled" />
        </Field>
      </FieldSet>
      <template v-if="isTauri">
        <FieldSeparator />
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.preferences.shortcuts.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.preferences.shortcuts.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="file-drop-overlay-drag-drop">
                {{ t("settings.preferences.fileDropOverlayDragDrop.label") }}
              </FieldLabel>
              <FieldDescription>
                {{
                  t("settings.preferences.fileDropOverlayDragDrop.description")
                }}
              </FieldDescription>
            </FieldContent>
            <InputGroupButton
              v-if="isUpdatingPreferences === 'fileDropOverlayDragDrop'"
              variant="ghost"
              size="icon-xs"
              disabled
            >
              <Spinner />
            </InputGroupButton>
            <Switch
              id="file-drop-overlay-drag-drop"
              :disabled="isUpdatingPreferences !== null"
              :model-value="fileDropOverlayDragDrop"
              @update:model-value="
                updatePreference('fileDropOverlayDragDrop', toBoolean($event))
              "
            />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="file-drop-overlay-shortcut">
                {{ t("settings.preferences.fileDropOverlayShortcut.label") }}
              </FieldLabel>
              <FieldDescription>
                {{
                  t("settings.preferences.fileDropOverlayShortcut.description")
                }}
              </FieldDescription>
            </FieldContent>
            <InputGroupButton
              v-if="isUpdatingPreferences === 'fileDropOverlayShortcut'"
              variant="ghost"
              size="icon-xs"
              disabled
            >
              <Spinner />
            </InputGroupButton>
            <Switch
              id="file-drop-overlay-shortcut"
              :disabled="isUpdatingPreferences !== null"
              :model-value="fileDropOverlayShortcut"
              @update:model-value="
                updatePreference('fileDropOverlayShortcut', toBoolean($event))
              "
            />
          </Field>
          <Field v-if="fileDropOverlayShortcut" orientation="horizontal">
            <FieldContent>
              <FieldLabel for="file-drop-overlay-shortcut-keys">
                {{
                  t("settings.preferences.fileDropOverlayShortcutKeys.label")
                }}
              </FieldLabel>
              <FieldDescription>
                {{
                  t(
                    "settings.preferences.fileDropOverlayShortcutKeys.description"
                  )
                }}
              </FieldDescription>
            </FieldContent>
            <InputGroup
              class="w-min gap-1"
              :data-disabled="isUpdatingPreferences !== null"
              @click="handleRecorderGroupClick"
            >
              <InputGroupAddon>
                <KbdGroup>
                  <Kbd v-for="key in displayKeys" :key="key">
                    {{ key }}
                  </Kbd>
                </KbdGroup>
              </InputGroupAddon>
              <InputGroupInput
                ref="recorderRef"
                readonly
                :disabled="isUpdatingPreferences !== null"
                :placeholder="
                  t(
                    'settings.preferences.fileDropOverlayShortcutKeys.recording'
                  )
                "
                @focus="handleRecorderFocus"
                @click="handleRecorderClick"
                @keydown="handleRecorderKeydown"
                @blur="handleRecorderBlur"
              />
              <TooltipProvider>
                <InputGroupAddon align="inline-end" class="gap-1">
                  <Tooltip v-if="!isDefaultShortcut">
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="isUpdatingPreferences !== null"
                        @mousedown.prevent
                        @click="restoreDefaultShortcut"
                      >
                        <IconRotateCcw />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        t(
                          "settings.preferences.fileDropOverlayShortcutKeys.restoreDefault"
                        )
                      }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip v-if="isRecording">
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="isUpdatingPreferences !== null"
                      >
                        <IconCheck />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        t(
                          "settings.preferences.fileDropOverlayShortcutKeys.recording"
                        )
                      }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip v-else>
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        size="icon-xs"
                        :disabled="isUpdatingPreferences !== null"
                        @mousedown.prevent
                        @click="startRecording"
                      >
                        <IconSettings2 />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        t(
                          "settings.preferences.fileDropOverlayShortcutKeys.recording"
                        )
                      }}
                    </TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
              </TooltipProvider>
            </InputGroup>
          </Field>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.preferences.updates.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.preferences.updates.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>
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
              @click="handleUpdateNow"
            >
              {{ t("settings.preferences.checkForUpdates.actionUpdate") }}
            </Button>
            <Button
              v-else
              variant="secondary"
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
            <Switch id="automatic-updates" v-model="automaticUpdates" />
          </Field>
        </FieldSet>
      </template>
    </FieldGroup>
  </div>
</template>

<script lang="ts" setup>
import { isTauri } from "@/composables/usePlatform"
import { IconCheck, IconKeyboard } from "@/data/icons"
import { getPlatformSpecialKey, IS_APPLE_DEVICE } from "@/helpers/shortcuts"
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

// Keyboard shortcut recorder
const isRecording = ref(false)
const recorderRef = ref<{ $el: HTMLElement } | null>(null)

const DISPLAY_KEY_MAP: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
  enter: "↩",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  " ": "Space",
}

const hotkeyToDisplayKeys = (hotkey: string): string[] => {
  const parts = hotkey.split("+")
  return parts.map((part) => {
    switch (part) {
      case "cmd":
        return IS_APPLE_DEVICE ? "⌘" : getPlatformSpecialKey()
      case "ctrl":
        return IS_APPLE_DEVICE ? "⌃" : "Ctrl"
      case "shift":
        return IS_APPLE_DEVICE ? "⇧" : "Shift"
      case "alt":
        return IS_APPLE_DEVICE ? "⌥" : "Alt"
      default:
        return DISPLAY_KEY_MAP[part] ?? part.toUpperCase()
    }
  })
}

const displayKeys = computed(() =>
  hotkeyToDisplayKeys(fileDropOverlayShortcutKeys.value)
)

const handleRecorderKeydown = (event: KeyboardEvent) => {
  if (!isRecording.value) return

  event.preventDefault()
  event.stopPropagation()

  // Ignore lone modifier presses
  if (["Control", "Shift", "Alt", "Meta", "OS"].includes(event.key)) {
    return
  }

  // Require at least one modifier
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    return
  }

  const parts: string[] = []
  if (event.metaKey) parts.push("cmd")
  if (event.ctrlKey) parts.push("ctrl")
  if (event.altKey) parts.push("alt")
  if (event.shiftKey) parts.push("shift")

  // For single printable characters, use the character directly.
  // For named keys (Arrow*, Escape, etc.), use event.key which gives
  // the standard name that toTauriShortcut can uppercase for Tauri.
  const key =
    event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  parts.push(key)

  const hotkeyString = parts.join("+")
  isRecording.value = false
  fileDropOverlayShortcutKeys.value = hotkeyString
}

const startRecording = () => {
  isRecording.value = true
  nextTick(() => {
    const el = recorderRef.value?.$el
    if (el instanceof HTMLInputElement) el.focus()
    else el?.querySelector?.("input")?.focus()
  })
}

const stopRecording = () => {
  isRecording.value = false
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
          <ButtonGroup>
            <ButtonGroup v-if="isUpdatingPreferences === 'badgeCount'">
              <InputGroupButton variant="ghost" size="icon-xs" disabled>
                <Spinner />
              </InputGroupButton>
            </ButtonGroup>
            <ButtonGroup>
              <Switch
                id="badge-count"
                :disabled="isUpdatingPreferences !== null"
                :model-value="badgeCount"
                @update:model-value="
                  updatePreference('badgeCount', toBoolean($event))
                "
              />
            </ButtonGroup>
          </ButtonGroup>
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
      <template v-if="isTauri">
        <FieldSeparator />
        <FieldSet>
          <FieldLabel>
            {{ t("settings.preferences.shortcuts.label") }}
          </FieldLabel>
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
            <ButtonGroup>
              <ButtonGroup
                v-if="isUpdatingPreferences === 'fileDropOverlayDragDrop'"
              >
                <InputGroupButton variant="ghost" size="icon-xs" disabled>
                  <Spinner />
                </InputGroupButton>
              </ButtonGroup>
              <ButtonGroup>
                <Switch
                  id="file-drop-overlay-drag-drop"
                  :disabled="isUpdatingPreferences !== null"
                  :model-value="fileDropOverlayDragDrop"
                  @update:model-value="
                    updatePreference(
                      'fileDropOverlayDragDrop',
                      toBoolean($event)
                    )
                  "
                />
              </ButtonGroup>
            </ButtonGroup>
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
            <ButtonGroup>
              <ButtonGroup
                v-if="isUpdatingPreferences === 'fileDropOverlayShortcut'"
              >
                <InputGroupButton variant="ghost" size="icon-xs" disabled>
                  <Spinner />
                </InputGroupButton>
              </ButtonGroup>
              <ButtonGroup>
                <Switch
                  id="file-drop-overlay-shortcut"
                  :disabled="isUpdatingPreferences !== null"
                  :model-value="fileDropOverlayShortcut"
                  @update:model-value="
                    updatePreference(
                      'fileDropOverlayShortcut',
                      toBoolean($event)
                    )
                  "
                />
              </ButtonGroup>
            </ButtonGroup>
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
              class="w-min"
              :data-disabled="isUpdatingPreferences !== null"
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
                    'settings.preferences.fileDropOverlayShortcutKeys.placeholder'
                  )
                "
                @focus="startRecording"
                @click="startRecording"
                @keydown="handleRecorderKeydown"
                @blur="stopRecording"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  :disabled="isUpdatingPreferences !== null"
                >
                  <IconCheck v-if="isRecording" />
                  <IconKeyboard v-else />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </FieldSet>
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
            <Switch id="automatic-updates" v-model="automaticUpdates" />
          </Field>
        </FieldSet>
      </template>
    </FieldGroup>
  </div>
</template>

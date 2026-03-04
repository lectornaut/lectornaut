<script lang="ts" setup>
import SettingsContent from "@/components/app/settings/SettingsContent.vue"
import { defaultSettingsTab } from "@/helpers/defaults"
import { normalizeSettingsTab } from "@/helpers/settingsTabs"
import { emitter } from "@/modules/mitt"

// Dialog state
const openSettings = ref(false)
const activeTab = ref(normalizeSettingsTab(defaultSettingsTab))

emitter.on("Dialog.Settings.Open", (event) => {
  activeTab.value = normalizeSettingsTab(event as string)
  openSettings.value = true
})
</script>

<template>
  <Dialog v-model:open="openSettings">
    <DialogContent
      class="h-3/4 max-h-3/4! w-3/4 max-w-3/4! overflow-auto overscroll-none scroll-smooth p-0"
    >
      <SettingsContent v-model:active-tab="activeTab" mode="dialog" />
    </DialogContent>
  </Dialog>
</template>

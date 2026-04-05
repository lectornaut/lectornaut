<script lang="ts" setup>
import { getCurrentTauriWindow, isTauri } from "@/composables/usePlatform"
import { FILE_CAPTURE_WINDOW_LABEL } from "@/modules/fileCapture"
import { emitter } from "@/modules/mitt"
import { state, store } from "@/modules/theme"
import type { ThemeMode } from "@/types/settings"
import { useRegisterSW } from "virtual:pwa-register/vue"
import { toast } from "vue-sonner"

const currentWindowLabel = shallowRef<string | null>(null)
const isFileCaptureWindow = computed(
  () => currentWindowLabel.value === FILE_CAPTURE_WINDOW_LABEL
)

const visibility = useDocumentVisibility()
const isDark = usePreferredDark()

const favicon = computed(() => {
  if (visibility.value === "hidden") {
    return "/favicon-invisible.svg"
  }
  return isDark.value ? "/favicon-dark.svg" : "/favicon.svg"
})

useFavicon(favicon)

const sonnerTheme = computed(() => {
  if (state.value === "dark") return "dark"
  if (state.value === "light") return "light"
  return "system"
})

useHead({
  meta: [
    {
      name: "theme-color",
      content: () =>
        state.value === "light"
          ? "oklch(98.5% 0.001 106.423)"
          : "oklch(21% 0.006 285.885)",
    },
  ],
})

emitter.on("Theme.Change", (newTheme) => {
  store.value = newTheme as ThemeMode
})

const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW()

watch(offlineReady, (value) => {
  if (!value) return
  toast.success("Ready to work offline", {
    id: "pwa-offline-ready",
    description:
      "The app is cached and will work without an internet connection.",
    action: {
      label: "Okay",
      onClick: () => {
        offlineReady.value = false
      },
    },
    onDismiss: () => {
      offlineReady.value = false
    },
    onAutoClose: () => {
      offlineReady.value = false
    },
  })
})

watch(needRefresh, (value) => {
  if (!value) return
  toast.info("New version available", {
    id: "pwa-need-refresh",
    duration: Infinity,
    description: "Reload the app to apply the latest update.",
    action: {
      label: "Reload",
      onClick: () => updateServiceWorker(),
    },
    onDismiss: () => {
      needRefresh.value = false
    },
  })
})

const online = useOnline()

watch(online, (value) => {
  if (value) toast.success("You are online")
  else toast.error("You are offline")
})

onMounted(() => {
  if (!isTauri.value) return

  currentWindowLabel.value = getCurrentTauriWindow()?.label ?? null
})
</script>

<template>
  <Sonner
    offset="8px"
    close-button
    close-button-position="top-right"
    position="bottom-center"
    :theme="sonnerTheme"
  />
  <ExitTrigger />
  <SessionRevokedDialog />
  <MfaResolverDialog />
  <FileDropOverlay v-if="!isFileCaptureWindow" />
</template>

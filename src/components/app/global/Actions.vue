<script setup lang="ts">
import emitter from "@/modules/mitt"
import { state, store } from "@/modules/theme"
import { useRegisterSW } from "virtual:pwa-register/vue"
import { toast } from "vue-sonner"

const visibility = useDocumentVisibility()
const isDark = useDark()

const favicon = computed(() => {
  if (visibility.value === "hidden") {
    return "/favicon-invisible.svg"
  }
  return isDark.value ? "/favicon-dark.svg" : "/favicon.svg"
})

useFavicon(favicon)

useHead({
  meta: [
    {
      name: "theme-color",
      content: () => (state.value === "dark" ? "#000000" : "#ffffff"),
    },
  ],
})

watch(state, (value) => {
  useHead({
    meta: [
      {
        name: "theme-color",
        content: () => (value === "dark" ? "#000000" : "#ffffff"),
      },
    ],
  })
})

emitter.on("Theme.Change", (newTheme) => {
  store.value = newTheme as "light" | "dark" | "auto"
})

const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW()

watch(offlineReady, (value) => {
  if (value) {
    toast.info("Ready to work offline", {
      action: {
        label: "Okay",
        onClick: () => {
          offlineReady.value = false
        },
      },
      onDismiss: () => {
        offlineReady.value = false
      },
    })
  }
})

watch(needRefresh, (value) => {
  if (value) {
    toast.info("Update available", {
      duration: Infinity,
      action: {
        label: "Update",
        onClick: () => updateServiceWorker(),
      },
      onDismiss: () => {
        needRefresh.value = false
      },
    })
  }
})

useEventListener(
  document,
  "contextmenu",
  (e) => {
    e.preventDefault()
    return false
  },
  { capture: true }
)

const online = useOnline()

watch(online, (value) => {
  if (value) {
    emitter.emit("Toast.Success", "You are online")
  } else {
    emitter.emit("Toast.Error", "You are offline")
  }
})

emitter.on("Toast.Success", (message) => {
  toast.success(message as string)
})

emitter.on("Toast.Error", (message) => {
  toast.error(message as string)
})
</script>

<template>
  <Sonner offset="8px" :theme="state" />
</template>

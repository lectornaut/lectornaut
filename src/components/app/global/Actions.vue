<script setup lang="ts">
import emitter from "@/modules/mitt"
import { state, store } from "@/modules/theme"
import { useRegisterSW } from "virtual:pwa-register/vue"
import { toast } from "vue-sonner"

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
</script>

<template>
  <Sonner offset="8px" :theme="state" />
</template>

import App from "@/App.vue"
import { isTauri } from "@/composables/usePlatform"
import { createAppCheckModule } from "@/modules/appCheck"
import { initDeepLink } from "@/modules/deepLink"
import { firebaseApp } from "@/modules/firebase"
import { initHotkeys } from "@/modules/hotkeys"
import { i18n, initLanguage } from "@/modules/i18n"
import { initPwa } from "@/modules/pwa"
import { router } from "@/modules/router"
import { initTheme } from "@/modules/theme"
import { initUpdater } from "@/modules/updater"
import { setSchemaViolationSink } from "@/schemas"
import "@/styles/index.css"
import { initSync } from "@/utils/firebase/firebase-sync-engine"
import "@geoql/v-maplibre/dist/v-maplibre.css"
import { createHead } from "@unhead/vue/client"
import { MotionPlugin } from "@vueuse/motion"
import "maplibre-gl/dist/maplibre-gl.css"
import { ClickScrollPlugin, OverlayScrollbars } from "overlayscrollbars"
import "overlayscrollbars/overlayscrollbars.css"
import { createPinia } from "pinia"
import "unfonts.css"
import "vue-sonner/style.css"
import { VueFire, VueFireAuth } from "vuefire"
import "xterminal/dist/xterminal.css"
import "~console/theme-detect"

OverlayScrollbars.plugin(ClickScrollPlugin)

const head = createHead()
const pinia = createPinia()
const app = createApp(App)

app.use(VueFire, {
  firebaseApp,
  modules: [createAppCheckModule(), VueFireAuth()],
})
app.use(router)
app.use(head)
app.use(MotionPlugin)
app.use(i18n)
app.use(pinia)

await router.isReady()

app.mount("#app")

// Route schema violations through the project logger + a dev-only toast.
// In prod, reads degrade silently (caught by parseOrWarn's short-circuit);
// writes throw SchemaValidationError which store write paths catch.
setSchemaViolationSink((violation) => {
  console.warn(
    `[schema:${violation.context}]`,
    violation.error.issues,
    violation.raw
  )
  if (import.meta.env.DEV) {
    void import("vue-sonner").then(({ toast }) =>
      toast.error(`Schema violation: ${violation.context}`, {
        description:
          violation.error.issues[0]?.message ?? "See console for details",
        duration: 8000,
      })
    )
  }
})

if (isTauri.value) {
  const automaticUpdates = useStorage<boolean>("automaticUpdates", true)
  if (automaticUpdates.value) {
    const lastUpdateCheck = useStorage<number>("lastUpdateCheck", 0)
    initUpdater().then(() => {
      lastUpdateCheck.value = Date.now()
    })
  }
}

initDeepLink()
initTheme()
initLanguage()
initHotkeys()
initPwa()
initSync()

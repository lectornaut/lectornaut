import App from "@/App.vue"
import { isTauri } from "@/composables/usePlatform"
import { createAppCheckModule } from "@/modules/appCheck"
import { firebaseApp } from "@/modules/firebase"
import { initHotkeys } from "@/modules/hotkeys"
import { i18n, initLanguage } from "@/modules/i18n"
import { initPwa } from "@/modules/pwa"
import { router } from "@/modules/router"
import { initTheme } from "@/modules/theme"
import { initUpdater } from "@/modules/updater"
import "@/styles/index.css"
import { initSync } from "@/utils/firebase/firebase-sync-engine"
import "@geoql/v-maplibre/dist/v-maplibre.css"
import { InferSeoMetaPlugin } from "@unhead/addons"
import { createHead } from "@unhead/vue/client"
import { MotionPlugin } from "@vueuse/motion"
import "maplibre-gl/dist/maplibre-gl.css"
import "overlayscrollbars/overlayscrollbars.css"
import { createPinia } from "pinia"
import "unfonts.css"
import "vue-sonner/style.css"
import { VueFire, VueFireAuth } from "vuefire"
import "xterminal/dist/xterminal.css"
import "~console/theme-detect"

const head = createHead({
  plugins: [InferSeoMetaPlugin()],
})
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

if (isTauri.value) {
  const automaticUpdates = useStorage<boolean>("automaticUpdates", true)
  if (automaticUpdates.value) {
    const lastUpdateCheck = useStorage<number>("lastUpdateCheck", 0)
    initUpdater().then(() => {
      lastUpdateCheck.value = Date.now()
    })
  }
}

initTheme()
initLanguage()
initHotkeys()
initPwa()
initSync()

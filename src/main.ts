import App from "@/App.vue"
import { isTauri } from "@/helpers/utilities"
import { firebaseApp } from "@/modules/firebase"
import { initHotkeys } from "@/modules/hotkeys"
import { i18n } from "@/modules/i18n"
import { initPwa } from "@/modules/pwa"
import { router } from "@/modules/router"
import { initTheme } from "@/modules/theme"
import { initUpdater } from "@/modules/updater"
import "@/styles/index.css"
import { InferSeoMetaPlugin } from "@unhead/addons"
import { createHead } from "@unhead/vue/client"
import { MotionPlugin } from "@vueuse/motion"
import "driver.js/dist/driver.css"
import { ReCaptchaEnterpriseProvider } from "firebase/app-check"
import "overlayscrollbars/overlayscrollbars.css"
import { createPinia } from "pinia"
import "unfonts.css"
import "vue-sonner/style.css"
import { VueFire, VueFireAppCheck, VueFireAuth } from "vuefire"
import "~console/theme-detect"

const head = createHead({
  plugins: [InferSeoMetaPlugin()],
})
const pinia = createPinia()
const app = createApp(App)

app.use(VueFire, {
  firebaseApp,
  modules: [
    VueFireAppCheck({
      debug: process.env.NODE_ENV !== "production",
      provider: new ReCaptchaEnterpriseProvider(
        import.meta.env.VITE_RECAPTCHA_ENTERPRISE_KEY
      ),
      isTokenAutoRefreshEnabled: true,
    }),
    VueFireAuth(),
  ],
})
app.use(router)
app.use(head)
app.use(MotionPlugin)
app.use(i18n)
app.use(pinia)

app.mount("#app")

if (isTauri.value) {
  initUpdater()
}

initTheme()
initHotkeys()
initPwa()

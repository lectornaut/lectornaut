import App from "@/App.vue"
import "@/assets/index.css"
import "@/assets/main.scss"
import "@/assets/theme.scss"
import { firebaseApp } from "@/modules/firebase"
import { initHotkeys } from "@/modules/hotkeys"
import { i18n } from "@/modules/i18n"
import { initPwa } from "@/modules/pwa"
import { router } from "@/modules/router"
import { initTheme } from "@/modules/theme"
import { InferSeoMetaPlugin } from "@unhead/addons"
import { createHead } from "@unhead/vue/client"
import { MotionPlugin } from "@vueuse/motion"
import { ReCaptchaEnterpriseProvider } from "firebase/app-check"
import { createApp } from "vue"
import { VueFire, VueFireAuth, VueFireAppCheck } from "vuefire"

const head = createHead({
  plugins: [InferSeoMetaPlugin()],
})

const app = createApp(App)

app.use(VueFire, {
  firebaseApp,
  modules: [
    VueFireAppCheck({
      debug: process.env.NODE_ENV !== "production",
      provider: new ReCaptchaEnterpriseProvider(
        "6LcbLl8qAAAAAGSsh5k2tAOP1e1yqFZZ3rR_JvZ2"
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

app.mount("#app")

initTheme()
initHotkeys()
initPwa()

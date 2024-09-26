import App from "@/App.vue"
import "@/assets/index.css"
import "@/assets/main.scss"
import "@/assets/theme.scss"
import { firebaseApp } from "@/modules/firebase"
import { i18n } from "@/modules/i18n"
import { initPwa } from "@/modules/pwa"
import { router } from "@/modules/router"
import { initTheme } from "@/modules/theme"
import { InferSeoMetaPlugin } from "@unhead/addons"
import { createHead } from "@unhead/vue"
import { MotionPlugin } from "@vueuse/motion"
import "unfonts.css"
import { createApp } from "vue"
import { VueFire, VueFireAuth } from "vuefire"

const head = createHead({
  plugins: [InferSeoMetaPlugin()],
})

const app = createApp(App)

app.use(router)
app.use(head)
app.use(VueFire, {
  firebaseApp,
  modules: [VueFireAuth()],
})
app.use(MotionPlugin)
app.use(i18n)

app.mount("#app")

initTheme()
initPwa()

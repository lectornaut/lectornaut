import App from "@/App.vue"
import { preloadActiveCodeTheme } from "@/components/editors/text/shiki"
import { isTauri } from "@/composables/usePlatform"
import { createAppCheckModule } from "@/modules/appCheck"
import { initDeepLink } from "@/modules/deepLink"
import { authReady, firebaseApp } from "@/modules/firebase"
import { i18n, initLanguage } from "@/modules/i18n"
import { initPwa } from "@/modules/pwa"
import { router } from "@/modules/router"
import { initTheme } from "@/modules/theme"
import { initUpdater } from "@/modules/updater"
import { setSchemaViolationSink } from "@/schemas"
import "@/styles/index.css"
import { initSync } from "@/utils/firebase/firebase-sync-engine"
import { createHead } from "@unhead/vue/client"
import { MotionPlugin } from "@vueuse/motion"
import {
  enableKatex,
  enableMermaid,
  preloadExtendedLanguageIcons,
} from "markstream-vue"
import { ClickScrollPlugin, OverlayScrollbars } from "overlayscrollbars"
import "overlayscrollbars/overlayscrollbars.scriptingenabled.css"
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

app.use(pinia)
app.use(VueFire, {
  firebaseApp,
  modules: [createAppCheckModule(), VueFireAuth()],
})
app.use(router)
app.use(head)
app.use(MotionPlugin)
app.use(i18n)

initTheme()
initLanguage()
initDeepLink()
initPwa()
initSync()

// Explicit opt-in for KaTeX (`$inline$` / `$$block$$` math) and
// Mermaid (` ```mermaid ` blocks). markstream-vue would auto-enable
// these the moment their peer packages exist in node_modules, but
// stating intent in code protects against a peer being silently
// removed in a future cleanup pass.
enableKatex()
enableMermaid()

// Warm the Shiki code-block language icons off the critical path so the
// first fenced code block in a chat bubble or changelog entry doesn't pay
// the cold-start cost. Code blocks render via the Shiki MarkdownCodeBlockNode
// (see registerMarkdownOverrides); the highlighter loads grammars on demand.
void preloadExtendedLanguageIcons()

// Order matters: authReady must resolve before router.isReady() so the
// initial navigation guard sees a settled `auth.currentUser`.
await authReady
await router.isReady()

// Block mount until the active Shiki editor theme is loaded so the Tiptap,
// CodeMirror, and markstream-vue code surfaces all render on the correct
// theme background from the first frame instead of flashing a fallback
// (prose muted / app background / library muted) while the async highlighter
// loads. Runs after authReady/router so we don't widen the cold-start budget
// (the Shiki theme load is dwarfed by those); even if it threw, we swallow it
// — a missing theme falls back to the previous behaviour (empty colors ref).
await preloadActiveCodeTheme().catch(() => {})

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

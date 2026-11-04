import App from "@/App.vue"
import { preloadActiveCodeTheme } from "@/components/editors/text/shiki"
import { isMainTauriWindow, isTauri } from "@/composables/usePlatform"
import type { DockIconId } from "@/helpers/defaults"
import { defaultDockIcon } from "@/helpers/defaults"
import { createAppCheckModule } from "@/modules/appCheck"
import "@/modules/connectionCallbackRelay"
import { initDeepLink } from "@/modules/deepLink"
import { authReady, firebaseApp } from "@/modules/firebase"
import { i18n, initLanguage } from "@/modules/i18n"
import { initPwa } from "@/modules/pwa"
import { queryClient } from "@/modules/queryClient"
import {
  restoreQueryCache,
  startQueryCachePersistence,
} from "@/modules/queryPersister"
import { router } from "@/modules/router"
import { initTheme } from "@/modules/theme"
import { initUpdater } from "@/modules/updater"
import { setSchemaViolationSink } from "@/schemas"
import "@/styles/index.css"
import { initSync } from "@/utils/firebase/firebase-sync-engine"
import { VueQueryPlugin } from "@tanstack/vue-query"
import { invoke } from "@tauri-apps/api/core"
import { createHead } from "@unhead/vue/client"
import { MotionPlugin } from "@vueuse/motion"
import {
  enableKatex,
  enableMermaid,
  preloadExtendedLanguageIcons,
} from "markstream-vue"
import { createPinia } from "pinia"
import "unfonts.css"
import "vue-sonner/style.css"
import { VueFire, VueFireAuth } from "vuefire"
import "xterminal/dist/xterminal.css"
import "~console/theme-detect"

const head = createHead({
  init: [
    {
      title: "Lectornaut",
      titleTemplate: "%s | Lectornaut",
      meta: [{ name: "description", content: "Lectornaut" }],
    },
  ],
})
const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(VueQueryPlugin, { queryClient })
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

// Warm markstream's less common code-block language icons off the critical
// path (they ship as an async chunk) so the first fenced code block in a chat
// bubble or changelog entry doesn't flash the fallback icon.
void preloadExtendedLanguageIcons()

// Order matters: authReady must resolve before router.isReady() so the
// initial navigation guard sees a settled `auth.currentUser`, and before the
// cache restore so we hydrate the signed-in user's cache (logout clears it
// via clearPersistedQueryCache).
await authReady

// The three post-auth stages are mutually independent — the initial-nav guard
// reads only `auth.currentUser`, the theme preload only its stored name — so
// run them concurrently instead of paying their latencies in sequence.
await Promise.all([
  // Restore the persisted read cache for an instant cold start, then begin
  // persisting future changes (the subscribe must not start before the
  // restore completes, hence the chain).
  restoreQueryCache().then(startQueryCachePersistence),
  router.isReady(),
  // Block mount until the active Shiki editor theme is loaded so the Tiptap,
  // CodeMirror, and markstream-vue code surfaces all render on the correct
  // theme background from the first frame instead of flashing a fallback
  // (prose muted / app background / library muted) while the async
  // highlighter loads. Even if it threw, we swallow it — a missing theme
  // falls back to the previous behaviour (empty colors ref).
  preloadActiveCodeTheme().catch(() => {}),
])

app.mount("#app")

// Route schema violations through the project logger + a dev-only toast.
// Reads now validate in prod too: a bad row is reported here and dropped
// (parseSafe) or best-effort'd by the converter — never a silent cast.
// Writes throw SchemaValidationError, which store write paths catch.
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

// Every desktop window (pop-outs included), so not gated on the main one.
// `data-native-font-smoothing` lifts the base `antialiased` rule in
// index.css. Shares the key with appPreferencesStore for live changes.
if (isTauri.value) {
  watch(
    useStorage<boolean>("nativeFontSmoothing", false),
    (enabled) => {
      document.documentElement.toggleAttribute(
        "data-native-font-smoothing",
        enabled
      )
    },
    { immediate: true, flush: "sync" }
  )
}

if (isMainTauriWindow.value) {
  // Re-apply a non-default choice on launch: the Dock tile override only
  // lasts for the process, and an update replacing the .app drops the custom
  // bundle icon. The default needs nothing (the bundled icon, with its system
  // light/dark rendering, is already in place). Shares the `dockIcon` key
  // with appPreferencesStore for live changes.
  const dockIcon = useStorage<DockIconId>("dockIcon", defaultDockIcon)
  const applyDockIcon = (variant: DockIconId) => {
    void invoke("set_dock_icon", { variant }).catch((error: unknown) => {
      console.error("[main] Failed to apply dock icon:", error)
    })
  }
  if (dockIcon.value !== defaultDockIcon) applyDockIcon(dockIcon.value)
  watch(dockIcon, applyDockIcon)

  const automaticUpdates = useStorage<boolean>("automaticUpdates", true)
  if (automaticUpdates.value) {
    const lastUpdateCheck = useStorage<number>("lastUpdateCheck", 0)
    initUpdater().then(() => {
      lastUpdateCheck.value = Date.now()
    })
  }
}

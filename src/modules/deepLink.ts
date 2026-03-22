import { isTauri } from "@/composables/usePlatform"
import { deepLinkExcludedPaths } from "@/helpers/defaults"
import { i18n } from "@/modules/i18n"
import { toast } from "vue-sonner"

const t = i18n.global.t

const TOAST_ID = "open-in-app"

const bannerDismissed = useSessionStorage("openInAppBannerDismissed", false)

function isExcludedPath(): boolean {
  return (deepLinkExcludedPaths as readonly string[]).includes(
    window.location.pathname
  )
}

function buildDeepLink(): string {
  return `lectornaut://${window.location.pathname}${window.location.search}${window.location.hash}`
}

function openInApp() {
  const timeout = setTimeout(() => {
    // If the page is still visible after 2.5s, the app likely isn't installed
    showAppNotFoundToast()
  }, 2500)

  const cleanup = useEventListener(document, "visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(timeout)
      cleanup()
    }
  })

  window.location.href = buildDeepLink()
}

function showOpenInAppToast() {
  toast.info(t("open_in_app.title"), {
    id: TOAST_ID,
    duration: Infinity,
    description: t("open_in_app.description"),
    action: {
      label: t("open_in_app.open"),
      onClick: () => openInApp(),
    },
    onDismiss: () => {
      bannerDismissed.value = true
    },
  })
}

function showAppNotFoundToast() {
  toast.info(t("open_in_app.not_found_title"), {
    id: TOAST_ID,
    duration: Infinity,
    description: t("open_in_app.not_found_description"),
    action: {
      label: t("open_in_app.download"),
      onClick: () => {
        window.open("/download", "_blank")
      },
    },
    onDismiss: () => {
      bannerDismissed.value = true
    },
  })
}

/**
 * On web, auto-redirect to the desktop app via deep link if the preference is enabled.
 * Reads the `openInDesktopApp` flag directly from localStorage to avoid a store dependency.
 * Runs once on initial page load — not on SPA navigations.
 *
 * When auto-redirect is disabled, shows a toast prompt instead.
 */
export function initDeepLink() {
  if (isTauri.value) return
  if (isExcludedPath()) return

  const stored = localStorage.getItem("openInDesktopApp")

  // Default is true (matches useStorage default), so only skip redirect if explicitly "false"
  if (stored === "false") {
    // Auto-redirect disabled — show the toast instead (unless dismissed this session)
    if (!bannerDismissed.value) {
      showOpenInAppToast()
    }
    return
  }

  window.location.href = buildDeepLink()
}

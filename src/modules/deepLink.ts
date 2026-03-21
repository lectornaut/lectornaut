import { isTauri } from "@/composables/usePlatform"
import { deepLinkExcludedPaths } from "@/helpers/defaults"

/**
 * On web, auto-redirect to the desktop app via deep link if the preference is enabled.
 * Reads the `openInDesktopApp` flag directly from localStorage to avoid a store dependency.
 * Runs once on initial page load — not on SPA navigations.
 */
export function initDeepLink() {
  if (isTauri.value) return

  const stored = localStorage.getItem("openInDesktopApp")
  // Default is true (matches useStorage default), so only skip if explicitly "false"
  if (stored === "false") return

  const path = window.location.pathname
  if ((deepLinkExcludedPaths as readonly string[]).includes(path)) return

  window.location.href = `lectornaut://${window.location.pathname}${window.location.search}${window.location.hash}`
}

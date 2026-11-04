import { isTauri } from "@/composables/usePlatform"
import { auth } from "@/modules/firebase"
import NProgress from "nprogress"
import { setupLayouts } from "virtual:generated-layouts"
import { createRouter, createWebHistory } from "vue-router"
import { handleHotUpdate, routes } from "vue-router/auto-routes"

NProgress.configure({ showSpinner: false })

/**
 * Scroll a `#hash` target into view, wherever it lives.
 *
 * The router's own `{ el }` result scrolls the WINDOW, but every layout here
 * scrolls an inner container (ScrollContainer / `overflow-auto` shells), so
 * it silently did nothing. `scrollIntoView` scrolls whichever ancestor
 * actually scrolls and honours the target's `scroll-mt-*`.
 *
 * On a cold load (or a navigation to a lazily-rendered page) the target may
 * not exist yet when scrollBehavior runs, so wait for it, then for fonts, so
 * the jump measures final line heights. `getElementById` rather than
 * `querySelector`: ids like "2.9.0" aren't valid CSS selectors.
 *
 * ponytail: polls every 50ms for up to 3s; swap for a MutationObserver if a
 * page ever renders its anchor later than that.
 */
const scrollToHash = async (hash: string, behavior: ScrollBehavior) => {
  const id = decodeURIComponent(hash.slice(1))
  const el = await waitFor(() => document.getElementById(id))
  if (!el) return
  await document.fonts.ready
  el.scrollIntoView({ behavior, block: "start" })
}

/** ponytail: 50ms poll capped at 3s, shared by every scroll path below. */
const waitFor = async <T>(probe: () => T | null | false): Promise<T | null> => {
  for (let waited = 0; waited <= 3000; waited += 50) {
    const found = probe()
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

/**
 * Layout-level page scroller: the one element that survives navigations
 * between pages of a layout (landing's ScrollContainer), marked with
 * `data-route-scroller`. Pages that own their scroller mount fresh at the top
 * and need nothing. The router's own top/savedPosition handling only knows
 * the window, so it never reached this element.
 */
const getRouteScroller = () =>
  document.querySelector<HTMLElement>("[data-route-scroller]")

/**
 * Back/forward restore. The router records WINDOW offsets per history entry
 * (always 0 here), so track the page scroller ourselves, keyed by the
 * router's `history.state.position` — the same key the router uses. Scroll
 * events don't bubble, hence the capture listener; it also follows the
 * scroller across layout remounts without re-binding.
 */
const scrollerPositions = new Map<number, number>()
const historyPosition = () =>
  typeof history.state?.position === "number" ? history.state.position : -1

document.addEventListener(
  "scroll",
  (event) => {
    const target = event.target
    if (
      target instanceof HTMLElement &&
      target.hasAttribute("data-route-scroller")
    ) {
      scrollerPositions.set(historyPosition(), target.scrollTop)
    }
  },
  { capture: true, passive: true }
)

const restoreScroller = async () => {
  const top = scrollerPositions.get(historyPosition()) ?? 0
  // Wait until the page has rendered tall enough to reach the saved offset.
  const scroller =
    (await waitFor(() => {
      const el = getRouteScroller()
      return el && el.scrollHeight - el.clientHeight >= top && el
    })) ?? getRouteScroller()
  scroller?.scrollTo({ top, behavior: "instant" })
}

const resetScroller = () => {
  // A new entry may reuse a history position number we saved earlier (go
  // back, then push) — start it clean so a later back/forward restores 0.
  scrollerPositions.set(historyPosition(), 0)
  getRouteScroller()?.scrollTo({ top: 0, behavior: "instant" })
}

/**
 * Vue Router Configuration
 * Sets up formatting for the router using 'createWebHistory' and 'setupLayouts'
 */
const router = createRouter({
  history: createWebHistory(),
  routes: setupLayouts([...routes]),
  // Every branch returns `false`: the window never scrolls in this app, so
  // the helpers above drive the actual scroll container instead.
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition && from.matched.length) {
      // Back/forward: put the page back where the user left it. (On a cold
      // load / reload the router can still hand over a stale WINDOW offset;
      // with no previous route that falls through to the hash / top logic.)
      void restoreScroller()
    } else if (to.hash) {
      // A cold load (no matched `from`) jumps straight there, like a normal
      // permalink visit; in-app clicks and navigations glide.
      void scrollToHash(to.hash, from.matched.length ? "smooth" : "instant")
    } else if (to.path !== from.path) {
      // New page: start at the top. (Query-only changes — filters, tabs —
      // keep their place.)
      resetScroller()
    }
    return false
  },
})

if (import.meta.hot) {
  handleHotUpdate(router)
}

// Snapshot the page scroller as we leave an entry. On a push, `history.state`
// still describes the page being left, so this is exact and needs no scroll
// event (those are frame-driven and can lag the click). On back/forward the
// browser has already swapped `history.state`, so skip — the scroll listener
// above has the leaving entry's last position.
router.beforeEach((_to, from) => {
  const scroller = getRouteScroller()
  if (scroller && history.state?.current === from.fullPath) {
    scrollerPositions.set(historyPosition(), scroller.scrollTop)
  }
})

/**
 * Navigation Guard: Global Before Each
 * Handles redirects based on authentication state and environment (Tauri vs Web)
 */
// Synchronous because `authReady` (awaited at app startup in main.ts) has
// already settled `auth.currentUser`. Async guards here would re-introduce
// per-navigation races on HMR-triggered re-navigation.
router.beforeEach((to, from) => {
  const user = auth.currentUser

  // Tauri has no marketing landing — always route the root somewhere useful.
  // Skip the /enter hop when already authenticated; otherwise App.vue would
  // immediately redirect /enter → /start anyway.
  if (to.name === "/" && isTauri.value) {
    return { path: user ? "/start" : "/enter" }
  }

  if (to.meta.requiresUser && !user) {
    return {
      path: "/enter",
      query: {
        redirect: to.fullPath,
      },
    }
  }

  if (to.meta.requiresGuest && user) {
    return {
      path:
        typeof to.query.redirect === "string" ? to.query.redirect : "/start",
    }
  }

  if (to.path !== from.path) NProgress.start()
})

router.afterEach(() => {
  NProgress.done()
})

router.onError((error, to) => {
  NProgress.done()
  console.error(`[router] navigation to ${to.path} failed:`, error)
})

export { router }

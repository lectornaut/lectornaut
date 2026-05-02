import { isTauri } from "@/composables/usePlatform"
import { auth } from "@/modules/firebase"
import NProgress from "nprogress"
import { setupLayouts } from "virtual:generated-layouts"
import { createRouter, createWebHistory } from "vue-router"
import { handleHotUpdate, routes } from "vue-router/auto-routes"

NProgress.configure({ showSpinner: false })

/**
 * Vue Router Configuration
 * Sets up formatting for the router using 'createWebHistory' and 'setupLayouts'
 */
const router = createRouter({
  history: createWebHistory(),
  routes: setupLayouts([...routes]),
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else if (to.hash) {
      return {
        el: to.hash,
        behavior: "smooth",
      }
    } else {
      return { top: 0, behavior: "smooth" }
    }
  },
})

if (import.meta.hot) {
  handleHotUpdate(router)
}

/**
 * Navigation Guard: Global Before Each
 * Handles redirects based on authentication state and environment (Tauri vs Web)
 */
// Synchronous because `authReady` (awaited at app startup in main.ts) has
// already settled `auth.currentUser`. Async guards here would re-introduce
// per-navigation races on HMR-triggered re-navigation.
router.beforeEach((to, from) => {
  if (to.name === "/" && isTauri.value) {
    return { path: "/enter" }
  }

  const user = auth.currentUser

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

export { router }

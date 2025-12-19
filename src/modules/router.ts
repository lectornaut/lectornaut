import { isTauri } from "@/composables/usePlatform"
import NProgress from "nprogress"
import { setupLayouts } from "virtual:generated-layouts"
import { createRouter, createWebHistory } from "vue-router"
import { handleHotUpdate, routes } from "vue-router/auto-routes"
import { getCurrentUser } from "vuefire"

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
router.beforeEach(async (to, from) => {
  // Redirect root to /enter in Tauri environment
  if (to.name === "/") {
    if (isTauri.value) {
      router.push("/enter")
    }
  }

  // Check for routes requiring authentication
  if (to.meta.requiresUser) {
    const user = await getCurrentUser()
    if (!user) {
      return {
        path: "/enter",
        query: {
          redirect: to.fullPath,
        },
      }
    }
  }

  // Check for routes restricted to guests (e.g., login page)
  if (to.meta.requiresGuest) {
    const user = await getCurrentUser()
    if (user) {
      return {
        path:
          typeof to.query.redirect === "string" ? to.query.redirect : "/home",
      }
    }
  }

  if (to.path !== from.path) NProgress.start()
})

router.afterEach(() => {
  NProgress.done()
})

export { router }

import { isTauri } from "@/helpers/utilities"
import NProgress from "nprogress"
import { setupLayouts } from "virtual:generated-layouts"
import { createRouter, createWebHistory } from "vue-router/auto"
import { routes } from "vue-router/auto-routes"
import { getCurrentUser } from "vuefire"

NProgress.configure({ showSpinner: false })

const router = createRouter({
  history: createWebHistory(),
  routes: setupLayouts(routes),
  scrollBehavior(to) {
    if (to.hash) {
      return {
        el: to.hash,
        behavior: "smooth",
      }
    } else {
      return { top: 0, behavior: "smooth" }
    }
  },
})

router.beforeEach(async (to, from) => {
  if (to.name === "/") {
    if (isTauri.value) {
      router.push("/feed")
    }
  }

  if (to.meta.requiresUser) {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return {
        path: "/enter",
        query: {
          redirect: to.fullPath,
        },
      }
    }
  }

  if (to.meta.requiresGuest) {
    const currentUser = await getCurrentUser()
    if (currentUser) {
      return {
        path: "/home",
      }
    }
  }

  if (to.path !== from.path) NProgress.start()
})

router.afterEach(() => {
  NProgress.done()
})

export { router }

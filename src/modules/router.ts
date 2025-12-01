import { isTauri } from "@/helpers/utilities"
import NProgress from "nprogress"
import { setupLayouts } from "virtual:generated-layouts"
import { createRouter, createWebHistory } from "vue-router"
import { handleHotUpdate, routes } from "vue-router/auto-routes"
import { getCurrentUser } from "vuefire"

NProgress.configure({ showSpinner: false })

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

router.beforeEach(async (to, from) => {
  if (to.name === "/") {
    if (isTauri.value) {
      router.push("/enter")
    }
  }

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

  if (to.meta.requiresGuest) {
    const user = await getCurrentUser()
    if (user) {
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

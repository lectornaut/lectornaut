import { afterEach, beforeAll, vi } from "vitest"

beforeAll(() => {
  document.documentElement.setAttribute("data-theme", "auto")
  document.documentElement.setAttribute("data-accent", "neutral")
  document.documentElement.setAttribute("data-font", "sans")
  document.documentElement.setAttribute("data-size", "sm")
  document.documentElement.setAttribute("data-zoom", "100")
})

afterEach(() => {
  vi.clearAllMocks()
})

const globalAny = globalThis as typeof globalThis & {
  ResizeObserver?: typeof ResizeObserver
  matchMedia?: typeof window.matchMedia
}

if (!globalAny.ResizeObserver) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalAny.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
}

if (!globalAny.matchMedia) {
  globalAny.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
  })
}

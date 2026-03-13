import { useLayoutStore } from "@/stores/layoutStore"
import type { LayoutTabIndicator } from "@/types/layout"
import { storeToRefs } from "pinia"
import type { MaybeRefOrGetter } from "vue"
import { onBeforeUnmount, toValue, watchEffect } from "vue"

export function useActiveTabIndicator(
  indicator: MaybeRefOrGetter<LayoutTabIndicator | null | undefined>
) {
  const layoutStore = useLayoutStore()
  const { activeTabId } = storeToRefs(layoutStore)
  const { clearTabIndicator, setTabIndicator } = layoutStore
  let currentTabId: string | null = null

  watchEffect(() => {
    const nextTabId = activeTabId.value || null
    const nextIndicator = toValue(indicator) ?? null

    if (currentTabId && currentTabId !== nextTabId) {
      clearTabIndicator(currentTabId)
    }

    if (!nextTabId) {
      currentTabId = null
      return
    }

    if (nextIndicator) {
      setTabIndicator(nextTabId, nextIndicator)
    } else {
      clearTabIndicator(nextTabId)
    }

    currentTabId = nextTabId
  })

  onBeforeUnmount(() => {
    if (currentTabId) {
      clearTabIndicator(currentTabId)
    }
  })
}

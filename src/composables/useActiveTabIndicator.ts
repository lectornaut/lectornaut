import { useTabsStore } from "@/stores/tabsStore"
import type { LayoutTabIndicator } from "@/types/layout"
import { storeToRefs } from "pinia"
import type { MaybeRefOrGetter } from "vue"
import { onBeforeUnmount, toValue, watchEffect } from "vue"

export function useActiveTabIndicator(
  indicator: MaybeRefOrGetter<LayoutTabIndicator | null | undefined>
) {
  const tabsStore = useTabsStore()
  const { activeTabId } = storeToRefs(tabsStore)
  const { clearTabIndicator, setTabIndicator } = tabsStore
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

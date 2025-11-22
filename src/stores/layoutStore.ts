import { menu } from "@/helpers/defaults"
import { generateId } from "@/helpers/utilities"
import { collection, doc, setDoc } from "firebase/firestore"
import { defineStore } from "pinia"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

type Tab = {
  id: string
  name: string
  fullPath: string
}

export const useLayoutStore = defineStore("layout", () => {
  const db = useFirestore()
  const user = useCurrentUser()

  // --- State ---

  const tabs = ref<Tab[]>([])
  const activeTabId = ref("")
  const recentlyClosed = ref<Tab[]>([])
  const activeNavItems = ref<typeof menu>([])

  // --- Firestore Refs ---

  const tabsDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(
      collection(doc(collection(db, "users"), user.value.uid), "layout"),
      "tabs"
    )
  })

  const navigationDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(
      collection(doc(collection(db, "users"), user.value.uid), "layout"),
      "navigation"
    )
  })

  // --- Hydration (VueFire) ---

  const { data: tabsDocData, pending: tabsPending } = useDocument(tabsDocRef)
  const { data: navDocData, pending: navPending } =
    useDocument(navigationDocRef)

  const isLoading = computed(() => tabsPending.value || navPending.value)

  // Watch Tabs Data
  watch(
    tabsDocData,
    (doc) => {
      if (!doc) return
      tabs.value = doc.tabs ?? []
      activeTabId.value = doc.active ?? ""
      recentlyClosed.value = doc.recentlyClosed ?? []
    },
    { immediate: true }
  )

  // Watch Navigation Data
  watch(
    navDocData,
    (doc) => {
      if (!doc) {
        activeNavItems.value = [...menu]
        return
      }

      const savedVisibility = doc.visibleItems || {}
      const savedOrder: string[] = doc.order || []

      const visibleIds = new Set<string>()
      for (const item of menu) {
        if (savedVisibility[item.id] !== false) {
          visibleIds.add(item.id)
        }
      }

      const newActiveItems: typeof menu = []
      const processedIds = new Set<string>()

      for (const id of savedOrder) {
        const item = menu.find((i) => i.id === id)
        if (item && visibleIds.has(id)) {
          newActiveItems.push(item)
          processedIds.add(id)
        }
      }

      for (const item of menu) {
        if (visibleIds.has(item.id) && !processedIds.has(item.id)) {
          newActiveItems.push(item)
        }
      }

      activeNavItems.value = newActiveItems
    },
    { immediate: true }
  )

  // --- Persistence ---

  // Persist Tabs
  watchDebounced(
    [tabs, activeTabId, recentlyClosed],
    ([newTabs, newActive, newRecent]) => {
      if (!tabsDocRef.value) return
      setDoc(
        tabsDocRef.value,
        { tabs: newTabs, active: newActive, recentlyClosed: newRecent },
        { merge: true }
      )
    },
    { debounce: 500, deep: true }
  )

  // Persist Navigation
  watchDebounced(
    activeNavItems,
    (newItems) => {
      if (!navigationDocRef.value) return

      const visibleItems: Record<string, boolean> = {}
      const order = newItems.map((item) => item.id)
      const activeIds = new Set(order)

      for (const item of menu) {
        visibleItems[item.id] = activeIds.has(item.id)
      }

      setDoc(navigationDocRef.value, { visibleItems, order }, { merge: true })
    },
    { debounce: 500, deep: true }
  )

  // --- Actions: Tabs ---

  function createTab(fullPath: string, name?: string): Tab {
    if (name) {
      return { id: generateId(), name, fullPath }
    }
    // Note: Router resolution usually happens in component,
    // but we can pass the resolved name or handle it here if we had access to router.
    // For now, we'll expect the component to pass a name or we use a default.
    return { id: generateId(), name: "New Tab", fullPath }
  }

  function addTab(fullPath = "/new", name = "New Tab") {
    const newTab = createTab(fullPath, name)
    tabs.value.push(newTab)
    activeTabId.value = newTab.id
    return newTab
  }

  function addToHistory(tab: Tab) {
    const head = recentlyClosed.value[0]
    if (head?.fullPath === tab.fullPath && head?.name === tab.name) return
    recentlyClosed.value = [
      { id: generateId(), name: tab.name, fullPath: tab.fullPath },
      ...recentlyClosed.value,
    ].slice(0, 20)
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return null

    const closing = tabs.value[idx]
    if (!closing) return null

    addToHistory(closing)
    tabs.value.splice(idx, 1)

    if (tabs.value.length === 0) {
      activeTabId.value = ""
      return { nextPath: "/start" }
    }

    if (closing.id === activeTabId.value) {
      const nextTab = tabs.value[idx] || tabs.value[idx - 1]
      if (nextTab) {
        activeTabId.value = nextTab.id
        return { nextPath: nextTab.fullPath }
      }
    }
    return null
  }

  function closeOtherTabs(keepId: string) {
    const keep = tabs.value.find((t) => t.id === keepId)
    if (!keep) return
    tabs.value.forEach((t) => {
      if (t.id !== keepId) addToHistory(t)
    })
    tabs.value = [keep]
    activeTabId.value = keep.id
  }

  function closeAllTabs() {
    tabs.value.forEach(addToHistory)
    tabs.value = []
    activeTabId.value = ""
  }

  function duplicateTab(id: string) {
    const src = tabs.value.find((t) => t.id === id)
    if (!src) return
    const duplicate = createTab(
      src.fullPath,
      src.name.endsWith(" (Copy)") ? src.name : `${src.name} (Copy)`
    )
    tabs.value.push(duplicate)
    activeTabId.value = duplicate.id
  }

  function renameTab(id: string, newName: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab && newName.trim()) {
      tab.name = newName.trim()
    }
  }

  function setActiveTab(id: string) {
    activeTabId.value = id
  }

  function updateActiveTab(fullPath: string, name?: string) {
    if (!activeTabId.value) return
    const activeTab = tabs.value.find((t) => t.id === activeTabId.value)
    if (activeTab) {
      activeTab.fullPath = fullPath
      if (name) activeTab.name = name
    }
  }

  // --- Actions: Navigation ---

  function toggleNavItem(itemId: string, checked: boolean) {
    if (checked) {
      const item = menu.find((i) => i.id === itemId)
      if (item && !activeNavItems.value.some((i) => i.id === itemId)) {
        activeNavItems.value.push(item)
      }
    } else {
      const idx = activeNavItems.value.findIndex((i) => i.id === itemId)
      if (idx !== -1) {
        activeNavItems.value.splice(idx, 1)
      }
    }
  }

  function setNavItems(items: typeof menu) {
    activeNavItems.value = items
  }

  function resetNavItems() {
    activeNavItems.value = [...menu]
  }

  return {
    // State
    tabs,
    activeTabId,
    recentlyClosed,
    activeNavItems,
    isLoading,

    // Actions
    addTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    duplicateTab,
    renameTab,
    setActiveTab,
    updateActiveTab,
    toggleNavItem,
    setNavItems,
    resetNavItems,
    addToHistory,
  }
})

import {
  defaultAccent,
  defaultFont,
  defaultLanguage,
  defaultMenu,
  defaultSize,
} from "@/helpers/defaults"
import { generateId } from "@/helpers/utilities"
import { useStorage, watchDebounced } from "@vueuse/core"
import { collection, doc, setDoc } from "firebase/firestore"
import { defineStore } from "pinia"
import { computed, reactive, ref, watch } from "vue"
import { useCurrentUser, useDocument, useFirestore } from "vuefire"

export type Tab = {
  id: string
  name: string
  fullPath: string
}

export type NavItem = (typeof defaultMenu)[number]

export type ThemeMode = "light" | "dark" | "accent" | "auto"

export const useLayoutStore = defineStore("layout", () => {
  const db = useFirestore()
  const user = useCurrentUser()

  // --- State ---

  // Pre-load from localStorage to avoid flash
  const mode = useStorage<ThemeMode>("theme", "auto")
  const accent = useStorage("accent", defaultAccent)
  const font = useStorage("font", defaultFont)
  const size = useStorage("size", defaultSize)
  const language = useStorage("language", defaultLanguage)

  const tabs = ref<Tab[]>([])
  const activeTabId = ref("")
  const recentlyClosed = ref<Tab[]>([])
  const activeNavItems = ref<NavItem[]>([])
  const isHydrated = ref(false)

  // Theme State - use storage refs directly to avoid double-wrapping
  const themeSettings = reactive({
    mode,
    accent,
    font,
    size,
    language,
  })

  // --- Computed ---

  const activeTab = computed(() =>
    tabs.value.find((t) => t.id === activeTabId.value)
  )

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

  const themeDocRef = computed(() => {
    if (!user.value?.uid) return null
    return doc(
      collection(doc(collection(db, "users"), user.value.uid), "layout"),
      "theme"
    )
  })

  // --- Hydration (VueFire) ---

  const { data: tabsDocData, pending: tabsPending } = useDocument(tabsDocRef)
  const { data: navDocData, pending: navPending } =
    useDocument(navigationDocRef)
  const { data: themeDocData, pending: themePending } = useDocument(themeDocRef)

  const isLoading = computed(
    () =>
      (tabsPending.value || navPending.value || themePending.value) &&
      !isHydrated.value
  )

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
        if (!navPending.value) {
          activeNavItems.value = [...defaultMenu]
        }
        return
      }

      const savedVisibility = doc.visibleItems || {}
      const savedOrder: string[] = doc.order || []

      const visibleIds = new Set<string>()
      for (const item of defaultMenu) {
        if (savedVisibility[item.id] !== false) {
          visibleIds.add(item.id)
        }
      }

      const newActiveItems: NavItem[] = []
      const processedIds = new Set<string>()

      for (const id of savedOrder) {
        const item = defaultMenu.find((i) => i.id === id)
        if (item && visibleIds.has(id)) {
          newActiveItems.push(item)
          processedIds.add(id)
        }
      }

      for (const item of defaultMenu) {
        if (visibleIds.has(item.id) && !processedIds.has(item.id)) {
          newActiveItems.push(item)
        }
      }

      activeNavItems.value = newActiveItems
    },
    { immediate: true }
  )

  // Sync Firestore theme data back to localStorage (optional: override localStorage with server values if needed)
  watch(
    themeDocData,
    (doc) => {
      if (!doc) return
      // Only sync if values differ (avoids unnecessary localStorage writes)
      // Use 'in' operator to check for key existence rather than truthy value
      if ("mode" in doc && doc.mode !== mode.value) mode.value = doc.mode
      if ("accent" in doc && doc.accent !== accent.value)
        accent.value = doc.accent
      if ("font" in doc && doc.font !== font.value) font.value = doc.font
      if ("size" in doc && doc.size !== size.value) size.value = doc.size
      if ("language" in doc && doc.language !== language.value)
        language.value = doc.language
    },
    { immediate: true }
  )

  // Set isHydrated when all critical documents are loaded or failed to load
  watch(
    [tabsPending, navPending, themePending],
    ([tp, np, thp]) => {
      if (!tp && !np && !thp) {
        isHydrated.value = true
      }
    },
    { immediate: true }
  )

  // --- Persistence ---

  // Helper to safely persist to Firestore with error handling
  async function safeSetDoc(
    docRef: ReturnType<typeof doc> | null,
    data: Record<string, unknown>
  ): Promise<void> {
    if (!docRef) return
    try {
      await setDoc(docRef, data, { merge: true })
    } catch (error) {
      console.error("[layoutStore] Failed to persist to Firestore:", error)
    }
  }

  // Persist Tabs
  watchDebounced(
    [tabs, activeTabId, recentlyClosed],
    ([newTabs, newActive, newRecent]) => {
      safeSetDoc(tabsDocRef.value, {
        tabs: newTabs,
        active: newActive,
        recentlyClosed: newRecent,
      })
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

      for (const item of defaultMenu) {
        visibleItems[item.id] = activeIds.has(item.id)
      }

      safeSetDoc(navigationDocRef.value, { visibleItems, order })
    },
    { debounce: 500, deep: true }
  )

  // Persist Theme
  watchDebounced(
    [mode, accent, font, size, language],
    ([m, a, f, s, l]) => {
      safeSetDoc(themeDocRef.value, {
        mode: m,
        accent: a,
        font: f,
        size: s,
        language: l,
      })
    },
    { debounce: 500 }
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
      {
        id: generateId(),
        name: tab.name,
        fullPath: tab.fullPath,
      },
      ...recentlyClosed.value,
    ].slice(0, 20)
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return null

    const closing = tabs.value[idx]
    if (!closing) return null

    addToHistory(closing)

    // Prepare new state
    const newTabs = [...tabs.value]
    newTabs.splice(idx, 1)

    let nextPath: string | null = null
    let nextId = activeTabId.value

    if (newTabs.length === 0) {
      nextId = ""
      nextPath = "/start"
    } else if (closing.id === activeTabId.value) {
      const nextTab = newTabs[idx] || newTabs[idx - 1]
      if (nextTab) {
        nextId = nextTab.id
        nextPath = nextTab.fullPath
      }
    }

    // Apply updates atomically-ish
    tabs.value = newTabs
    activeTabId.value = nextId

    // Persist immediately for critical action
    safeSetDoc(tabsDocRef.value, {
      tabs: newTabs,
      active: nextId,
      recentlyClosed: recentlyClosed.value,
    })

    return nextPath ? { nextPath } : null
  }

  function closeOtherTabs(keepId: string) {
    const keep = tabs.value.find((t) => t.id === keepId)
    if (!keep) return
    // Collect tabs to close first to avoid modifying array while iterating
    const tabsToClose = tabs.value.filter((t) => t.id !== keepId)
    tabsToClose.forEach(addToHistory)
    tabs.value = [keep]
    activeTabId.value = keep.id
  }

  function closeAllTabs() {
    // Copy array before iterating to avoid modification issues
    const tabsToClose = [...tabs.value]
    tabsToClose.forEach(addToHistory)
    tabs.value = []
    activeTabId.value = ""
  }

  function clearRecentlyClosed() {
    recentlyClosed.value = []
  }

  function reopenLastClosed(): Tab | null {
    if (recentlyClosed.value.length === 0) return null
    const [last, ...rest] = recentlyClosed.value
    if (!last) return null
    recentlyClosed.value = rest
    return last
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
      const item = defaultMenu.find((i) => i.id === itemId)
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

  function setNavItems(items: NavItem[]) {
    activeNavItems.value = items
  }

  function resetNavItems() {
    activeNavItems.value = [...defaultMenu]
  }

  return {
    // State
    tabs,
    activeTabId,
    activeTab,
    recentlyClosed,
    activeNavItems,
    themeSettings,
    isLoading,
    isHydrated,

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
    clearRecentlyClosed,
    reopenLastClosed,
  }
})

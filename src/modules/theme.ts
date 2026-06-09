import { isTauri } from "@/composables/usePlatform"
import type {
  AccentId,
  BaseId,
  EditorFontSizeId,
  EditorThemeId,
  FontId,
  SizeId,
} from "@/helpers/defaults"
import {
  defaultCustomAccentColor,
  defaultCustomBaseColor,
} from "@/helpers/defaults"
import { useThemeStore } from "@/stores/themeStore"
import type { ThemeMode } from "@/types/settings"
import {
  buildCustomAccentTokens,
  buildCustomBaseTokens,
  CUSTOM_ACCENT_TOKEN_NAMES,
  CUSTOM_BASE_TOKEN_NAMES,
  normalizeHexColor,
  type ResolvedThemeMode,
} from "@/utils/theme/customTheme"
import { setTheme } from "@tauri-apps/api/app"
import { storeToRefs } from "pinia"

export const { store, system, state } = useColorMode({
  attribute: "data-theme",
  storageKey: "theme",
})

let hasInitializedTheme = false

export const initTheme = () => {
  if (hasInitializedTheme) return
  hasInitializedTheme = true

  const themeStore = useThemeStore()
  const { themeSettings } = storeToRefs(themeStore)

  watch(
    () => themeSettings.value.mode,
    (value) => {
      if (value && value !== store.value) {
        store.value = value
      }
    },
    { immediate: true, flush: "sync" }
  )

  watch(
    store,
    (value) => {
      if (value && value !== themeSettings.value.mode) {
        themeSettings.value.mode = value as ThemeMode
      }
    },
    { flush: "sync" }
  )

  watch(
    [
      state,
      () => themeSettings.value.base,
      () => themeSettings.value.accent,
      () => themeSettings.value.font,
      () => themeSettings.value.size,
      () => themeSettings.value.customBaseColor,
      () => themeSettings.value.customAccentColor,
    ],
    ([
      resolvedTheme,
      selectedBase,
      selectedAccent,
      selectedFont,
      selectedSize,
      selectedCustomBaseColor,
      selectedCustomAccentColor,
    ]) => {
      applyThemeAttributes({
        base: selectedBase,
        accent: selectedAccent,
        font: selectedFont,
        size: selectedSize,
      })

      const resolvedMode = toResolvedThemeMode(resolvedTheme)
      const baseSourceColor = getCustomBaseSourceColor(
        selectedBase,
        selectedAccent,
        selectedCustomBaseColor,
        selectedCustomAccentColor
      )
      const accentSourceColor = getCustomAccentSourceColor(
        selectedBase,
        selectedAccent,
        selectedCustomBaseColor,
        selectedCustomAccentColor
      )

      applyManagedThemeTokens(
        CUSTOM_BASE_TOKEN_NAMES,
        baseSourceColor
          ? buildCustomBaseTokens(baseSourceColor, resolvedMode)
          : null
      )
      applyManagedThemeTokens(
        CUSTOM_ACCENT_TOKEN_NAMES,
        accentSourceColor
          ? buildCustomAccentTokens(accentSourceColor, resolvedMode)
          : null
      )
    },
    { immediate: true, flush: "sync" }
  )

  watch(
    () => themeSettings.value.reducedMotion,
    (enabled) => {
      applyReducedMotion(enabled)
    },
    { immediate: true, flush: "sync" }
  )

  if (isTauri.value) {
    watch(
      store,
      (value) => {
        void syncTauriTheme(value)
      },
      { immediate: true, flush: "sync" }
    )
  }
}

// Mirrors the `prefers-reduced-motion` opt-out as a user-controlled toggle.
// `data-reduced-motion` on <html> is matched by a global kill-switch in
// `src/styles/index.css`. We add/remove the attribute (rather than set
// "false") so the CSS can use a bare `[data-reduced-motion]` presence
// selector. `flush: "sync"` above sets it before first paint to avoid a
// flash of motion on load.
function applyReducedMotion(enabled: boolean) {
  const root = document.documentElement

  if (enabled) {
    root.setAttribute("data-reduced-motion", "")
  } else {
    root.removeAttribute("data-reduced-motion")
  }
}

function applyManagedThemeTokens(
  tokenNames: readonly string[],
  tokens: Record<string, string> | null
) {
  const root = document.documentElement

  for (const tokenName of tokenNames) {
    if (tokens) {
      root.style.setProperty(tokenName, tokens[tokenName] ?? "")
      continue
    }

    root.style.removeProperty(tokenName)
  }
}

function applyThemeAttributes(attributes: Record<string, string>) {
  const root = document.documentElement

  for (const [name, value] of Object.entries(attributes)) {
    const attributeName = `data-${name}`

    if (root.getAttribute(attributeName) !== value) {
      root.setAttribute(attributeName, value)
    }
  }
}

function toResolvedThemeMode(value: string): ResolvedThemeMode {
  return value === "dark" ? "dark" : "light"
}

async function syncTauriTheme(value: string) {
  switch (value) {
    case "light":
      await setTheme("light")
      return
    case "dark":
      await setTheme("dark")
      return
    case "auto":
    default:
      await setTheme(null)
  }
}

function getCustomBaseSourceColor(
  selectedBase: BaseId,
  selectedAccent: AccentId,
  selectedCustomBaseColor: string,
  selectedCustomAccentColor: string
): string | null {
  if (selectedBase === "custom") {
    return normalizeHexColor(selectedCustomBaseColor, defaultCustomBaseColor)
  }

  if (selectedBase === "accent" && selectedAccent === "custom") {
    return normalizeHexColor(
      selectedCustomAccentColor,
      defaultCustomAccentColor
    )
  }

  return null
}

function getCustomAccentSourceColor(
  selectedBase: BaseId,
  selectedAccent: AccentId,
  selectedCustomBaseColor: string,
  selectedCustomAccentColor: string
): string | null {
  if (selectedAccent === "custom") {
    return normalizeHexColor(
      selectedCustomAccentColor,
      defaultCustomAccentColor
    )
  }

  if (selectedAccent === "base" && selectedBase === "custom") {
    return normalizeHexColor(selectedCustomBaseColor, defaultCustomBaseColor)
  }

  return null
}

export const accent = computed({
  get: () => {
    const themeStore = useThemeStore()
    return themeStore.themeSettings.accent
  },
  set: (value: AccentId) => {
    const themeStore = useThemeStore()
    themeStore.themeSettings.accent = value
  },
})

export const base = computed({
  get: () => {
    const themeStore = useThemeStore()
    return themeStore.themeSettings.base
  },
  set: (value: BaseId) => {
    const themeStore = useThemeStore()
    themeStore.themeSettings.base = value
  },
})

export const font = computed({
  get: () => {
    const themeStore = useThemeStore()
    return themeStore.themeSettings.font
  },
  set: (value: FontId) => {
    const themeStore = useThemeStore()
    themeStore.themeSettings.font = value
  },
})

export const size = computed({
  get: () => {
    const themeStore = useThemeStore()
    return themeStore.themeSettings.size
  },
  set: (value: SizeId) => {
    const themeStore = useThemeStore()
    themeStore.themeSettings.size = value
  },
})

export const editorTheme = computed({
  get: () => {
    const themeStore = useThemeStore()
    return themeStore.themeSettings.editorTheme
  },
  set: (value: EditorThemeId) => {
    const themeStore = useThemeStore()
    themeStore.themeSettings.editorTheme = value
  },
})

export const editorFontSize = computed({
  get: () => {
    const themeStore = useThemeStore()
    return themeStore.themeSettings.editorFontSize
  },
  set: (value: EditorFontSizeId) => {
    const themeStore = useThemeStore()
    themeStore.themeSettings.editorFontSize = value
  },
})

export const customBaseColor = computed({
  get: () => {
    const themeStore = useThemeStore()
    return themeStore.themeSettings.customBaseColor
  },
  set: (value: string) => {
    const themeStore = useThemeStore()
    themeStore.themeSettings.customBaseColor = normalizeHexColor(
      value,
      defaultCustomBaseColor
    )
  },
})

export const customAccentColor = computed({
  get: () => {
    const themeStore = useThemeStore()
    return themeStore.themeSettings.customAccentColor
  },
  set: (value: string) => {
    const themeStore = useThemeStore()
    themeStore.themeSettings.customAccentColor = normalizeHexColor(
      value,
      defaultCustomAccentColor
    )
  },
})

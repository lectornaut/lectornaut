import { isTauri } from "@/composables/usePlatform"
import type { AccentId, BaseId, FontId, SizeId } from "@/helpers/defaults"
import {
  defaultCustomAccentColor,
  defaultCustomBaseColor,
} from "@/helpers/defaults"
import { useSettingsStore } from "@/stores/settingsStore"
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

export const initTheme = () => {
  const settingsStore = useSettingsStore()
  const { themeSettings } = storeToRefs(settingsStore)

  watch(
    () => themeSettings.value.mode,
    (value) => {
      if (value && value !== store.value) {
        store.value = value
      }
    },
    { immediate: true }
  )

  watch(store, (value) => {
    if (value && value !== themeSettings.value.mode) {
      themeSettings.value.mode = value as ThemeMode
    }
  })

  watch(
    () => themeSettings.value.accent,
    (value) => {
      document.documentElement.setAttribute("data-accent", value)
    },
    { immediate: true }
  )

  watch(
    () => themeSettings.value.base,
    (value) => {
      document.documentElement.setAttribute("data-base", value)
    },
    { immediate: true }
  )

  watch(
    () => themeSettings.value.font,
    (value) => {
      document.documentElement.setAttribute("data-font", value)
    },
    { immediate: true }
  )

  watch(
    () => themeSettings.value.size,
    (value) => {
      document.documentElement.setAttribute("data-size", value)
    },
    { immediate: true }
  )

  watch(
    [
      state,
      () => themeSettings.value.base,
      () => themeSettings.value.accent,
      () => themeSettings.value.customBaseColor,
      () => themeSettings.value.customAccentColor,
    ],
    ([
      resolvedTheme,
      selectedBase,
      selectedAccent,
      selectedCustomBaseColor,
      selectedCustomAccentColor,
    ]) => {
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
    { immediate: true }
  )
}

export const accent = computed({
  get: () => {
    const settingsStore = useSettingsStore()
    return settingsStore.themeSettings.accent
  },
  set: (value: AccentId) => {
    const settingsStore = useSettingsStore()
    settingsStore.themeSettings.accent = value
  },
})

export const base = computed({
  get: () => {
    const settingsStore = useSettingsStore()
    return settingsStore.themeSettings.base
  },
  set: (value: BaseId) => {
    const settingsStore = useSettingsStore()
    settingsStore.themeSettings.base = value
  },
})

export const font = computed({
  get: () => {
    const settingsStore = useSettingsStore()
    return settingsStore.themeSettings.font
  },
  set: (value: FontId) => {
    const settingsStore = useSettingsStore()
    settingsStore.themeSettings.font = value
  },
})

export const size = computed({
  get: () => {
    const settingsStore = useSettingsStore()
    return settingsStore.themeSettings.size
  },
  set: (value: SizeId) => {
    const settingsStore = useSettingsStore()
    settingsStore.themeSettings.size = value
  },
})

export const customBaseColor = computed({
  get: () => {
    const settingsStore = useSettingsStore()
    return settingsStore.themeSettings.customBaseColor
  },
  set: (value: string) => {
    const settingsStore = useSettingsStore()
    settingsStore.themeSettings.customBaseColor = normalizeHexColor(
      value,
      defaultCustomBaseColor
    )
  },
})

export const customAccentColor = computed({
  get: () => {
    const settingsStore = useSettingsStore()
    return settingsStore.themeSettings.customAccentColor
  },
  set: (value: string) => {
    const settingsStore = useSettingsStore()
    settingsStore.themeSettings.customAccentColor = normalizeHexColor(
      value,
      defaultCustomAccentColor
    )
  },
})

if (isTauri.value) {
  watch(store, async (value) => {
    switch (value) {
      case "light":
        await setTheme("light")
        break
      case "dark":
        await setTheme("dark")
        break
      case "auto":
        await setTheme(null)
        break
      default:
        await setTheme(null)
        break
    }
  })
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

function toResolvedThemeMode(value: string): ResolvedThemeMode {
  return value === "dark" ? "dark" : "light"
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

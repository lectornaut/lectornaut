import { defaultSettingsTab, defaultSettingsTabs } from "@/helpers/defaults"

export type SettingsContentTabId =
  (typeof defaultSettingsTabs)[number]["links"][number]["id"]

const DEFAULT_SETTINGS_LINK_IDS = defaultSettingsTabs.flatMap((section) =>
  section.links.map((link) => link.id)
)

export const SETTINGS_CONTENT_TAB_IDS = [
  ...new Set(DEFAULT_SETTINGS_LINK_IDS),
] as SettingsContentTabId[]

const SETTINGS_CONTENT_TAB_SET = new Set<string>(SETTINGS_CONTENT_TAB_IDS)

const resolveDefaultTab = (): SettingsContentTabId | undefined => {
  const normalizedDefault = defaultSettingsTab.trim().toLowerCase()
  if (SETTINGS_CONTENT_TAB_SET.has(normalizedDefault)) {
    return normalizedDefault as SettingsContentTabId
  }
  return undefined
}

export const DEFAULT_SETTINGS_CONTENT_TAB = resolveDefaultTab()

export const normalizeSettingsTab = (
  raw?: string | null
): SettingsContentTabId | undefined => {
  if (!raw) return DEFAULT_SETTINGS_CONTENT_TAB

  const normalizedInput = raw.trim().toLowerCase()
  if (!normalizedInput) return DEFAULT_SETTINGS_CONTENT_TAB

  if (SETTINGS_CONTENT_TAB_SET.has(normalizedInput)) {
    return normalizedInput as SettingsContentTabId
  }

  return undefined
}

const safeDecodeHash = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const tabFromHash = (hash: string): SettingsContentTabId | undefined => {
  const withoutPound = hash.startsWith("#") ? hash.slice(1) : hash
  return normalizeSettingsTab(safeDecodeHash(withoutPound))
}

export const hashFromTab = (tab?: string | null): string => {
  const normalizedTab = normalizeSettingsTab(tab)
  if (!normalizedTab) return ""
  return `#${encodeURIComponent(normalizedTab)}`
}

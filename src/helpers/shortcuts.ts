import {
  IconBell,
  IconBuilding,
  IconCheckSquare2,
  IconCircleDotDashed,
  IconCopy,
  IconHelpCircle,
  IconHistory,
  IconKeyboard,
  IconLayoutGrid,
  IconLogOut,
  IconMinusSquare,
  IconMonitor,
  IconMoon,
  IconPanelBottom,
  IconPanelLeft,
  IconPanelRight,
  IconPlusSquare,
  IconSettings,
  IconSparkles,
  IconSquarePen,
  IconSun,
  IconTerminal,
  IconUsersRound,
  IconXCircle,
  IconXSquare,
} from "@/data/icons"
import {
  formatForDisplay,
  formatHotkey,
  parseHotkey,
  type Hotkey,
} from "@tanstack/vue-hotkeys"
import type { Component } from "vue"

/**
 * A hotkey binding string in TanStack notation (e.g. `"Mod+K"`, `"Mod+Shift+L"`).
 *
 * The `(string & {})` arm preserves autocomplete for the type-safe `Hotkey`
 * union while still permitting escape-hatch combos the union deliberately
 * excludes — notably `Shift+<punctuation>` like `"Shift+/"` (the "?" help key),
 * which is layout-dependent and matched via `event.code` at runtime.
 */
export type HotkeyBinding = Hotkey | (string & {})

// ============================================================================
// Platform Detection (cached for performance)
// ============================================================================

export const IS_APPLE_DEVICE =
  typeof navigator !== "undefined" &&
  /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)

/** Platform-specific modifier key: ⌘ (macOS) or Ctrl (others) */
export const getPlatformSpecialKey = (): string =>
  IS_APPLE_DEVICE ? "⌘" : "Ctrl"

/** Platform-specific alternate key: ⌥ (macOS) or Alt (others) */
export const getPlatformAlternateKey = (): string =>
  IS_APPLE_DEVICE ? "⌥" : "Alt"

/** Platform-specific control key: ⌃ (macOS) or Ctrl (others) */
export const getPlatformControlKey = (): string =>
  IS_APPLE_DEVICE ? "⌃" : "Ctrl"

// ============================================================================
// Types
// ============================================================================

/** Contexts where shortcuts can be displayed or registered */
export type ShortcutContext =
  | "hotkeys" // Global keyboard listener registration
  | "shortcuts" // Shortcuts dialog/panel
  | "commands" // Command palette (Cmd+K)

/** Platform restrictions for shortcuts */
export type ShortcutPlatform = "web" | "desktop"

/** Visibility configuration - explicitly define where shortcut appears */
export type ShortcutVisibility = {
  /** Contexts where this shortcut should NOT appear (default: shown everywhere) */
  hideFrom?: ShortcutContext[]
  /** Platform restrictions - if set, only show on specified platforms */
  platforms?: ShortcutPlatform[]
}

export type Shortcut = {
  /** Breadcrumb-style description path, stored as i18n keys */
  description: string[]
  /**
   * Optional DISPLAY OVERRIDE for `<Kbd>` rendering (array of combos, each a
   * list of key tokens). Omit it to let the display derive from `hotkeys` —
   * `getShortcutDisplayKeys` is the single resolver. Set it only when the
   * derived glyphs would be wrong: e.g. `[["?"]]` for `Shift+/`, or a summary
   * range like `[["⌘", "1...9"]]` that has no single `hotkeys`.
   */
  keys?: string[][]
  /**
   * TanStack hotkey binding(s) in cross-platform `Mod` notation (e.g. `"Mod+K"`,
   * which resolves to ⌘K on macOS and Ctrl+K elsewhere). Use an array for
   * actions bound to several distinct combos (e.g. workspace switch up/down).
   */
  hotkeys?: HotkeyBinding | HotkeyBinding[]
  /** Event emitted when shortcut is triggered */
  event: string
  /** Optional parameters passed to the event */
  parameters?: string | number
  /** Icon component for display */
  icon: Component
  /** Search tags for fuzzy matching */
  tags: string[]
  /** Visibility rules */
  visibility?: ShortcutVisibility
}

export type ShortcutCategory = {
  /** i18n key for the category title */
  title: string
  id: string
  shortcuts: Shortcut[]
  /** Visibility rules applied to all shortcuts in category */
  visibility?: ShortcutVisibility
}

// ============================================================================
// Filter Utilities
// ============================================================================

export type FilterOptions = {
  context: ShortcutContext
  isDesktop: boolean
}

/**
 * Check if a shortcut should be visible given the current options
 */
export const isShortcutVisible = (
  shortcut: Shortcut,
  options: FilterOptions
): boolean => {
  const { context, isDesktop } = options
  const { visibility } = shortcut

  // Check context visibility
  if (visibility?.hideFrom?.includes(context)) {
    return false
  }

  // Check platform restrictions
  if (visibility?.platforms) {
    const currentPlatform: ShortcutPlatform = isDesktop ? "desktop" : "web"
    if (!visibility.platforms.includes(currentPlatform)) {
      return false
    }
  }

  return true
}

/**
 * Check if a category should be visible given the current options
 */
export const isCategoryVisible = (
  category: ShortcutCategory,
  options: FilterOptions
): boolean => {
  const { context, isDesktop } = options
  const { visibility } = category

  // Check context visibility
  if (visibility?.hideFrom?.includes(context)) {
    return false
  }

  // Check platform restrictions
  if (visibility?.platforms) {
    const currentPlatform: ShortcutPlatform = isDesktop ? "desktop" : "web"
    if (!visibility.platforms.includes(currentPlatform)) {
      return false
    }
  }

  return true
}

/**
 * Filter shortcuts for a given context and platform
 * Returns categories with their filtered shortcuts
 */
export const getFilteredShortcuts = (
  options: FilterOptions
): ShortcutCategory[] => {
  return shortcuts
    .filter((category) => isCategoryVisible(category, options))
    .map((category) => ({
      ...category,
      shortcuts: category.shortcuts.filter((shortcut) =>
        isShortcutVisible(shortcut, options)
      ),
    }))
    .filter((category) => category.shortcuts.length > 0)
}

/**
 * Get all shortcuts flattened for search indexing
 */
export const getFlatShortcuts = (options?: FilterOptions): Shortcut[] => {
  const categories = options ? getFilteredShortcuts(options) : shortcuts
  return categories.flatMap((category) => category.shortcuts)
}

// ============================================================================
// Display & Validation Utilities (shared across recorder UIs)
// ============================================================================

/** Target platform passed to TanStack's display/parse helpers. */
const DISPLAY_PLATFORM: "mac" | "windows" = IS_APPLE_DEVICE ? "mac" : "windows"

/**
 * Private separator for splitting `formatForDisplay` output into key tokens.
 * Uses the ASCII Unit Separator (U+001F) so it never collides with a key glyph.
 */
const DISPLAY_SEPARATOR = "\u001f"

/**
 * macOS system shortcuts that cannot be reassigned as app hotkeys, in `Mod`
 * notation (Mod = ⌘ on macOS). Matched against the recorder's normalized
 * output and only enforced on Apple devices (see `useShortcutRecorder`).
 */
export const SYSTEM_SHORTCUTS = new Set<HotkeyBinding>([
  "Mod+H", // Hide window
  "Mod+M", // Minimize
  "Mod+Q", // Quit
  "Mod+W", // Close window
  "Mod+Tab", // App switcher
  "Mod+Space", // Spotlight
  "Mod+I", // Get Info (Finder)
])

/**
 * Split a binding string into individual combos while preserving literal comma
 * keys, e.g. `"Mod+,"` -> `["Mod+,"]`. Also splits legacy hotkeys-js values
 * (`"cmd+k,ctrl+k"` -> `["cmd+k", "ctrl+k"]`) so existing user overrides keep
 * working without a data migration.
 */
export const splitHotkeyBindings = (binding: string): string[] => {
  const normalizedBinding = binding.replace(/\s/g, "")
  if (!normalizedBinding) return []

  const combos = normalizedBinding.split(",")
  let index = combos.lastIndexOf("")

  while (index > 0) {
    combos[index - 1] += ","
    combos.splice(index, 1)
    index = combos.lastIndexOf("")
  }

  return combos.filter(Boolean)
}

/**
 * Resolve a shortcut binding (single string, array, or undefined) to a flat
 * list of combo strings. A bare string is run through `splitHotkeyBindings` so
 * both array definitions and legacy comma-joined overrides normalize uniformly.
 */
export const getHotkeyCombos = (
  binding: HotkeyBinding | HotkeyBinding[] | undefined
): string[] => {
  if (!binding) return []
  return Array.isArray(binding) ? binding : splitHotkeyBindings(binding)
}

/**
 * House display glyphs. TanStack's `formatForDisplay` spells a few keys
 * differently than this app's established style — the word `"Shift"` on
 * Windows, `"↵"` for Enter (the repo uses `↩`), `"⇥"` for Tab. Remapping these
 * makes every *derived* display match what the hand-written `keys` arrays used
 * to render, on both macOS and Windows, so `keys` can be dropped as redundant.
 */
const HOUSE_DISPLAY_GLYPHS: Record<string, string> = {
  Shift: "⇧",
  "↵": "↩",
  Enter: "↩",
  "⇥": "Tab",
}

/**
 * Convert a single hotkey combo to platform-specific display key tokens for
 * `<Kbd>` rendering, e.g. `"Mod+Shift+L"` -> `["⌘", "⇧", "L"]` on macOS.
 * Library glyphs are remapped to the app's house style (see
 * `HOUSE_DISPLAY_GLYPHS`), so this is the one source of display-key glyphs.
 */
export const hotkeyToDisplayKeys = (hotkey: string): string[] => {
  if (!hotkey) return []
  try {
    return formatForDisplay(hotkey, {
      platform: DISPLAY_PLATFORM,
      separatorToken: DISPLAY_SEPARATOR,
    })
      .split(DISPLAY_SEPARATOR)
      .map((token) => HOUSE_DISPLAY_GLYPHS[token] ?? token)
  } catch {
    return [hotkey]
  }
}

/**
 * Resolve a shortcut's display keys for `<Kbd>` rendering, as an array of
 * combos (each combo a list of key tokens). `hotkeys` is the single source:
 * the display derives from it. An explicit `keys` is an override for the rare
 * case the derived form is wrong (e.g. `?` for `Shift+/`, or a no-`hotkeys`
 * summary like `⌘ 1...9`). Returns `[]` for command-only entries (neither set).
 */
export const getShortcutDisplayKeys = (
  shortcut: Pick<Shortcut, "keys" | "hotkeys">
): string[][] =>
  shortcut.keys?.length
    ? shortcut.keys
    : getHotkeyCombos(shortcut.hotkeys).map((combo) =>
        hotkeyToDisplayKeys(combo)
      )

// ============================================================================
// Multi-key sequences (Vim / Linear-style, e.g. "G" then "H" → Home)
// ============================================================================
//
// Unlike the chord shortcuts above (registered from this file via
// `useGlobalHotkeys`), sequences are derived from the surfaces that already
// own them — destinations from `defaultMenu`, create intents from
// `useCreateActions` — and registered together by `useGlobalHotkeySequences`.
// This file owns only the vocabulary not tied to one destination: the create
// prefix (create letters are derived, not curated per item), the inter-key
// timeout, and the `<Kbd>` display formatting. The "go to" prefix ("G") and
// its per-page letters live inline on `defaultMenu`, beside the routes.

/**
 * Leading key for "create <thing>" sequences (the "go to" counterpart, "G",
 * lives on each `defaultMenu` entry's `sequence`). The second key is the
 * create intent's single-letter accelerator — the same letter the `CreateMenu`
 * dropdown uses — uppercased.
 */
export const CREATE_SEQUENCE_PREFIX = "C"

/**
 * Milliseconds the user has to press the next key before an in-progress
 * sequence resets. Mirrors TanStack's `DEFAULT_SEQUENCE_TIMEOUT` (1000ms).
 */
export const SEQUENCE_TIMEOUT = 1000

/**
 * Milliseconds modifiers must be held alone before `useKeyHints` reveals the
 * chords they lead to. Long enough that an ordinary ⌘C / ⌘V never flashes the
 * hint, short enough that a deliberate "what can ⌘ do?" pause gets an answer.
 */
export const MODIFIER_HINT_DELAY = 500

/**
 * Convert a multi-key sequence (e.g. `["G", "H"]`) to platform display key
 * tokens for `<Kbd>` rendering. Each step is formatted independently — so a
 * modifier-bearing step like `"Shift+R"` still expands to its glyphs — then
 * concatenated, since a sequence reads as "press each key in turn".
 */
export const sequenceToDisplayKeys = (sequence: readonly string[]): string[] =>
  sequence.flatMap((step) => hotkeyToDisplayKeys(step))

/** Stable identifier for storing per-shortcut overrides */
export const getShortcutId = (
  shortcut: Pick<Shortcut, "event" | "parameters">
): string =>
  shortcut.parameters === undefined
    ? shortcut.event
    : `${shortcut.event}::${String(shortcut.parameters)}`

/** Look up a shortcut by its stable identifier */
export const getShortcutById = (shortcutId: string): Shortcut | undefined =>
  shortcuts
    .flatMap((category) => category.shortcuts)
    .find((shortcut) => getShortcutId(shortcut) === shortcutId)

/** Get the default hotkeys binding for a shortcut identifier */
export const getDefaultHotkeys = (
  shortcutId: string
): HotkeyBinding | HotkeyBinding[] | undefined =>
  getShortcutById(shortcutId)?.hotkeys

/**
 * Canonicalize a single hotkey combo for equality comparison (conflict & reset
 * detection). Resolves `Mod` to the current platform's modifier and aliases
 * (`cmd`/`ctrl`) to canonical names, so `"Mod+K"`, `"cmd+k"` (macOS) and
 * `"ctrl+k"` (Windows) all compare equal. Falls back to a lowercased string for
 * combos TanStack can't parse.
 */
export const normalizeHotkeyCombo = (combo: string): string => {
  try {
    return formatHotkey(parseHotkey(combo, DISPLAY_PLATFORM))
  } catch {
    return combo.toLowerCase()
  }
}

/**
 * True when a single recorded combo equals the shortcut's default binding,
 * compared canonically (so `"Mod+K"` matches a legacy `"cmd+k"` override and a
 * freshly recorded combo alike). Only single-combo defaults are user-editable,
 * so multi-combo defaults never match.
 */
export const isDefaultHotkey = (shortcutId: string, combo: string): boolean => {
  const defaults = getHotkeyCombos(getDefaultHotkeys(shortcutId))
  return (
    defaults.length === 1 &&
    normalizeHotkeyCombo(defaults[0]) === normalizeHotkeyCombo(combo)
  )
}

// ============================================================================
// Shortcut Generators (reduce repetition)
// ============================================================================

/** Generate numbered tab selection shortcuts (1-9) */
const generateTabSelectionShortcuts = (): Shortcut[] =>
  Array.from({ length: 9 }, (_, i) => {
    const num = i + 1
    return {
      description: [`components.global.shortcutDescriptions.selectTab${num}`],
      hotkeys: `Mod+${num}`,
      event: "Tabs.Select",
      parameters: num,
      icon: IconCheckSquare2,
      tags: ["tab", "select", "number"],
      visibility: { hideFrom: ["commands", "shortcuts"] },
    }
  })

// ============================================================================
// Shortcuts Configuration
// ============================================================================

/**
 * Application Shortcuts Configuration
 *
 * Categories are ordered by frequency of use:
 * 1. General - Most common actions
 * 2. Tabs - Tab management (desktop hotkeys)
 * 3. Layout - UI arrangement
 * 4. Team - Team settings hotkeys
 * 5. Appearance - Theme switching (commands only)
 * 6. Account - User actions
 *
 * This file is the registry for *keyboard-bound* and *curated* commands only.
 * The command palette (`useCommandPalette`) composes these with commands
 * derived from other single sources — navigation from `defaultMenu`, every
 * settings panel from `defaultSettingsTabs`, create intents from
 * `useCreateActions`, plus live tab/workspace/team state — so don't add
 * palette entries here for things those sources already describe.
 */
export const shortcuts: ShortcutCategory[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // General - Core actions available everywhere
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "components.global.shortcutCategories.general",
    id: "general",
    shortcuts: [
      {
        description: ["components.global.shortcutDescriptions.commands"],
        hotkeys: "Mod+K",
        event: "Dialog.Command.Open",
        icon: IconTerminal,
        tags: ["command", "search", "palette"],
        visibility: { hideFrom: ["commands"] }, // Don't show "open commands" in commands
      },
      {
        description: ["components.global.shortcutDescriptions.askAi"],
        hotkeys: "Mod+Enter",
        event: "Dialog.AiAsk.Toggle",
        icon: IconSparkles,
        tags: ["ai", "ask", "assistant", "copilot"],
      },
      {
        description: ["components.global.shortcutDescriptions.notifications"],
        hotkeys: "Mod+Shift+Enter",
        event: "Dialog.Notifications.Toggle",
        icon: IconBell,
        tags: ["notifications", "inbox", "dock", "left", "toggle"],
      },
      {
        description: ["components.global.shortcutDescriptions.settings"],
        hotkeys: "Mod+,",
        event: "Dialog.Settings.Open",
        parameters: "preferences",
        icon: IconSettings,
        tags: ["settings", "preferences", "options"],
      },
      {
        description: [
          "components.global.shortcutDescriptions.keyboardShortcuts",
        ],
        hotkeys: "Mod+/",
        event: "Dialog.Shortcuts.Open",
        icon: IconKeyboard,
        tags: ["keyboard", "shortcuts", "help", "keys"],
      },
      {
        description: [
          "components.global.shortcutDescriptions.workspace",
          "components.global.shortcutDescriptions.switch",
        ],
        hotkeys: ["Mod+Shift+ArrowUp", "Mod+Shift+ArrowDown"],
        event: "Workspace.Switch",
        icon: IconLayoutGrid,
        tags: ["workspace", "switch", "dropdown"],
        visibility: { hideFrom: ["commands", "shortcuts"] },
      },
      {
        description: ["components.global.shortcutDescriptions.helpAndSupport"],
        keys: [["?"]],
        hotkeys: "Shift+/",
        event: "Menu.Help.Toggle",
        icon: IconHelpCircle,
        tags: ["help", "support", "documentation", "faq"],
      },
      {
        description: ["components.global.shortcutDescriptions.whatsNew"],
        event: "Dialog.Changelog.Open",
        icon: IconCircleDotDashed,
        tags: [
          "changelog",
          "what's new",
          "updates",
          "release notes",
          "version",
        ],
        visibility: { hideFrom: ["hotkeys", "shortcuts"] },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Tabs - Desktop-only tab management
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "components.global.shortcutCategories.tabs",
    id: "tabs",
    visibility: { platforms: ["desktop"], hideFrom: ["commands"] },
    shortcuts: [
      {
        description: ["components.global.shortcutDescriptions.openNewTab"],
        hotkeys: "Mod+T",
        event: "Tabs.Add",
        icon: IconPlusSquare,
        tags: ["tab", "new", "add", "open", "create"],
      },
      {
        description: [
          "components.global.shortcutDescriptions.reopenLastClosedTab",
        ],
        hotkeys: "Mod+Shift+T",
        event: "Tabs.ReopenLast",
        icon: IconHistory,
        tags: ["tab", "reopen", "history", "restore", "undo"],
      },
      {
        description: ["components.global.shortcutDescriptions.closeCurrentTab"],
        hotkeys: "Mod+W",
        event: "Tabs.Close",
        icon: IconMinusSquare,
        tags: ["tab", "close", "remove"],
      },
      {
        description: ["components.global.shortcutDescriptions.closeOtherTabs"],
        hotkeys: "Mod+Shift+W",
        event: "Tabs.Close.Others",
        icon: IconXCircle,
        tags: ["tab", "close", "remove", "others"],
      },
      {
        description: ["components.global.shortcutDescriptions.closeAllTabs"],
        hotkeys: "Mod+Alt+W",
        event: "Tabs.Close.All",
        icon: IconXSquare,
        tags: ["tab", "close", "remove", "all", "clear"],
      },
      {
        description: ["components.global.shortcutDescriptions.duplicateTab"],
        hotkeys: "Mod+D",
        event: "Tabs.Duplicate",
        icon: IconCopy,
        tags: ["tab", "duplicate", "copy", "clone"],
      },
      {
        description: ["components.global.shortcutDescriptions.renameTab"],
        hotkeys: "F2",
        event: "Tabs.Rename",
        icon: IconSquarePen,
        tags: ["tab", "rename", "edit", "name"],
      },
      {
        description: ["components.global.shortcutDescriptions.selectNextTab"],
        hotkeys: "Control+Tab",
        event: "Tabs.Select",
        parameters: "next",
        icon: IconCheckSquare2,
        tags: ["tab", "next", "switch", "cycle"],
        visibility: { hideFrom: ["commands"] },
      },
      {
        description: [
          "components.global.shortcutDescriptions.selectPreviousTab",
        ],
        hotkeys: "Control+Shift+Tab",
        event: "Tabs.Select",
        parameters: "previous",
        icon: IconCheckSquare2,
        tags: ["tab", "previous", "switch", "cycle"],
        visibility: { hideFrom: ["commands"] },
      },
      // Summary entry for shortcuts panel (no hotkey registration)
      {
        description: ["components.global.shortcutDescriptions.selectNthTab"],
        keys: [[getPlatformSpecialKey(), "1...9"]],
        event: "Tabs.Select",
        icon: IconCheckSquare2,
        tags: ["tab", "select", "number"],
        visibility: { hideFrom: ["hotkeys", "commands"] },
      },
      // Individual tab shortcuts (hotkeys only, not shown in UI)
      ...generateTabSelectionShortcuts(),
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Layout - Panel and sidebar management
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "components.global.shortcutCategories.layout",
    id: "layout",
    shortcuts: [
      {
        description: [
          "components.global.shortcutDescriptions.sidebar",
          "components.global.shortcutDescriptions.left",
        ],
        hotkeys: "Mod+Shift+\\",
        event: "Sidebar.Left.Toggle",
        icon: IconPanelLeft,
        tags: ["sidebar", "toggle", "layout", "left", "panel"],
      },
      {
        description: [
          "components.global.shortcutDescriptions.sidebar",
          "components.global.shortcutDescriptions.right",
        ],
        hotkeys: "Mod+\\",
        event: "Sidebar.Right.Toggle",
        icon: IconPanelRight,
        tags: ["sidebar", "toggle", "layout", "right", "panel"],
      },
      {
        description: [
          "components.global.shortcutDescriptions.panel",
          "components.global.shortcutDescriptions.bottom",
        ],
        hotkeys: "Mod+J",
        event: "Panel.Bottom.Toggle",
        icon: IconPanelBottom,
        tags: ["panel", "toggle", "layout", "bottom", "terminal"],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Team settings - Quick access to settings panels
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "components.global.shortcutCategories.team",
    id: "team",
    shortcuts: [
      // With keyboard shortcuts
      {
        description: [
          "components.global.shortcutDescriptions.settings",
          "components.global.shortcutDescriptions.team",
          "components.global.shortcutDescriptions.overview",
        ],
        hotkeys: "Mod+;",
        event: "Dialog.Settings.Open",
        parameters: "overview",
        icon: IconBuilding,
        tags: ["settings", "team", "overview", "workspace", "organization"],
        visibility: { hideFrom: ["commands"] },
      },
      // workspaces
      {
        description: [
          "components.global.shortcutDescriptions.settings",
          "components.global.shortcutDescriptions.team",
          "components.global.shortcutDescriptions.workspaces",
        ],
        hotkeys: "Mod+Shift+S",
        event: "Dialog.Settings.Open",
        parameters: "workspaces",
        icon: IconSettings,
        tags: ["settings", "team", "workspaces", "projects"],
        visibility: { hideFrom: ["commands"] },
      },
      {
        description: [
          "components.global.shortcutDescriptions.settings",
          "components.global.shortcutDescriptions.team",
          "components.global.shortcutDescriptions.members",
        ],
        hotkeys: "Mod+Shift+M",
        event: "Dialog.Settings.Open",
        parameters: "members",
        icon: IconUsersRound,
        tags: ["settings", "team", "members", "users"],
        visibility: { hideFrom: ["commands"] },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Appearance - Theme switching (command palette only)
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "components.global.shortcutCategories.appearance",
    id: "appearance",
    visibility: { hideFrom: ["hotkeys", "shortcuts"] },
    shortcuts: [
      {
        description: [
          "components.global.shortcutDescriptions.theme",
          "components.global.shortcutDescriptions.light",
        ],
        event: "Theme.Change",
        parameters: "light",
        icon: IconSun,
        tags: ["theme", "light", "bright", "day"],
      },
      {
        description: [
          "components.global.shortcutDescriptions.theme",
          "components.global.shortcutDescriptions.dark",
        ],
        event: "Theme.Change",
        parameters: "dark",
        icon: IconMoon,
        tags: ["theme", "dark", "night"],
      },
      {
        description: [
          "components.global.shortcutDescriptions.theme",
          "components.global.shortcutDescriptions.auto",
        ],
        event: "Theme.Change",
        parameters: "auto",
        icon: IconMonitor,
        tags: ["theme", "auto", "system", "sync"],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Account - User session management
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "components.global.shortcutCategories.account",
    id: "account",
    shortcuts: [
      {
        description: ["components.global.shortcutDescriptions.logout"],
        hotkeys: "Mod+Shift+L",
        event: "Dialog.Exit.Open",
        icon: IconLogOut,
        tags: ["logout", "sign out", "exit", "session"],
      },
    ],
  },
]

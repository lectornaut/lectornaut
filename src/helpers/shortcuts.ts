import {
  IconBuilding,
  IconCheckSquare2,
  IconCircleUser,
  IconCopy,
  IconCreditCard,
  IconHelpCircle,
  IconHistory,
  IconKeyboard,
  IconLayoutGrid,
  IconLogOut,
  IconMinusSquare,
  IconMonitor,
  IconMoon,
  IconPalette,
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
  /** Breadcrumb-style description path */
  description: string[]
  /** Display keys (e.g., [["⌘", "K"]]) - optional for command-only shortcuts */
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
 * Convert a single hotkey combo to platform-specific display key tokens for
 * `<Kbd>` rendering, e.g. `"Mod+Shift+L"` -> `["⌘", "⇧", "L"]` on macOS.
 */
export const hotkeyToDisplayKeys = (hotkey: string): string[] => {
  if (!hotkey) return []
  try {
    return formatForDisplay(hotkey, {
      platform: DISPLAY_PLATFORM,
      separatorToken: DISPLAY_SEPARATOR,
    }).split(DISPLAY_SEPARATOR)
  } catch {
    return [hotkey]
  }
}

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
      description: [`Select tab ${num}`],
      keys: [[getPlatformSpecialKey(), String(num)]],
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
 * 2. Navigation - Tab and panel management
 * 3. Layout - UI arrangement
 * 4. Settings - Configuration access
 * 5. Appearance - Theme switching (commands only)
 * 6. Account - User actions
 */
export const shortcuts: ShortcutCategory[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // General - Core actions available everywhere
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "General",
    id: "general",
    shortcuts: [
      {
        description: ["Commands"],
        keys: [[getPlatformSpecialKey(), "K"]],
        hotkeys: "Mod+K",
        event: "Dialog.Command.Open",
        icon: IconTerminal,
        tags: ["command", "search", "palette"],
        visibility: { hideFrom: ["commands"] }, // Don't show "open commands" in commands
      },
      {
        description: ["Ask AI"],
        keys: [[getPlatformSpecialKey(), "↩"]],
        hotkeys: "Mod+Enter",
        event: "Dialog.AiAsk.Toggle",
        icon: IconSparkles,
        tags: ["ai", "ask", "assistant", "copilot"],
      },
      {
        description: ["Settings"],
        keys: [[getPlatformSpecialKey(), ","]],
        hotkeys: "Mod+,",
        event: "Dialog.Settings.Open",
        parameters: "preferences",
        icon: IconSettings,
        tags: ["settings", "preferences", "options"],
      },
      {
        description: ["Keyboard shortcuts"],
        keys: [[getPlatformSpecialKey(), "/"]],
        hotkeys: "Mod+/",
        event: "Dialog.Shortcuts.Open",
        icon: IconKeyboard,
        tags: ["keyboard", "shortcuts", "help", "keys"],
      },
      {
        description: ["Workspace", "Switch"],
        hotkeys: ["Mod+Shift+ArrowUp", "Mod+Shift+ArrowDown"],
        event: "Workspace.Switch",
        icon: IconLayoutGrid,
        tags: ["workspace", "switch", "dropdown"],
        visibility: { hideFrom: ["commands", "shortcuts"] },
      },
      {
        description: ["Help and support"],
        keys: [["?"]],
        hotkeys: "Shift+/",
        event: "Menu.Help.Toggle",
        icon: IconHelpCircle,
        tags: ["help", "support", "documentation", "faq"],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Tabs - Desktop-only tab management
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "Tabs",
    id: "tabs",
    visibility: { platforms: ["desktop"], hideFrom: ["commands"] },
    shortcuts: [
      {
        description: ["Open new tab"],
        keys: [[getPlatformSpecialKey(), "T"]],
        hotkeys: "Mod+T",
        event: "Tabs.Add",
        icon: IconPlusSquare,
        tags: ["tab", "new", "add", "open", "create"],
      },
      {
        description: ["Reopen last closed tab"],
        keys: [[getPlatformSpecialKey(), "⇧", "T"]],
        hotkeys: "Mod+Shift+T",
        event: "Tabs.ReopenLast",
        icon: IconHistory,
        tags: ["tab", "reopen", "history", "restore", "undo"],
      },
      {
        description: ["Close current tab"],
        keys: [[getPlatformSpecialKey(), "W"]],
        hotkeys: "Mod+W",
        event: "Tabs.Close",
        icon: IconMinusSquare,
        tags: ["tab", "close", "remove"],
      },
      {
        description: ["Close other tabs"],
        keys: [[getPlatformSpecialKey(), "⇧", "W"]],
        hotkeys: "Mod+Shift+W",
        event: "Tabs.Close.Others",
        icon: IconXCircle,
        tags: ["tab", "close", "remove", "others"],
      },
      {
        description: ["Close all tabs"],
        keys: [[getPlatformSpecialKey(), getPlatformAlternateKey(), "W"]],
        hotkeys: "Mod+Alt+W",
        event: "Tabs.Close.All",
        icon: IconXSquare,
        tags: ["tab", "close", "remove", "all", "clear"],
      },
      {
        description: ["Duplicate tab"],
        keys: [[getPlatformSpecialKey(), "D"]],
        hotkeys: "Mod+D",
        event: "Tabs.Duplicate",
        icon: IconCopy,
        tags: ["tab", "duplicate", "copy", "clone"],
      },
      {
        description: ["Rename tab"],
        keys: [["F2"]],
        hotkeys: "F2",
        event: "Tabs.Rename",
        icon: IconSquarePen,
        tags: ["tab", "rename", "edit", "name"],
      },
      {
        description: ["Select next tab"],
        keys: [[getPlatformControlKey(), "Tab"]],
        hotkeys: "Control+Tab",
        event: "Tabs.Select",
        parameters: "next",
        icon: IconCheckSquare2,
        tags: ["tab", "next", "switch", "cycle"],
        visibility: { hideFrom: ["commands"] },
      },
      {
        description: ["Select previous tab"],
        keys: [[getPlatformControlKey(), "⇧", "Tab"]],
        hotkeys: "Control+Shift+Tab",
        event: "Tabs.Select",
        parameters: "previous",
        icon: IconCheckSquare2,
        tags: ["tab", "previous", "switch", "cycle"],
        visibility: { hideFrom: ["commands"] },
      },
      // Summary entry for shortcuts panel (no hotkey registration)
      {
        description: ["Select Nth tab"],
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
    title: "Layout",
    id: "layout",
    shortcuts: [
      {
        description: ["Sidebar", "Left"],
        keys: [[getPlatformSpecialKey(), "\\"]],
        hotkeys: "Mod+\\",
        event: "Sidebar.Left.Toggle",
        icon: IconPanelLeft,
        tags: ["sidebar", "toggle", "layout", "left", "panel"],
      },
      {
        description: ["Sidebar", "Right"],
        keys: [[getPlatformSpecialKey(), "⇧", "\\"]],
        hotkeys: "Mod+Shift+\\",
        event: "Sidebar.Right.Toggle",
        icon: IconPanelRight,
        tags: ["sidebar", "toggle", "layout", "right", "panel"],
      },
      {
        description: ["Panel", "Bottom"],
        keys: [[getPlatformSpecialKey(), "J"]],
        hotkeys: "Mod+J",
        event: "Panel.Bottom.Toggle",
        icon: IconPanelBottom,
        tags: ["panel", "toggle", "layout", "bottom", "terminal"],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Settings - Quick access to settings panels
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "Settings",
    id: "settings",
    shortcuts: [
      // Command palette only (no keyboard shortcuts)
      {
        description: ["Settings", "Account"],
        event: "Dialog.Settings.Open",
        parameters: "account",
        icon: IconCircleUser,
        tags: ["settings", "account", "profile", "user"],
        visibility: { hideFrom: ["hotkeys", "shortcuts"] },
      },
      {
        description: ["Settings", "Appearance"],
        event: "Dialog.Settings.Open",
        parameters: "appearance",
        icon: IconPalette,
        tags: ["settings", "appearance", "theme", "look"],
        visibility: { hideFrom: ["hotkeys", "shortcuts"] },
      },
      {
        description: ["Settings", "Billing"],
        event: "Dialog.Settings.Open",
        parameters: "billing",
        icon: IconCreditCard,
        tags: ["settings", "billing", "payment", "subscription"],
        visibility: { hideFrom: ["hotkeys", "shortcuts"] },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Team settings - Quick access to settings panels
  // ──────────────────────────────────────────────────────────────────────────
  {
    title: "Team",
    id: "team",
    shortcuts: [
      // With keyboard shortcuts
      {
        description: ["Settings", "Team", "Overview"],
        keys: [[getPlatformSpecialKey(), ";"]],
        hotkeys: "Mod+;",
        event: "Dialog.Settings.Open",
        parameters: "overview",
        icon: IconBuilding,
        tags: ["settings", "team", "overview", "workspace", "organization"],
        visibility: { hideFrom: ["commands"] },
      },
      // workspaces
      {
        description: ["Settings", "Team", "Workspaces"],
        keys: [[getPlatformSpecialKey(), "⇧", "S"]],
        hotkeys: "Mod+Shift+S",
        event: "Dialog.Settings.Open",
        parameters: "workspaces",
        icon: IconSettings,
        tags: ["settings", "team", "workspaces", "projects"],
        visibility: { hideFrom: ["commands"] },
      },
      {
        description: ["Settings", "Team", "Members"],
        keys: [[getPlatformSpecialKey(), "⇧", "M"]],
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
    title: "Appearance",
    id: "appearance",
    visibility: { hideFrom: ["hotkeys", "shortcuts"] },
    shortcuts: [
      {
        description: ["Theme", "Light"],
        event: "Theme.Change",
        parameters: "light",
        icon: IconSun,
        tags: ["theme", "light", "bright", "day"],
      },
      {
        description: ["Theme", "Dark"],
        event: "Theme.Change",
        parameters: "dark",
        icon: IconMoon,
        tags: ["theme", "dark", "night"],
      },
      {
        description: ["Theme", "Auto"],
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
    title: "Account",
    id: "account",
    shortcuts: [
      {
        description: ["Logout"],
        keys: [[getPlatformSpecialKey(), "⇧", "L"]],
        hotkeys: "Mod+Shift+L",
        event: "Dialog.Exit.Open",
        icon: IconLogOut,
        tags: ["logout", "sign out", "exit", "session"],
      },
    ],
  },
]

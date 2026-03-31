import {
  IconCheckSquare2,
  IconCircleUser,
  IconComponent,
  IconCopy,
  IconCreditCard,
  IconHelpCircle,
  IconHistory,
  IconKeyboard,
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
import type { Component } from "vue"

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
  /** hotkeys-js binding string (e.g., "cmd+k,ctrl+k") - required if keys is set */
  hotkeys?: string
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

/** Map of special key names to their display symbols */
export const DISPLAY_KEY_MAP: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
  enter: "↩",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  " ": "Space",
}

/** System shortcuts that cannot be registered as global hotkeys */
export const SYSTEM_SHORTCUTS = new Set([
  "cmd+h", // Hide window
  "cmd+m", // Minimize
  "cmd+q", // Quit
  "cmd+w", // Close window
  "cmd+tab", // App switcher
  "cmd+space", // Spotlight
  "cmd+i", // Get Info (Finder)
])

/**
 * Split a hotkeys-js binding string into combos while preserving literal comma
 * keys, e.g. "cmd+,,ctrl+," -> ["cmd+,", "ctrl+,"]
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

/** Convert a hotkeys-js binding string to platform-specific display keys */
export const hotkeyToDisplayKeys = (hotkey: string): string[] => {
  const parts = hotkey.split("+")
  return parts.map((part) => {
    switch (part) {
      case "cmd":
        return IS_APPLE_DEVICE ? "⌘" : getPlatformSpecialKey()
      case "ctrl":
        return IS_APPLE_DEVICE ? "⌃" : "Ctrl"
      case "shift":
        return IS_APPLE_DEVICE ? "⇧" : "Shift"
      case "alt":
        return IS_APPLE_DEVICE ? "⌥" : "Alt"
      default:
        return DISPLAY_KEY_MAP[part] ?? part.toUpperCase()
    }
  })
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
export const getDefaultHotkeys = (shortcutId: string): string | undefined =>
  getShortcutById(shortcutId)?.hotkeys

/**
 * Normalize a hotkey combo string for comparison.
 * Splits modifiers, sorts them, lowercases everything.
 * e.g. "shift+cmd+k" → "cmd+k+shift"
 */
export const normalizeHotkeyCombo = (combo: string): string => {
  const parts = combo.toLowerCase().split("+")
  const modifiers = parts.filter((p) =>
    ["cmd", "ctrl", "shift", "alt", "meta"].includes(p)
  )
  const keys = parts.filter(
    (p) => !["cmd", "ctrl", "shift", "alt", "meta"].includes(p)
  )
  return [...modifiers.sort(), ...keys].join("+")
}

/**
 * Generate cross-platform hotkey string from a single recorded combo.
 * On Mac: cmd+k → "cmd+k,ctrl+k" (so it works on both platforms)
 * On non-Mac: ctrl+k → "ctrl+k" (cmd bindings aren't needed)
 */
export const toCrossPlatformHotkeys = (hotkey: string): string => {
  if (IS_APPLE_DEVICE && hotkey.includes("cmd") && !hotkey.includes("ctrl")) {
    const ctrlVariant = hotkey.replace(/\bcmd\b/g, "ctrl")
    return `${hotkey},${ctrlVariant}`
  }
  return hotkey
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
      hotkeys: `cmd+${num},ctrl+${num}`,
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
        hotkeys: "cmd+k,ctrl+k",
        event: "Dialog.Command.Open",
        icon: IconTerminal,
        tags: ["command", "search", "palette"],
        visibility: { hideFrom: ["commands"] }, // Don't show "open commands" in commands
      },
      {
        description: ["Ask AI"],
        keys: [[getPlatformSpecialKey(), "↩"]],
        hotkeys: "cmd+enter,ctrl+enter",
        event: "Dialog.AiAsk.Toggle",
        icon: IconSparkles,
        tags: ["ai", "ask", "assistant", "copilot"],
      },
      {
        description: ["Settings"],
        keys: [[getPlatformSpecialKey(), ","]],
        hotkeys: "cmd+,,ctrl+,",
        event: "Dialog.Settings.Open",
        parameters: "preferences",
        icon: IconSettings,
        tags: ["settings", "preferences", "options"],
      },
      {
        description: ["Keyboard shortcuts"],
        keys: [[getPlatformSpecialKey(), "/"]],
        hotkeys: "cmd+/,ctrl+/",
        event: "Dialog.Shortcuts.Open",
        icon: IconKeyboard,
        tags: ["keyboard", "shortcuts", "help", "keys"],
      },
      {
        description: ["Workspace", "Switch"],
        hotkeys: "cmd+shift+up,ctrl+shift+up,cmd+shift+down,ctrl+shift+down",
        event: "Workspace.Switch",
        icon: IconComponent,
        tags: ["workspace", "switch", "dropdown"],
        visibility: { hideFrom: ["commands", "shortcuts"] },
      },
      {
        description: ["Help and support"],
        keys: [["?"]],
        hotkeys: "shift+/",
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
        hotkeys: "cmd+t,ctrl+t",
        event: "Tabs.Add",
        icon: IconPlusSquare,
        tags: ["tab", "new", "add", "open", "create"],
      },
      {
        description: ["Reopen last closed tab"],
        keys: [[getPlatformSpecialKey(), "⇧", "T"]],
        hotkeys: "cmd+shift+t,ctrl+shift+t",
        event: "Tabs.ReopenLast",
        icon: IconHistory,
        tags: ["tab", "reopen", "history", "restore", "undo"],
      },
      {
        description: ["Close current tab"],
        keys: [[getPlatformSpecialKey(), "W"]],
        hotkeys: "cmd+w,ctrl+w",
        event: "Tabs.Close",
        icon: IconMinusSquare,
        tags: ["tab", "close", "remove"],
      },
      {
        description: ["Close other tabs"],
        keys: [[getPlatformSpecialKey(), "⇧", "W"]],
        hotkeys: "cmd+shift+w,ctrl+shift+w",
        event: "Tabs.Close.Others",
        icon: IconXCircle,
        tags: ["tab", "close", "remove", "others"],
      },
      {
        description: ["Close all tabs"],
        keys: [[getPlatformSpecialKey(), getPlatformAlternateKey(), "W"]],
        hotkeys: "cmd+alt+w,ctrl+alt+w",
        event: "Tabs.Close.All",
        icon: IconXSquare,
        tags: ["tab", "close", "remove", "all", "clear"],
      },
      {
        description: ["Duplicate tab"],
        keys: [[getPlatformSpecialKey(), "D"]],
        hotkeys: "cmd+d,ctrl+d",
        event: "Tabs.Duplicate",
        icon: IconCopy,
        tags: ["tab", "duplicate", "copy", "clone"],
      },
      {
        description: ["Rename tab"],
        keys: [["F2"]],
        hotkeys: "f2",
        event: "Tabs.Rename",
        icon: IconSquarePen,
        tags: ["tab", "rename", "edit", "name"],
      },
      {
        description: ["Select next tab"],
        keys: [[getPlatformControlKey(), "Tab"]],
        hotkeys: "ctrl+tab",
        event: "Tabs.Select",
        parameters: "next",
        icon: IconCheckSquare2,
        tags: ["tab", "next", "switch", "cycle"],
        visibility: { hideFrom: ["commands"] },
      },
      {
        description: ["Select previous tab"],
        keys: [[getPlatformControlKey(), "⇧", "Tab"]],
        hotkeys: "ctrl+shift+tab",
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
        hotkeys: "cmd+\\,ctrl+\\",
        event: "Sidebar.Left.Toggle",
        icon: IconPanelLeft,
        tags: ["sidebar", "toggle", "layout", "left", "panel"],
      },
      {
        description: ["Sidebar", "Right"],
        keys: [[getPlatformSpecialKey(), "⇧", "\\"]],
        hotkeys: "cmd+shift+\\,ctrl+shift+\\",
        event: "Sidebar.Right.Toggle",
        icon: IconPanelRight,
        tags: ["sidebar", "toggle", "layout", "right", "panel"],
      },
      {
        description: ["Panel", "Bottom"],
        keys: [[getPlatformSpecialKey(), "J"]],
        hotkeys: "cmd+j,ctrl+j",
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
        hotkeys: "cmd+;,ctrl+;",
        event: "Dialog.Settings.Open",
        parameters: "overview",
        icon: IconComponent,
        tags: ["settings", "team", "overview", "workspace", "organization"],
        visibility: { hideFrom: ["commands"] },
      },
      // workspaces
      {
        description: ["Settings", "Team", "Workspaces"],
        keys: [[getPlatformSpecialKey(), "⇧", "W"]],
        hotkeys: "cmd+shift+w,ctrl+shift+w",
        event: "Dialog.Settings.Open",
        parameters: "workspaces",
        icon: IconSettings,
        tags: ["settings", "team", "workspaces", "projects"],
        visibility: { hideFrom: ["commands"] },
      },
      {
        description: ["Settings", "Team", "Members"],
        keys: [[getPlatformSpecialKey(), "⇧", "M"]],
        hotkeys: "cmd+shift+m,ctrl+shift+m",
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
        hotkeys: "cmd+shift+l,ctrl+shift+l",
        event: "Dialog.Exit.Open",
        icon: IconLogOut,
        tags: ["logout", "sign out", "exit", "session"],
      },
    ],
  },
]

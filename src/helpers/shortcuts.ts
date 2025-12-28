import {
  IconBolt,
  IconCheckSquare2,
  IconCircleUser,
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
  IconXCircle,
  IconXSquare,
} from "@/data/icons"
import type { FunctionalComponent, SVGAttributes } from "vue"

const isAppleDevice = () => /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)

/**
 * Returns the platform-specific modifier key
 * @returns '⌘' for macOS, 'Ctrl' for others
 */
export const getPlatformSpecialKey = (): string =>
  isAppleDevice() ? "⌘" : "Ctrl"

/**
 * Returns the platform-specific alternate key
 * @returns '⌥' for macOS, 'Alt' for others
 */
export const getPlatformAlternateKey = (): string =>
  isAppleDevice() ? "⌥" : "Alt"

/**
 * Returns the platform-specific control key
 * @returns '⌃' for macOS, 'Ctrl' for others
 */
export const getPlatformControlKey = (): string =>
  isAppleDevice() ? "⌃" : "Ctrl"

type ShortcutHiddenType =
  | "hotkeys"
  | "web"
  | "desktop"
  | "shortcuts"
  | "commands"

export type Shortcut = {
  description: string[]
  keys: string[][]
  hotkeys: string
  event: string
  parameters: string | number | undefined
  icon: FunctionalComponent<SVGAttributes>
  tags: string[]
  hidden: ShortcutHiddenType[]
}

export type ShortcutCategory = {
  title: string
  id: string
  shortcuts: Shortcut[]
  hidden: ShortcutHiddenType[]
}

/**
 * Application Shortcuts Configuration
 * Defines all keyboard shortcuts, their events, descriptions, and visibility rules
 */
export const shortcuts: ShortcutCategory[] = [
  {
    title: "General",
    id: "general",
    shortcuts: [
      {
        description: ["Commands"],
        keys: [[getPlatformSpecialKey(), "K"]],
        hotkeys: "cmd+k,ctrl+k",
        event: "Dialog.Command.Open",
        parameters: undefined,
        icon: IconTerminal,
        tags: ["command", "search"],
        hidden: ["commands"],
      },
      {
        description: ["Ask AI"],
        keys: [[getPlatformSpecialKey(), "↩"]],
        hotkeys: "cmd+enter,ctrl+enter",
        event: "Dialog.AiAsk.Toggle",
        parameters: undefined,
        icon: IconSparkles,
        tags: ["ai", "ask"],
        hidden: [],
      },
      {
        description: ["Settings"],
        keys: [[getPlatformSpecialKey(), ","]],
        hotkeys: "cmd+,,ctrl+,",
        event: "Dialog.Settings.Open",
        parameters: "preferences",
        icon: IconSettings,
        tags: ["settings"],
        hidden: [],
      },
      {
        description: ["Keyboard shortcuts"],
        keys: [[getPlatformSpecialKey(), "/"]],
        hotkeys: "cmd+/,ctrl+/",
        event: "Dialog.Shortcuts.Open",
        parameters: undefined,
        icon: IconKeyboard,
        tags: ["keyboard", "shortcuts", "help"],
        hidden: [],
      },
      {
        description: ["Help and support"],
        keys: [["?"]],
        hotkeys: "shift+/",
        event: "Menu.Help.Toggle",
        parameters: undefined,
        icon: IconHelpCircle,
        tags: ["help", "support"],
        hidden: [],
      },
    ],
    hidden: [],
  },
  {
    title: "Layout",
    id: "layout",
    shortcuts: [
      {
        description: ["Sidebar", "Left"],
        keys: [[getPlatformSpecialKey(), "\\"]],
        hotkeys: "cmd+\\,ctrl+\\",
        event: "Sidebar.Left.Toggle",
        parameters: undefined,
        icon: IconPanelLeft,
        tags: ["sidebar", "toggle", "layout"],
        hidden: [],
      },
      {
        description: ["Sidebar", "Right"],
        keys: [[getPlatformSpecialKey(), "⇧", "\\"]],
        hotkeys: "cmd+shift+\\,ctrl+shift+\\",
        event: "Sidebar.Right.Toggle",
        parameters: undefined,
        icon: IconPanelRight,
        tags: ["sidebar", "toggle", "layout"],
        hidden: [],
      },
      {
        description: ["Panel", "Bottom"],
        keys: [[getPlatformSpecialKey(), "J"]],
        hotkeys: "cmd+j,ctrl+j",
        event: "Panel.Bottom.Toggle",
        parameters: undefined,
        icon: IconPanelBottom,
        tags: ["panel", "toggle", "layout"],
        hidden: [],
      },
    ],
    hidden: [],
  },
  {
    title: "Tabs",
    id: "tabs",
    shortcuts: [
      {
        description: ["Open new tab"],
        keys: [[getPlatformSpecialKey(), "T"]],
        hotkeys: "cmd+t,ctrl+t",
        event: "Tabs.Add",
        parameters: undefined,
        icon: IconPlusSquare,
        tags: ["tab", "new", "add", "open"],
        hidden: [],
      },
      {
        description: ["Reopen last closed tab"],
        keys: [[getPlatformSpecialKey(), "⇧", "T"]],
        hotkeys: "cmd+shift+t,ctrl+shift+t",
        event: "Tabs.ReopenLast",
        parameters: undefined,
        icon: IconHistory,
        tags: ["tab", "reopen", "history"],
        hidden: [],
      },
      {
        description: ["Close current tab"],
        keys: [[getPlatformSpecialKey(), "W"]],
        hotkeys: "cmd+w,ctrl+w",
        event: "Tabs.Close",
        parameters: undefined,
        icon: IconMinusSquare,
        tags: ["tab", "close", "remove"],
        hidden: [],
      },
      {
        description: ["Close other tabs"],
        keys: [[getPlatformSpecialKey(), "⇧", "W"]],
        hotkeys: "cmd+shift+w,ctrl+shift+w",
        event: "Tabs.Close.Others",
        parameters: undefined,
        icon: IconXCircle,
        tags: ["tab", "close", "remove", "others"],
        hidden: [],
      },
      {
        description: ["Close all tabs"],
        keys: [[getPlatformSpecialKey(), getPlatformAlternateKey(), "W"]],
        hotkeys: "cmd+alt+w,ctrl+alt+w",
        event: "Tabs.Close.All",
        parameters: undefined,
        icon: IconXSquare,
        tags: ["tab", "close", "remove", "all"],
        hidden: [],
      },
      {
        description: ["Duplicate tab"],
        keys: [[getPlatformSpecialKey(), "D"]],
        hotkeys: "cmd+d,ctrl+d",
        event: "Tabs.Duplicate",
        parameters: undefined,
        icon: IconCopy,
        tags: ["tab", "duplicate", "copy"],
        hidden: [],
      },
      {
        description: ["Rename tab"],
        keys: [["F2"]],
        hotkeys: "f2",
        event: "Tabs.Rename",
        parameters: undefined,
        icon: IconSquarePen,
        tags: ["tab", "rename", "edit"],
        hidden: [],
      },
      {
        description: ["Select next tab"],
        keys: [[getPlatformControlKey(), "Tab"]],
        hotkeys: "ctrl+tab",
        event: "Tabs.Select",
        parameters: "next",
        icon: IconCheckSquare2,
        tags: ["tab", "next", "switch"],
        hidden: ["commands"],
      },
      {
        description: ["Select previous tab"],
        keys: [[getPlatformControlKey(), "⇧", "Tab"]],
        hotkeys: "ctrl+shift+tab",
        event: "Tabs.Select",
        parameters: "previous",
        icon: IconCheckSquare2,
        tags: ["tab", "previous", "switch"],
        hidden: ["commands"],
      },
      {
        description: ["Select Nth tab"],
        keys: [[getPlatformSpecialKey(), "1, 2, 3, ..., N"]],
        hotkeys: "",
        event: "Tabs.Select",
        parameters: undefined,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["hotkeys", "commands"],
      },
      {
        description: ["Select tab 1"],
        keys: [[getPlatformSpecialKey(), "1"]],
        hotkeys: "cmd+1,ctrl+1",
        event: "Tabs.Select",
        parameters: 1,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
      {
        description: ["Select tab 2"],
        keys: [[getPlatformSpecialKey(), "2"]],
        hotkeys: "cmd+2,ctrl+2",
        event: "Tabs.Select",
        parameters: 2,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
      {
        description: ["Select tab 3"],
        keys: [[getPlatformSpecialKey(), "3"]],
        hotkeys: "cmd+3,ctrl+3",
        event: "Tabs.Select",
        parameters: 3,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
      {
        description: ["Select tab 4"],
        keys: [[getPlatformSpecialKey(), "4"]],
        hotkeys: "cmd+4,ctrl+4",
        event: "Tabs.Select",
        parameters: 4,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
      {
        description: ["Select tab 5"],
        keys: [[getPlatformSpecialKey(), "5"]],
        hotkeys: "cmd+5,ctrl+5",
        event: "Tabs.Select",
        parameters: 5,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
      {
        description: ["Select tab 6"],
        keys: [[getPlatformSpecialKey(), "6"]],
        hotkeys: "cmd+6,ctrl+6",
        event: "Tabs.Select",
        parameters: 6,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
      {
        description: ["Select tab 7"],
        keys: [[getPlatformSpecialKey(), "7"]],
        hotkeys: "cmd+7,ctrl+7",
        event: "Tabs.Select",
        parameters: 7,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
      {
        description: ["Select tab 8"],
        keys: [[getPlatformSpecialKey(), "8"]],
        hotkeys: "cmd+8,ctrl+8",
        event: "Tabs.Select",
        parameters: 8,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
      {
        description: ["Select tab 9"],
        keys: [[getPlatformSpecialKey(), "9"]],
        hotkeys: "cmd+9,ctrl+9",
        event: "Tabs.Select",
        parameters: 9,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands", "shortcuts"],
      },
    ],
    hidden: ["web", "commands"],
  },
  {
    title: "Settings",
    id: "settings",
    shortcuts: [
      {
        description: ["Settings", "General"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Settings.Open",
        parameters: "general",
        icon: IconBolt,
        tags: ["settings", "general"],
        hidden: [],
      },
      {
        description: ["Settings", "Account"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Settings.Open",
        parameters: "account",
        icon: IconCircleUser,
        tags: ["settings", "account"],
        hidden: [],
      },
      {
        description: ["Settings", "Appearance"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Settings.Open",
        parameters: "appearance",
        icon: IconPalette,
        tags: ["settings", "appearance", "theme"],
        hidden: [],
      },
      {
        description: ["Settings", "Billing"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Settings.Open",
        parameters: "billing",
        icon: IconCreditCard,
        tags: ["settings", "billing"],
        hidden: [],
      },
    ],
    hidden: ["hotkeys", "shortcuts"],
  },
  {
    title: "Appearance",
    id: "appearance",
    shortcuts: [
      {
        description: ["Theme", "Light"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "light",
        icon: IconSun,
        tags: ["settings", "theme", "light"],
        hidden: [],
      },
      {
        description: ["Theme", "Dark"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "dark",
        icon: IconMoon,
        tags: ["settings", "theme", "dark"],
        hidden: [],
      },
      {
        description: ["Theme", "Accent"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "accent",
        icon: IconPalette,
        tags: ["settings", "theme", "accent"],
        hidden: [],
      },
      {
        description: ["Theme", "Auto"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "auto",
        icon: IconMonitor,
        tags: ["settings", "theme", "auto"],
        hidden: [],
      },
    ],
    hidden: ["hotkeys", "shortcuts"],
  },
  {
    title: "Account",
    id: "account",
    shortcuts: [
      {
        description: ["Logout"],
        keys: [[getPlatformSpecialKey(), "⇧", "O"]],
        hotkeys: "cmd+shift+o,ctrl+shift+o",
        event: "Dialog.Exit.Open",
        parameters: undefined,
        icon: IconLogOut,
        tags: ["logout", "sign out"],
        hidden: [],
      },
    ],
    hidden: [],
  },
]

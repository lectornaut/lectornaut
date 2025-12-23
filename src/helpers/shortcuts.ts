import {
  IconBolt,
  IconCheckSquare2,
  IconCircleUser,
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

// const getPlatformAlternateKey = () => (isAppleDevice() ? "⌥" : "Alt")

type ShortcutHiddenType = "web" | "desktop" | "shortcuts" | "commands"

export type Shortcut = {
  description: string[]
  keys: string[][]
  hotkeys: string
  event: string
  parameters: string | undefined
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
        keys: [[getPlatformSpecialKey(), "`"]],
        hotkeys: "cmd+`,ctrl+`",
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
        keys: [[getPlatformSpecialKey(), "⇧", "Q"]],
        hotkeys: "cmd+shift+q,ctrl+shift+q",
        event: "Tabs.Close.All",
        parameters: undefined,
        icon: IconXSquare,
        tags: ["tab", "close", "remove", "all"],
        hidden: [],
      },
      {
        description: ["Select next tab"],
        keys: [[getPlatformSpecialKey(), "⇧", "▶"]],
        hotkeys: "control+tab,ctrl+tab",
        event: "Tabs.Select",
        parameters: "next",
        icon: IconCheckSquare2,
        tags: ["tab", "next"],
        hidden: ["commands"],
      },
      {
        description: ["Select previous tab"],
        keys: [[getPlatformSpecialKey(), "⇧", "◀"]],
        hotkeys: "control+shift+tab,ctrl+shift+tab",
        event: "Tabs.Select",
        parameters: "previous",
        icon: IconCheckSquare2,
        tags: ["tab", "previous"],
        hidden: ["commands"],
      },
      {
        description: ["Select Nth tab"],
        keys: [[getPlatformSpecialKey(), "1, 2, 3...N"]],
        hotkeys:
          "cmd+num_1,cmd+num_2,cmd+num_3,cmd+num_4,cmd+num_5,cmd+num_6,cmd+num_7,cmd+num_8,cmd+num_9,ctrl+num_1,ctrl+num_2,ctrl+num_3,ctrl+num_4,ctrl+num_5,ctrl+num_6,ctrl+num_7,ctrl+num_8,ctrl+num_9",
        event: "Tabs.Select",
        parameters: undefined,
        icon: IconCheckSquare2,
        tags: ["tab", "select"],
        hidden: ["commands"],
      },
    ],
    hidden: ["web"],
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
    hidden: ["shortcuts"],
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
    hidden: ["shortcuts"],
  },
  {
    title: "Account",
    id: "account",
    shortcuts: [
      {
        description: ["Logout"],
        keys: [[getPlatformSpecialKey(), "⇧", "L"]],
        hotkeys: "cmd+shift+l,ctrl+shift+l",
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

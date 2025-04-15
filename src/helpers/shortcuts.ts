import type { FunctionalComponent, SVGAttributes } from "vue"
import IconLucideCheckSquare2 from "~icons/lucide/check-square-2"
import IconLucideCircleUser from "~icons/lucide/circle-user"
import IconLucideHelpCircle from "~icons/lucide/help-circle"
import IconLucideLogout from "~icons/lucide/log-out"
import IconLucideMinusSquare from "~icons/lucide/minus-square"
import IconLucideMonitor from "~icons/lucide/monitor"
import IconLucideMoon from "~icons/lucide/moon"
import IconLucidePanelLeft from "~icons/lucide/panel-left"
import IconLucidePanelRight from "~icons/lucide/panel-right"
import IconLucidePlusSquare from "~icons/lucide/plus-square"
import IconLucideSettings from "~icons/lucide/settings"
import IconLucideSun from "~icons/lucide/sun"
import IconLucideTerminal from "~icons/lucide/terminal"
import IconLucideXSquare from "~icons/lucide/x-square"
import IconLucideZap from "~icons/lucide/zap"

const isAppleDevice = () => /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)

export const getPlatformSpecialKey = (): string =>
  isAppleDevice() ? "⌘" : "Ctrl"

// const getPlatformAlternateKey = () => (isAppleDevice() ? "⌥" : "Alt")

type Shortcut = {
  description: string[]
  keys: string[][]
  hotkeys: string
  event: string
  parameters: string | undefined
  icon: FunctionalComponent<SVGAttributes> | string
  tags: string[]
}

type ShortcutCategory = {
  title: string
  id: string
  shortcuts: Shortcut[]
  hidden: string[]
}

export const shortcuts: ShortcutCategory[] = [
  {
    title: "General",
    id: "general",
    shortcuts: [
      {
        description: ["Command"],
        keys: [[getPlatformSpecialKey(), "k"]],
        hotkeys: "cmd+k,ctrl+k",
        event: "Dialog.Command.Open",
        parameters: undefined,
        icon: IconLucideTerminal,
        tags: ["command", "search"],
      },
      {
        description: ["Keyboard shortcuts"],
        keys: [[getPlatformSpecialKey(), "/"]],
        hotkeys: "cmd+/,ctrl+/",
        event: "Dialog.Shortcuts.Open",
        parameters: undefined,
        icon: IconLucideZap,
        tags: ["keyboard", "shortcuts", "help"],
      },
      {
        description: ["Open settings"],
        keys: [[getPlatformSpecialKey(), ","]],
        hotkeys: "cmd+,,ctrl+,",
        event: "Dialog.Settings.Open",
        parameters: "general",
        icon: IconLucideSettings,
        tags: ["settings"],
      },
      {
        description: ["Open help"],
        keys: [["?"]],
        hotkeys: "shift+/",
        event: "Menu.Help.Toggle",
        parameters: undefined,
        icon: IconLucideHelpCircle,
        tags: ["help", "support"],
      },
      {
        description: ["Sidebar", "Left"],
        keys: [[getPlatformSpecialKey(), "\\"]],
        hotkeys: "cmd+\\,ctrl+\\",
        event: "Sidebar.Left.Toggle",
        parameters: undefined,
        icon: IconLucidePanelLeft,
        tags: ["sidebar", "toggle"],
      },
      {
        description: ["Sidebar", "Right"],
        keys: [[getPlatformSpecialKey(), "shift", "\\"]],
        hotkeys: "cmd+shift+\\,ctrl+shift+\\",
        event: "Sidebar.Right.Toggle",
        parameters: undefined,
        icon: IconLucidePanelRight,
        tags: ["sidebar", "toggle"],
      },
    ],
    hidden: [],
  },
  {
    title: "Tabs",
    id: "tabs",
    shortcuts: [
      {
        description: ["Open a tab"],
        keys: [[getPlatformSpecialKey(), "t"]],
        hotkeys: "cmd+t,ctrl+t",
        event: "Tabs.Add",
        parameters: undefined,
        icon: IconLucidePlusSquare,
        tags: ["tab", "new", "add", "open"],
      },
      {
        description: ["Close current tab"],
        keys: [[getPlatformSpecialKey(), "w"]],
        hotkeys: "cmd+w,ctrl+w",
        event: "Tabs.Close",
        parameters: undefined,
        icon: IconLucideMinusSquare,
        tags: ["tab", "close", "remove"],
      },
      {
        description: ["Close other tabs"],
        keys: [[getPlatformSpecialKey(), "shift", "w"]],
        hotkeys: "cmd+shift+w,ctrl+shift+w",
        event: "Tabs.Close.Other",
        parameters: undefined,
        icon: IconLucideXSquare,
        tags: ["tab", "close", "remove", "others"],
      },
      {
        description: ["Select Nth tab"],
        keys: [[getPlatformSpecialKey(), "1, 2, 3...n"]],
        hotkeys: "",
        event: "Tabs.Select",
        parameters: undefined,
        icon: IconLucideCheckSquare2,
        tags: ["tab", "select"],
      },
    ],
    hidden: ["web"],
  },
  {
    title: "Account",
    id: "account",
    shortcuts: [
      {
        description: ["Logout"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Exit.Open",
        parameters: undefined,
        icon: IconLucideLogout,
        tags: ["logout", "sign out"],
      },
      {
        description: ["Settings", "Account"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Settings.Open",
        parameters: "account",
        icon: IconLucideCircleUser,
        tags: ["settings", "account"],
      },
    ],
    hidden: ["shortcuts"],
  },
  {
    title: "Settings",
    id: "settings",
    shortcuts: [
      {
        description: ["Change theme", "Light"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "light",
        icon: IconLucideSun,
        tags: ["settings", "theme", "light"],
      },
      {
        description: ["Change theme", "Dark"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "dark",
        icon: IconLucideMoon,
        tags: ["settings", "theme", "dark"],
      },
      {
        description: ["Change theme", "Auto"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "auto",
        icon: IconLucideMonitor,
        tags: ["settings", "theme", "auto"],
      },
      {
        description: ["Settings", "Appearance"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Settings.Open",
        parameters: "appearance",
        icon: IconLucideSettings,
        tags: ["settings", "theme"],
      },
    ],
    hidden: ["shortcuts"],
  },
]

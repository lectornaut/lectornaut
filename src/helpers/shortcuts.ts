import type { FunctionalComponent, SVGAttributes } from "vue"
import IconLucideBolt from "~icons/lucide/bolt"
import IconLucideCheckSquare2 from "~icons/lucide/check-square-2"
import IconLucideCircleUser from "~icons/lucide/circle-user"
import IconLucideXCircle from "~icons/lucide/circle-x"
import IconCreditCard from "~icons/lucide/credit-card"
import IconLucideHelpCircle from "~icons/lucide/help-circle"
import IconLucideHistory from "~icons/lucide/history"
import IconLucideKeyboard from "~icons/lucide/keyboard"
import IconLucideLogout from "~icons/lucide/log-out"
import IconLucideMinusSquare from "~icons/lucide/minus-square"
import IconLucideMonitor from "~icons/lucide/monitor"
import IconLucideMoon from "~icons/lucide/moon"
import IconLucidePalette from "~icons/lucide/palette"
import IconLucidePanelBottom from "~icons/lucide/panel-bottom"
import IconLucidePanelLeft from "~icons/lucide/panel-left"
import IconLucidePanelRight from "~icons/lucide/panel-right"
import IconLucidePlusSquare from "~icons/lucide/plus-square"
import IconLucideSettings from "~icons/lucide/settings"
import IconLucideXSquare from "~icons/lucide/square-x"
import IconLucideSun from "~icons/lucide/sun"
import IconLucideTerminal from "~icons/lucide/terminal"

const isAppleDevice = () => /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)

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
  icon: FunctionalComponent<SVGAttributes> | string
  tags: string[]
  hidden: ShortcutHiddenType[]
}

export type ShortcutCategory = {
  title: string
  id: string
  shortcuts: Shortcut[]
  hidden: ShortcutHiddenType[]
}

export const shortcuts: ShortcutCategory[] = [
  {
    title: "General",
    id: "general",
    shortcuts: [
      {
        description: ["Commands"],
        keys: [[getPlatformSpecialKey(), "k"]],
        hotkeys: "cmd+k,ctrl+k",
        event: "Dialog.Command.Open",
        parameters: undefined,
        icon: IconLucideTerminal,
        tags: ["command", "search"],
        hidden: ["commands"],
      },
      {
        description: ["Keyboard shortcuts"],
        keys: [[getPlatformSpecialKey(), "/"]],
        hotkeys: "cmd+/,ctrl+/",
        event: "Dialog.Shortcuts.Open",
        parameters: undefined,
        icon: IconLucideKeyboard,
        tags: ["keyboard", "shortcuts", "help"],
        hidden: [],
      },
      {
        description: ["Help and support"],
        keys: [["?"]],
        hotkeys: "shift+/",
        event: "Menu.Help.Toggle",
        parameters: undefined,
        icon: IconLucideHelpCircle,
        tags: ["help", "support"],
        hidden: [],
      },
      {
        description: ["Settings"],
        keys: [[getPlatformSpecialKey(), ","]],
        hotkeys: "cmd+,,ctrl+,",
        event: "Dialog.Settings.Open",
        parameters: "preferences",
        icon: IconLucideSettings,
        tags: ["settings"],
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
        icon: IconLucidePanelLeft,
        tags: ["sidebar", "toggle", "layout"],
        hidden: [],
      },
      {
        description: ["Sidebar", "Right"],
        keys: [[getPlatformSpecialKey(), "⇧", "\\"]],
        hotkeys: "cmd+shift+\\,ctrl+shift+\\",
        event: "Sidebar.Right.Toggle",
        parameters: undefined,
        icon: IconLucidePanelRight,
        tags: ["sidebar", "toggle", "layout"],
        hidden: [],
      },
      {
        description: ["Panel", "Bottom"],
        keys: [[getPlatformSpecialKey(), "`"]],
        hotkeys: "cmd+`,ctrl+`",
        event: "Panel.Bottom.Toggle",
        parameters: undefined,
        icon: IconLucidePanelBottom,
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
        keys: [[getPlatformSpecialKey(), "t"]],
        hotkeys: "cmd+t,ctrl+t",
        event: "Tabs.Add",
        parameters: undefined,
        icon: IconLucidePlusSquare,
        tags: ["tab", "new", "add", "open"],
        hidden: [],
      },
      {
        description: ["Reopen last closed tab"],
        keys: [[getPlatformSpecialKey(), "⇧", "t"]],
        hotkeys: "cmd+shift+t,ctrl+shift+t",
        event: "Tabs.ReopenLast",
        parameters: undefined,
        icon: IconLucideHistory,
        tags: ["tab", "reopen", "history"],
        hidden: [],
      },
      {
        description: ["Close current tab"],
        keys: [[getPlatformSpecialKey(), "w"]],
        hotkeys: "cmd+w,ctrl+w",
        event: "Tabs.Close",
        parameters: undefined,
        icon: IconLucideMinusSquare,
        tags: ["tab", "close", "remove"],
        hidden: [],
      },
      {
        description: ["Close other tabs"],
        keys: [[getPlatformSpecialKey(), "⇧", "w"]],
        hotkeys: "cmd+shift+w,ctrl+shift+w",
        event: "Tabs.Close.Others",
        parameters: undefined,
        icon: IconLucideXCircle,
        tags: ["tab", "close", "remove", "others"],
        hidden: [],
      },
      {
        description: ["Close all tabs"],
        keys: [[getPlatformSpecialKey(), "⇧", "q"]],
        hotkeys: "cmd+shift+q,ctrl+shift+q",
        event: "Tabs.Close.All",
        parameters: undefined,
        icon: IconLucideXSquare,
        tags: ["tab", "close", "remove", "all"],
        hidden: [],
      },
      {
        description: ["Select next tab"],
        keys: [[getPlatformSpecialKey(), "⇧", "right"]],
        hotkeys: "control+tab,ctrl+tab",
        event: "Tabs.Select",
        parameters: "next",
        icon: IconLucideCheckSquare2,
        tags: ["tab", "next"],
        hidden: ["commands"],
      },
      {
        description: ["Select previous tab"],
        keys: [[getPlatformSpecialKey(), "⇧", "left"]],
        hotkeys: "control+shift+tab,ctrl+shift+tab",
        event: "Tabs.Select",
        parameters: "previous",
        icon: IconLucideCheckSquare2,
        tags: ["tab", "previous"],
        hidden: ["commands"],
      },
      {
        description: ["Select Nth tab"],
        keys: [[getPlatformSpecialKey(), "1, 2, 3...n"]],
        hotkeys:
          "cmd+num_1,cmd+num_2,cmd+num_3,cmd+num_4,cmd+num_5,cmd+num_6,cmd+num_7,cmd+num_8,cmd+num_9,ctrl+num_1,ctrl+num_2,ctrl+num_3,ctrl+num_4,ctrl+num_5,ctrl+num_6,ctrl+num_7,ctrl+num_8,ctrl+num_9",
        event: "Tabs.Select",
        parameters: undefined,
        icon: IconLucideCheckSquare2,
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
        icon: IconLucideBolt,
        tags: ["settings", "general"],
        hidden: [],
      },
      {
        description: ["Settings", "Account"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Settings.Open",
        parameters: "account",
        icon: IconLucideCircleUser,
        tags: ["settings", "account"],
        hidden: [],
      },
      {
        description: ["Settings", "Appearance"],
        keys: [],
        hotkeys: "",
        event: "Dialog.Settings.Open",
        parameters: "appearance",
        icon: IconLucidePalette,
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
        icon: IconLucideSun,
        tags: ["settings", "theme", "light"],
        hidden: [],
      },
      {
        description: ["Theme", "Dark"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "dark",
        icon: IconLucideMoon,
        tags: ["settings", "theme", "dark"],
        hidden: [],
      },
      {
        description: ["Theme", "Auto"],
        keys: [],
        hotkeys: "",
        event: "Theme.Change",
        parameters: "auto",
        icon: IconLucideMonitor,
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
        keys: [],
        hotkeys: "",
        event: "Dialog.Exit.Open",
        parameters: undefined,
        icon: IconLucideLogout,
        tags: ["logout", "sign out"],
        hidden: [],
      },
    ],
    hidden: ["shortcuts"],
  },
]

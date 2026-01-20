import {
  IconActivity,
  IconArrowDownToLine,
  IconAsterisk,
  IconBadgeCheck,
  IconBadgeDollarSign,
  IconBell,
  IconBlocks,
  IconBolt,
  IconBot,
  IconBriefcase,
  IconCircleUserRound,
  IconComponent,
  IconCreditCard,
  IconDatabase,
  IconFileText,
  IconFontMono,
  IconFontSans,
  IconFontSansSerif,
  IconHome,
  IconJapan,
  IconLifeBuoy,
  IconLock,
  IconLogs,
  IconMdiFormatTextVariant,
  IconMessageCircle,
  IconMoon,
  IconPalette,
  IconScroll,
  IconSettings,
  IconShieldCheck,
  IconSparkle,
  IconSun,
  IconSunMoon,
  IconUSA,
  IconUserRound,
  IconUsersRound,
} from "@/data/icons"

export const languages = [
  {
    id: "en-US",
    name: "English",
    icon: IconUSA,
  },
  {
    id: "ja-JP",
    name: "Japanese",
    icon: IconJapan,
  },
] as const

export type LanguageId = (typeof languages)[number]["id"]
export const defaultLanguage: LanguageId = "en-US"

export const themes = [
  {
    id: "light",
    name: "Light",
    icon: IconSun,
  },
  {
    id: "dark",
    name: "Dark",
    icon: IconMoon,
  },
  {
    id: "auto",
    name: "Auto",
    icon: IconSunMoon,
  },
] as const

export type ThemeId = (typeof themes)[number]["id"]
export const defaultTheme: ThemeId = "auto"

export const accents = [
  { id: "red", name: "Red", style: "text-red-500" },
  { id: "orange", name: "Orange", style: "text-orange-500" },
  { id: "amber", name: "Amber", style: "text-amber-500" },
  { id: "yellow", name: "Yellow", style: "text-yellow-500" },
  { id: "lime", name: "Lime", style: "text-lime-500" },
  { id: "green", name: "Green", style: "text-green-500" },
  { id: "emerald", name: "Emerald", style: "text-emerald-500" },
  { id: "teal", name: "Teal", style: "text-teal-500" },
  { id: "cyan", name: "Cyan", style: "text-cyan-500" },
  { id: "sky", name: "Sky", style: "text-sky-500" },
  { id: "blue", name: "Blue", style: "text-blue-500" },
  { id: "indigo", name: "Indigo", style: "text-indigo-500" },
  { id: "violet", name: "Violet", style: "text-violet-500" },
  { id: "purple", name: "Purple", style: "text-purple-500" },
  { id: "fuchsia", name: "Fuchsia", style: "text-fuchsia-500" },
  { id: "pink", name: "Pink", style: "text-pink-500" },
  { id: "rose", name: "Rose", style: "text-rose-500" },
] as const

export type AccentId = (typeof accents)[number]["id"]

export const bases = [
  { id: "slate", name: "Slate", style: "text-slate-500" },
  { id: "gray", name: "Gray", style: "text-gray-500" },
  { id: "zinc", name: "Zinc", style: "text-zinc-500" },
  { id: "neutral", name: "Neutral", style: "text-neutral-500" },
  { id: "stone", name: "Stone", style: "text-stone-500" },
  { id: "accent", name: "Accent", style: "text-primary" },
] as const

export type BaseId = (typeof bases)[number]["id"]

export const defaultBase: BaseId = "neutral"
export const defaultAccent: AccentId = "orange"

export const fonts = [
  { id: "sans", name: "Sans", icon: IconFontSans, style: "font-sans" },
  { id: "serif", name: "Serif", icon: IconFontSansSerif, style: "font-serif" },
  { id: "mono", name: "Mono", icon: IconFontMono, style: "font-mono" },
] as const

export type FontId = (typeof fonts)[number]["id"]

export const defaultFont: FontId = "sans"

export const sizes = [
  {
    id: "xs",
    name: "Extra small",
    icon: IconMdiFormatTextVariant,
    style: "text-xs",
  },
  { id: "sm", name: "Small", icon: IconMdiFormatTextVariant, style: "text-sm" },
  {
    id: "base",
    name: "Normal",
    icon: IconMdiFormatTextVariant,
    style: "text-base",
  },
  { id: "lg", name: "Large", icon: IconMdiFormatTextVariant, style: "text-lg" },
  {
    id: "xl",
    name: "Extra large",
    icon: IconMdiFormatTextVariant,
    style: "text-xl",
  },
] as const

export type SizeId = (typeof sizes)[number]["id"]

export const defaultSize: SizeId = "base"

export const defaultMenu = [
  {
    title: "Home",
    action: "Create a List",
    description: "Another to-do system you'll try but eventually give up on.",
    url: "/home",
    id: "home",
    icon: IconHome,
    style: {
      text: "text-pink-600/90 dark:text-pink-300/90",
      bg: "bg-pink-50 dark:bg-pink-950/40",
      grid: "",
    },
    shortcut: "⌘H",
  },
  {
    title: "Write",
    action: "Create a Document",
    description: "A place to write and organize your thoughts.",
    url: "/write",
    id: "write",
    icon: IconFileText,
    style: {
      text: "text-teal-700/90 dark:text-teal-300/90",
      bg: "bg-teal-50 dark:bg-teal-950/40",
      grid: "",
    },
    shortcut: "⌘W",
  },
  {
    title: "Agents",
    action: "Create a Calendar",
    description: "Stay on top of your deadlines, or don't — it's up to you.",
    url: "/agents",
    id: "agents",
    icon: IconBot,
    style: {
      text: "text-orange-700/90 dark:text-orange-300/90",
      bg: "bg-orange-50 dark:bg-orange-950/40",
      grid: "",
    },
    shortcut: "⌘A",
  },
  {
    title: "Tasks",
    action: "Create a Gallery",
    description: "Great for mood boards and inspiration.",
    url: "/tasks",
    id: "tasks",
    icon: IconBadgeCheck,
    style: {
      text: "text-green-700/90 dark:text-green-300/90",
      bg: "bg-green-50 dark:bg-green-950/40",
      grid: "",
    },
    shortcut: "⌘T",
  },
  {
    title: "Runs",
    action: "Create a Board",
    description: "Track tasks in different stages of your project.",
    url: "/runs",
    id: "runs",
    icon: IconActivity,
    style: {
      text: "text-blue-700/90 dark:text-blue-300/90",
      bg: "bg-blue-50 dark:bg-blue-950/40",
      grid: "",
    },
    shortcut: "⌘R",
  },
  {
    title: "Teams",
    action: "Create a Spreadsheet",
    description: "Lots of numbers and things — good for nerds.",
    url: "/teams",
    id: "teams",
    icon: IconComponent,
    style: {
      text: "text-indigo-700/90 dark:text-indigo-300/90",
      bg: "bg-indigo-50 dark:bg-indigo-950/40",
      grid: "",
    },
    shortcut: "⌘E",
  },
  {
    title: "Create",
    action: "Create a Timeline",
    description: "Get a birds-eye-view of your procrastination.",
    url: "/create",
    id: "create",
    icon: IconSparkle,
    style: {
      text: "text-purple-700/90 dark:text-purple-300/90",
      bg: "bg-purple-50 dark:bg-purple-950/40",
      grid: "",
    },
    shortcut: "⌘N",
  },
  {
    title: "Profile",
    action: "View Profile",
    description: "Manage your personal information and settings.",
    url: "/profile",
    id: "profile",
    icon: IconUserRound,
    style: {
      text: "text-rose-700/90 dark:text-rose-300/90",
      bg: "bg-rose-50 dark:bg-rose-950/40",
      grid: "",
    },
    shortcut: "⌘P",
  },
] as const

export const defaultRoutes = [
  "/new",
  "/start",
  "/welcome",
  ...defaultMenu.map((item) => item.url),
] as const

export const defaultCreateMenu = [
  {
    title: "New Document",
    action: "/new/document",
    id: "new-document",
    icon: IconFileText,
    style: {
      text: "text-teal-700/90 dark:text-teal-300/90",
      bg: "bg-teal-50 dark:bg-teal-950/40",
    },
  },
  {
    title: "New Agent",
    action: "/new/agent",
    id: "new-agent",
    icon: IconBot,
    style: {
      text: "text-orange-700/90 dark:text-orange-300/90",
      bg: "bg-orange-50 dark:bg-orange-950/40",
    },
  },
  {
    title: "New Task",
    action: "/new/task",
    id: "new-task",
    icon: IconBadgeCheck,
    style: {
      text: "text-green-700/90 dark:text-green-300/90",
      bg: "bg-green-50 dark:bg-green-950/40",
    },
  },
  {
    title: "New Run",
    action: "/new/run",
    id: "new-run",
    icon: IconActivity,
    style: {
      text: "text-blue-700/90 dark:text-blue-300/90",
      bg: "bg-blue-50 dark:bg-blue-950/40",
    },
  },
  {
    title: "New Team",
    action: "/new/team",
    id: "new-team",
    icon: IconUsersRound,
    style: {
      text: "text-indigo-700/90 dark:text-indigo-300/90",
      bg: "bg-indigo-50 dark:bg-indigo-950/40",
    },
  },
] as const

export const productsMenu = [
  {
    title: "Lectornaut",
    description: "The core platform for building AI agents",
    url: "https://lectornaut.io",
    id: "lectornaut",
    icon: IconAsterisk,
    style: {
      text: "text-sky-600/90 dark:text-sky-300/90",
      bg: "bg-sky-50 dark:bg-sky-950/40",
      grid: "",
    },
  },
  {
    title: "Lectornaut AI",
    description: "AI capabilities for your agents",
    url: "https://lectornaut.ai",
    id: "lectornaut-ai",
    icon: IconBot,
    style: {
      text: "text-blue-600/90 dark:text-blue-300/90",
      bg: "bg-blue-50 dark:bg-blue-950/40",
      grid: "",
    },
  },
  {
    title: "Lectornaut CLI",
    description: "Command line interface for Lectornaut",
    url: "https://lectornaut.io/cli",
    id: "lectornaut-cli",
    icon: IconComponent,
    style: {
      text: "text-pink-600/90 dark:text-pink-300/90",
      bg: "bg-pink-50 dark:bg-pink-950/40",
      grid: "",
    },
  },
  {
    title: "Lectornaut SDK",
    description: "Software Development Kit for Lectornaut",
    url: "https://lectornaut.io/sdk",
    id: "lectornaut-sdk",
    icon: IconBadgeCheck,
    style: {
      text: "text-rose-600/90 dark:text-rose-300/90",
      bg: "bg-rose-50 dark:bg-rose-950/40",
      grid: "",
    },
  },
] as const

export const solutionsMenu = [
  {
    title: "For Personal",
    id: "personal",
    items: [
      {
        title: "Lectornaut CLI",
        description: "Command line interface for Lectornaut",
        url: "https://lectornaut.io/cli",
        id: "lectornaut-cli",
        icon: IconComponent,
        style: {
          text: "text-violet-600/90 dark:text-violet-300/90",
          bg: "bg-violet-50 dark:bg-violet-950/40",
          grid: "",
        },
      },
      {
        title: "Lectornaut SDK",
        description: "Software Development Kit for Lectornaut",
        url: "https://lectornaut.io/sdk",
        id: "lectornaut-sdk",
        icon: IconComponent,
        style: {
          text: "text-violet-600/90 dark:text-violet-300/90",
          bg: "bg-violet-50 dark:bg-violet-950/40",
          grid: "",
        },
      },
    ],
  },
  {
    title: "For Professional",
    id: "professional",
    items: [
      {
        title: "Lectornaut Teams",
        description: "Collaborate with teams on Lectornaut",
        url: "https://lectornaut.io/teams",
        id: "lectornaut-teams",
        icon: IconComponent,
        style: {
          text: "text-purple-600/90 dark:text-purple-300/90",
          bg: "bg-purple-50 dark:bg-purple-950/40",
          grid: "",
        },
      },
      {
        title: "Lectornaut Runs",
        description: "Monitor and manage runs on Lectornaut",
        url: "https://lectornaut.io/runs",
        id: "lectornaut-runs",
        icon: IconComponent,
        style: {
          text: "text-purple-600/90 dark:text-purple-300/90",
          bg: "bg-purple-50 dark:bg-purple-950/40",
          grid: "",
        },
      },
    ],
  },
  {
    title: "For Business",
    id: "business",
    items: [
      {
        title: "Lectornaut Agents",
        description: "Build and deploy AI agents",
        url: "https://lectornaut.io/agents",
        id: "lectornaut-agents",
        icon: IconComponent,
        style: {
          text: "text-fuchsia-600/90 dark:text-fuchsia-300/90",
          bg: "bg-fuchsia-50 dark:bg-fuchsia-950/40",
          grid: "",
        },
      },
      {
        title: "Lectornaut AI",
        description: "AI capabilities for your agents",
        url: "https://lectornaut.io/ai",
        id: "lectornaut-ai",
        icon: IconComponent,
        style: {
          text: "text-fuchsia-600/90 dark:text-fuchsia-300/90",
          bg: "bg-fuchsia-50 dark:bg-fuchsia-950/40",
          grid: "",
        },
      },
    ],
  },
  {
    title: "For Enterprise",
    id: "enterprise",
    items: [
      {
        title: "Lectornaut Enterprise",
        description: "Enterprise solutions for Lectornaut",
        url: "https://lectornaut.io/enterprise",
        id: "lectornaut-enterprise",
        icon: IconComponent,
        style: {
          text: "text-pink-600/90 dark:text-pink-300/90",
          bg: "bg-pink-50 dark:bg-pink-950/40",
          grid: "",
        },
      },
      {
        title: "Lectornaut Cloud",
        description: "Cloud solutions for Lectornaut",
        url: "https://lectornaut.io/cloud",
        id: "lectornaut-cloud",
        icon: IconComponent,
        style: {
          text: "text-pink-600/90 dark:text-pink-300/90",
          bg: "bg-pink-50 dark:bg-pink-950/40",
          grid: "",
        },
      },
    ],
  },
] as const

export const resourcesMenu = [
  {
    title: "Download",
    description: "Get the latest version of Lectornaut",
    url: "https://lectornaut.io/download",
    id: "download",
    icon: IconArrowDownToLine,
    style: {
      text: "text-cyan-600/90 dark:text-cyan-300/90",
      bg: "bg-cyan-50 dark:bg-cyan-950/40",
      grid: "row-span-2",
    },
  },
  {
    title: "Developers",
    description: "Resources for developers",
    url: "https://developers.lectornaut.io",
    id: "developers",
    icon: IconUsersRound,
    style: {
      text: "text-teal-600/90 dark:text-teal-300/90",
      bg: "bg-teal-50 dark:bg-teal-950/40",
      grid: "",
    },
  },
  {
    title: "Documentation",
    description: "Guides and API references",
    url: "https://docs.lectornaut.io",
    id: "documentation",
    icon: IconFileText,
    style: {
      text: "text-emerald-600/90 dark:text-emerald-300/90",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      grid: "",
    },
  },
  {
    title: "Blog",
    description: "Insights and updates from team",
    url: "https://blog.lectornaut.io",
    id: "blog",
    icon: IconScroll,
    style: {
      text: "text-green-600/90 dark:text-green-300/90",
      bg: "bg-green-50 dark:bg-green-950/40",
      grid: "",
    },
  },
  {
    title: "Changelog",
    description: "What's new in Lectornaut",
    url: "https://lectornaut.io/changelog",
    id: "changelog",
    icon: IconLogs,
    style: {
      text: "text-lime-600/90 dark:text-lime-300/90",
      bg: "bg-lime-50 dark:bg-lime-950/40",
      grid: "",
    },
  },
  {
    title: "Customers",
    description: "See how others use Lectornaut",
    url: "https://customers.lectornaut.io",
    id: "customers",
    icon: IconUsersRound,
    style: {
      text: "text-yellow-600/90 dark:text-yellow-300/90",
      bg: "bg-yellow-50 dark:bg-yellow-950/40",
      grid: "",
    },
  },
  {
    title: "Community",
    description: "Join the Lectornaut community",
    url: "https://community.lectornaut.io",
    id: "community",
    icon: IconScroll,
    style: {
      text: "text-amber-600/90 dark:text-amber-300/90",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      grid: "",
    },
  },
  {
    title: "Security",
    description: "Safety and security resources",
    url: "https://security.lectornaut.io",
    id: "security",
    icon: IconShieldCheck,
    style: {
      text: "text-orange-600/90 dark:text-orange-300/90",
      bg: "bg-orange-50 dark:bg-orange-950/40",
      grid: "",
    },
  },
  {
    title: "Help Center",
    description: "Get help and support",
    url: "https://help.lectornaut.io",
    id: "help-center",
    icon: IconLifeBuoy,
    style: {
      text: "text-red-600/90 dark:text-red-300/90",
      bg: "bg-red-50 dark:bg-red-950/40",
      grid: "",
    },
  },
] as const

export const companyMenu = [
  {
    title: "About",
    description: "Meet the team",
    url: "https://lectornaut.io/about",
    id: "about-us",
    icon: IconUsersRound,
    style: {
      text: "text-neutral-600/90 dark:text-neutral-300/90",
      bg: "bg-neutral-50 dark:bg-neutral-950/40",
      grid: "",
    },
  },
  {
    title: "Careers",
    description: "Join our team",
    url: "https://lectornaut.io/careers",
    id: "careers",
    icon: IconBriefcase,
    style: {
      text: "text-neutral-600/90 dark:text-neutral-300/90",
      bg: "bg-neutral-50 dark:bg-neutral-950/40",
      grid: "",
    },
  },
  {
    title: "Contact",
    description: "Get in touch with us",
    url: "https://lectornaut.io/contact",
    id: "contact-us",
    icon: IconMessageCircle,
    style: {
      text: "text-neutral-600/90 dark:text-neutral-300/90",
      bg: "bg-neutral-50 dark:bg-neutral-950/40",
      grid: "",
    },
  },
] as const

export const footerSections = [
  {
    title: "Features",
    links: [
      { title: "Agents", href: "#" },
      { title: "Tasks", href: "#" },
      { title: "Runs", href: "#" },
      { title: "Teams", href: "#" },
      { title: "Builder", href: "#" },
      { title: "Assistant", href: "#" },
    ],
  },
  {
    title: "Products",
    links: [
      { title: "Pricing", href: "#" },
      { title: "Download", href: "#" },
      { title: "Changelog", href: "#" },
      { title: "Status", href: "#" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { title: "Personal", href: "#" },
      { title: "Professional", href: "#" },
      { title: "Business", href: "#" },
      { title: "Enterprise", href: "#" },
      { title: "Non-Profit", href: "#" },
    ],
  },
  {
    title: "Company",
    links: [
      { title: "About", href: "#" },
      { title: "Careers", href: "#" },
      { title: "Contact", href: "#" },
      { title: "Customers", href: "#" },
      { title: "Community", href: "#" },
      { title: "Brand", href: "#" },
    ],
  },
  {
    title: "Resources",
    links: [
      { title: "Developers", href: "#" },
      { title: "Integrations", href: "#" },
      { title: "Documentation", href: "#" },
      { title: "Blog", href: "#" },
      { title: "Security", href: "#" },
      { title: "Help Center", href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { title: "Terms", href: "#" },
      { title: "Privacy", href: "#" },
      { title: "DPA", href: "#" },
    ],
  },
] as const

export const defaultSettingsTabs = [
  {
    title: "settings.titles.general",
    id: "general",
    links: [
      {
        name: "settings.titles.preferences",
        icon: IconSettings,
        id: "preferences",
        description: "settings.descriptions.preferences",
      },
      {
        name: "settings.titles.account",
        icon: IconCircleUserRound,
        id: "account",
        description: "settings.descriptions.account",
      },
      {
        name: "settings.titles.notifications",
        icon: IconBell,
        id: "notifications",
        description: "settings.descriptions.notifications",
      },
      {
        name: "settings.titles.appearance",
        icon: IconPalette,
        id: "appearance",
        description: "settings.descriptions.appearance",
      },
      {
        name: "settings.titles.security",
        icon: IconLock,
        id: "security",
        description: "settings.descriptions.security",
      },
    ],
  },
  {
    title: "settings.titles.workspace",
    id: "workspace",
    links: [
      {
        name: "settings.titles.teams",
        icon: IconComponent,
        id: "teams",
        description: "settings.descriptions.teams",
      },
      {
        name: "settings.titles.members",
        icon: IconUsersRound,
        id: "members",
        description: "settings.descriptions.members",
      },
      {
        name: "settings.titles.workspaces",
        icon: IconBlocks,
        id: "workspaces",
        description: "settings.descriptions.workspaces",
      },
      {
        name: "settings.titles.agents",
        icon: IconBot,
        id: "agents",
        description: "settings.descriptions.agents",
      },
      {
        name: "settings.titles.runs",
        icon: IconActivity,
        id: "runs",
        description: "settings.descriptions.runs",
      },
      {
        name: "settings.titles.knowledge",
        icon: IconDatabase,
        id: "knowledge",
        description: "settings.descriptions.knowledge",
      },
      {
        name: "settings.titles.integrations",
        icon: IconBlocks,
        id: "integrations",
        description: "settings.descriptions.integrations",
      },
      {
        name: "settings.titles.logs",
        icon: IconLogs,
        id: "logs",
        description: "settings.descriptions.logs",
      },
    ],
  },
  {
    title: "settings.titles.administration",
    id: "administration",
    links: [
      {
        name: "settings.titles.general",
        icon: IconBolt,
        id: "general",
        description: "settings.descriptions.general",
      },
      {
        name: "settings.titles.billing",
        icon: IconCreditCard,
        id: "billing",
        description: "settings.descriptions.billing",
      },
      {
        name: "settings.titles.plans",
        icon: IconBadgeDollarSign,
        id: "plans",
        description: "settings.descriptions.plans",
      },
    ],
  },
] as const

export const defaultSettingsTab = "preferences"

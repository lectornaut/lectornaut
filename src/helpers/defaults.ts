import {
  IconActivity,
  IconArrowDownToLine,
  IconAsterisk,
  IconBadgeCheck,
  IconBot,
  IconBriefcase,
  IconComponent,
  IconContrast,
  IconFileText,
  IconFontMono,
  IconFontSans,
  IconFontSansSerif,
  IconHome,
  IconJapan,
  IconLifeBuoy,
  IconLogs,
  IconMdiFormatTextVariant,
  IconMessageCircle,
  IconMoon,
  IconScroll,
  IconShieldCheck,
  IconSparkle,
  IconSun,
  IconSunMoon,
  IconUSA,
  IconUsersRound,
} from "@/data/icons"

/**
 * Default Data and Configurations
 * Contains static lists for UI dropdowns and settings (languages, themes, accents, menus, etc.)
 */
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
]

export const defaultLanguage = "en-US"

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
    id: "accent",
    name: "Accent",
    icon: IconContrast,
  },
  {
    id: "auto",
    name: "Auto",
    icon: IconSunMoon,
  },
]

export const defaultTheme = "auto"

export const accents = [
  { id: "red", name: "Red" },
  { id: "orange", name: "Orange" },
  { id: "amber", name: "Amber" },
  { id: "yellow", name: "Yellow" },
  { id: "lime", name: "Lime" },
  { id: "green", name: "Green" },
  { id: "emerald", name: "Emerald" },
  { id: "teal", name: "Teal" },
  { id: "cyan", name: "Cyan" },
  { id: "sky", name: "Sky" },
  { id: "blue", name: "Blue" },
  { id: "indigo", name: "Indigo" },
  { id: "violet", name: "Violet" },
  { id: "purple", name: "Purple" },
  { id: "fuchsia", name: "Fuchsia" },
  { id: "pink", name: "Pink" },
  { id: "rose", name: "Rose" },
  { id: "slate", name: "Slate" },
  { id: "gray", name: "Gray" },
  { id: "zinc", name: "Zinc" },
  { id: "neutral", name: "Neutral" },
  { id: "stone", name: "Stone" },
]

export const defaultAccent = "neutral"

export const fonts = [
  { id: "sans", name: "Sans", icon: IconFontSans },
  { id: "serif", name: "Serif", icon: IconFontSansSerif },
  { id: "mono", name: "Mono", icon: IconFontMono },
]

export const defaultFont = "sans"

export const sizes = [
  { id: "xs", name: "Extra small", icon: IconMdiFormatTextVariant },
  { id: "sm", name: "Small", icon: IconMdiFormatTextVariant },
  { id: "base", name: "Normal", icon: IconMdiFormatTextVariant },
  { id: "lg", name: "Large", icon: IconMdiFormatTextVariant },
  { id: "xl", name: "Extra large", icon: IconMdiFormatTextVariant },
]

export const defaultSize = "sm"

export const menu = [
  {
    title: "Home",
    action: "Create a List",
    description: "Another to-do system you'll try but eventually give up on.",
    url: "/home",
    id: "home",
    icon: IconHome,
    textColor: "text-pink-500",
    bgColor: "bg-pink-500/75",
    shortcut: "⌘H",
  },
  {
    title: "Write",
    action: "Create a Document",
    description: "A place to write and organize your thoughts.",
    url: "/write",
    id: "write",
    icon: IconFileText,
    textColor: "text-teal-500",
    bgColor: "bg-teal-500/75",
    shortcut: "⌘W",
  },
  {
    title: "Agents",
    action: "Create a Calendar",
    description: "Stay on top of your deadlines, or don't — it's up to you.",
    url: "/agents",
    id: "agents",
    icon: IconBot,
    textColor: "text-orange-500",
    bgColor: "bg-orange-500/75",
    shortcut: "⌘A",
  },
  {
    title: "Tasks",
    action: "Create a Gallery",
    description: "Great for mood boards and inspiration.",
    url: "/tasks",
    id: "tasks",
    icon: IconBadgeCheck,
    textColor: "text-green-500",
    bgColor: "bg-green-500/75",
    shortcut: "⌘T",
  },
  {
    title: "Runs",
    action: "Create a Board",
    description: "Track tasks in different stages of your project.",
    url: "/runs",
    id: "runs",
    icon: IconActivity,
    textColor: "text-blue-500",
    bgColor: "bg-blue-500/75",
    shortcut: "⌘R",
  },
  {
    title: "Teams",
    action: "Create a Spreadsheet",
    description: "Lots of numbers and things — good for nerds.",
    url: "/teams",
    id: "teams",
    icon: IconComponent,
    textColor: "text-indigo-500",
    bgColor: "bg-indigo-500/75",
    shortcut: "⌘E",
  },
  {
    title: "Create",
    action: "Create a Timeline",
    description: "Get a birds-eye-view of your procrastination.",
    url: "/create",
    id: "create",
    icon: IconSparkle,
    textColor: "text-purple-500",
    bgColor: "bg-purple-500/75",
    shortcut: "⌘N",
  },
]

export const productsMenu = [
  {
    title: "Lectornaut",
    description: "The core platform for building AI agents",
    url: "https://lectornaut.io",
    id: "lectornaut",
    icon: IconAsterisk,
    style: { text: "text-sky-500/80", bg: "bg-sky-500/20", grid: "" },
  },
  {
    title: "Lectornaut AI",
    description: "AI capabilities for your agents",
    url: "https://lectornaut.ai",
    id: "lectornaut-ai",
    icon: IconBot,
    style: { text: "text-blue-500/80", bg: "bg-blue-500/20", grid: "" },
  },
  {
    title: "Lectornaut CLI",
    description: "Command line interface for Lectornaut",
    url: "https://lectornaut.io/cli",
    id: "lectornaut-cli",
    icon: IconComponent,
    style: { text: "text-pink-500/80", bg: "bg-pink-500/20", grid: "" },
  },
  {
    title: "Lectornaut SDK",
    description: "Software Development Kit for Lectornaut",
    url: "https://lectornaut.io/sdk",
    id: "lectornaut-sdk",
    icon: IconBadgeCheck,
    style: { text: "text-rose-500/80", bg: "bg-rose-500/20", grid: "" },
  },
]

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
        style: { text: "text-violet-500/80", bg: "bg-violet-500/20", grid: "" },
      },
      {
        title: "Lectornaut SDK",
        description: "Software Development Kit for Lectornaut",
        url: "https://lectornaut.io/sdk",
        id: "lectornaut-sdk",
        icon: IconComponent,
        style: { text: "text-violet-500/80", bg: "bg-violet-500/20", grid: "" },
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
        style: { text: "text-purple-500/80", bg: "bg-purple-500/20", grid: "" },
      },
      {
        title: "Lectornaut Runs",
        description: "Monitor and manage runs on Lectornaut",
        url: "https://lectornaut.io/runs",
        id: "lectornaut-runs",
        icon: IconComponent,
        style: { text: "text-purple-500/80", bg: "bg-purple-500/20", grid: "" },
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
          text: "text-fuchsia-500/80",
          bg: "bg-fuchsia-500/20",
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
          text: "text-fuchsia-500/80",
          bg: "bg-fuchsia-500/20",
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
        style: { text: "text-pink-500/80", bg: "bg-pink-500/20", grid: "" },
      },
      {
        title: "Lectornaut Cloud",
        description: "Cloud solutions for Lectornaut",
        url: "https://lectornaut.io/cloud",
        id: "lectornaut-cloud",
        icon: IconComponent,
        style: { text: "text-pink-500/80", bg: "bg-pink-500/20", grid: "" },
      },
    ],
  },
]

export const resourcesMenu = [
  {
    title: "Download",
    description: "Get the latest version of Lectornaut",
    url: "https://lectornaut.io/download",
    id: "download",
    icon: IconArrowDownToLine,
    style: {
      text: "text-cyan-500/80",
      bg: "bg-cyan-500/20",
      grid: "row-span-2",
    },
  },
  {
    title: "Developers",
    description: "Resources for developers",
    url: "https://developers.lectornaut.io",
    id: "developers",
    icon: IconUsersRound,
    style: { text: "text-teal-500/80", bg: "bg-teal-500/20", grid: "" },
  },
  {
    title: "Documentation",
    description: "Guides and API references",
    url: "https://docs.lectornaut.io",
    id: "documentation",
    icon: IconFileText,
    style: { text: "text-emerald-500/80", bg: "bg-emerald-500/20", grid: "" },
  },
  {
    title: "Blog",
    description: "Insights and updates from team",
    url: "https://blog.lectornaut.io",
    id: "blog",
    icon: IconScroll,
    style: { text: "text-green-500/80", bg: "bg-green-500/20", grid: "" },
  },
  {
    title: "Changelog",
    description: "What's new in Lectornaut",
    url: "https://lectornaut.io/changelog",
    id: "changelog",
    icon: IconLogs,
    style: { text: "text-lime-500/80", bg: "bg-lime-500/20", grid: "" },
  },
  {
    title: "Customers",
    description: "See how others use Lectornaut",
    url: "https://customers.lectornaut.io",
    id: "customers",
    icon: IconUsersRound,
    style: { text: "text-yellow-500/80", bg: "bg-yellow-500/20", grid: "" },
  },
  {
    title: "Community",
    description: "Join the Lectornaut community",
    url: "https://community.lectornaut.io",
    id: "community",
    icon: IconScroll,
    style: { text: "text-amber-500/80", bg: "bg-amber-500/20", grid: "" },
  },
  {
    title: "Security",
    description: "Safety and security resources",
    url: "https://security.lectornaut.io",
    id: "security",
    icon: IconShieldCheck,
    style: { text: "text-orange-500/80", bg: "bg-orange-500/20", grid: "" },
  },
  {
    title: "Help Center",
    description: "Get help and support",
    url: "https://help.lectornaut.io",
    id: "help-center",
    icon: IconLifeBuoy,
    style: { text: "text-red-500/80", bg: "bg-red-500/20", grid: "" },
  },
]

export const companyMenu = [
  {
    title: "About",
    description: "Meet the team",
    url: "https://lectornaut.io/about",
    id: "about-us",
    icon: IconUsersRound,
    style: { text: "text-neutral-500/80", bg: "bg-neutral-500/20", grid: "" },
  },
  {
    title: "Careers",
    description: "Join our team",
    url: "https://lectornaut.io/careers",
    id: "careers",
    icon: IconBriefcase,
    style: { text: "text-neutral-500/80", bg: "bg-neutral-500/20", grid: "" },
  },
  {
    title: "Contact",
    description: "Get in touch with us",
    url: "https://lectornaut.io/contact",
    id: "contact-us",
    icon: IconMessageCircle,
    style: { text: "text-neutral-500/80", bg: "bg-neutral-500/20", grid: "" },
  },
]

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
]

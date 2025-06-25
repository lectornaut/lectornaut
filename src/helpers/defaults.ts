import IconJapan from "~icons/circle-flags/jp"
import IconUSA from "~icons/circle-flags/us"
import IconActivity from "~icons/lucide/activity"
import IconBadgeCheck from "~icons/lucide/badge-check"
import IconBot from "~icons/lucide/bot"
import IconComponent from "~icons/lucide/component"
import IconHome from "~icons/lucide/home"
import IconSystem from "~icons/lucide/monitor"
import IconDark from "~icons/lucide/moon"
import IconSparkle from "~icons/lucide/sparkle"
import IconLight from "~icons/lucide/sun"
import IconProduct1 from "~icons/mingcute/asterisk-line"

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
    id: "auto",
    name: "System",
    icon: IconSystem,
  },
  {
    id: "light",
    name: "Light",
    icon: IconLight,
  },
  {
    id: "dark",
    name: "Dark",
    icon: IconDark,
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

export const menu = [
  {
    title: "Home",
    url: "/home",
    id: "home",
    icon: IconHome,
    color: "bg-teal-500/20 text-teal-500/80",
  },
  {
    title: "Agents",
    url: "/agents",
    id: "agents",
    icon: IconBot,
    color: "bg-purple-500/20 text-purple-500/80",
  },
  {
    title: "Tasks",
    url: "/tasks",
    id: "tasks",
    icon: IconBadgeCheck,
    color: "bg-sky-500/20 text-sky-500/80",
  },
  {
    title: "Runs",
    url: "/runs",
    id: "runs",
    icon: IconActivity,
    color: "bg-rose-500/20 text-rose-500/80",
  },
  {
    title: "Teams",
    url: "/teams",
    id: "teams",
    icon: IconComponent,
    color: "bg-indigo-500/20 text-indigo-500/80",
  },
  {
    title: "Create",
    url: "/create",
    id: "create",
    icon: IconSparkle,
    color: "bg-yellow-500/20 text-yellow-500/80",
  },
]

export const productsMenu = [
  {
    title: "Hyperjump",
    description: "The core platform for building AI agents",
    url: "https://hyperjump.io",
    id: "hyperjump",
    icon: IconProduct1,
    style: { text: "text-teal-500/80", bg: "bg-teal-500/20" },
  },
  {
    title: "Hyperjump AI",
    description: "AI capabilities for your agents",
    url: "https://hyperjump.ai",
    id: "hyperjump-ai",
    icon: IconBot,
    style: { text: "text-purple-500/80", bg: "bg-purple-500/20" },
  },
  {
    title: "Hyperjump CLI",
    description: "Command line interface for Hyperjump",
    url: "https://hyperjump.io/cli",
    id: "hyperjump-cli",
    icon: IconComponent,
    style: { text: "text-indigo-500/80", bg: "bg-indigo-500/20" },
  },
  {
    title: "Hyperjump SDK",
    description: "Software Development Kit for Hyperjump",
    url: "https://hyperjump.io/sdk",
    id: "hyperjump-sdk",
    icon: IconBadgeCheck,
    style: { text: "text-sky-500/80", bg: "bg-sky-500/20" },
  },
]

export const solutionsMenu = [
  {
    title: "For Personal",
    items: [
      {
        title: "Hyperjump CLI",
        description: "Command line interface for Hyperjump",
        url: "https://hyperjump.io/cli",
        id: "hyperjump-cli",
        icon: IconComponent,
        style: { text: "text-blue-500/80", bg: "bg-blue-500/20" },
      },
      {
        title: "Hyperjump SDK",
        description: "Software Development Kit for Hyperjump",
        url: "https://hyperjump.io/sdk",
        id: "hyperjump-sdk",
        icon: IconComponent,
        style: { text: "text-blue-500/80", bg: "bg-blue-500/20" },
      },
    ],
  },
  {
    title: "For Professional",
    items: [
      {
        title: "Hyperjump Teams",
        description: "Collaborate with teams on Hyperjump",
        url: "https://hyperjump.io/teams",
        id: "hyperjump-teams",
        icon: IconComponent,
        style: { text: "text-emerald-500/80", bg: "bg-emerald-500/20" },
      },
      {
        title: "Hyperjump Runs",
        description: "Monitor and manage runs on Hyperjump",
        url: "https://hyperjump.io/runs",
        id: "hyperjump-runs",
        icon: IconComponent,
        style: { text: "text-emerald-500/80", bg: "bg-emerald-500/20" },
      },
    ],
  },
  {
    title: "For Business",
    items: [
      {
        title: "Hyperjump Agents",
        description: "Build and deploy AI agents",
        url: "https://hyperjump.io/agents",
        id: "hyperjump-agents",
        icon: IconComponent,
        style: { text: "text-purple-500/80", bg: "bg-purple-500/20" },
      },
      {
        title: "Hyperjump AI",
        description: "AI capabilities for your agents",
        url: "https://hyperjump.io/ai",
        id: "hyperjump-ai",
        icon: IconComponent,
        style: { text: "text-purple-500/80", bg: "bg-purple-500/20" },
      },
    ],
  },
  {
    title: "For Enterprise",
    items: [
      {
        title: "Hyperjump Enterprise",
        description: "Enterprise solutions for Hyperjump",
        url: "https://hyperjump.io/enterprise",
        id: "hyperjump-enterprise",
        icon: IconComponent,
        style: { text: "text-pink-500/80", bg: "bg-pink-500/20" },
      },
      {
        title: "Hyperjump Cloud",
        description: "Cloud solutions for Hyperjump",
        url: "https://hyperjump.io/cloud",
        id: "hyperjump-cloud",
        icon: IconComponent,
        style: { text: "text-pink-500/80", bg: "bg-pink-500/20" },
      },
    ],
  },
]

export const resourcesMenu = [
  {
    title: "Documentation",
    url: "https://docs.hyperjump.io",
    id: "documentation",
    icon: IconComponent,
    color: "bg-blue-500/20 text-blue-500/80",
  },
  {
    title: "Blog",
    url: "https://blog.hyperjump.io",
    id: "blog",
    icon: IconComponent,
    color: "bg-green-500/20 text-green-500/80",
  },
  {
    title: "Community",
    url: "https://community.hyperjump.io",
    id: "community",
    icon: IconComponent,
    color: "bg-yellow-500/20 text-yellow-500/80",
  },
]

export const companyMenu = [
  {
    title: "About Us",
    url: "https://hyperjump.io/about",
    id: "about-us",
    icon: IconComponent,
    color: "bg-gray-500/20 text-gray-500/80",
  },
  {
    title: "Careers",
    url: "https://hyperjump.io/careers",
    id: "careers",
    icon: IconComponent,
    color: "bg-gray-500/20 text-gray-500/80",
  },
  {
    title: "Contact Us",
    url: "https://hyperjump.io/contact",
    id: "contact-us",
    icon: IconComponent,
    color: "bg-gray-500/20 text-gray-500/80",
  },
]

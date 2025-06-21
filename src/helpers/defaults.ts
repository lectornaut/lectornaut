import IconActivity from "~icons/lucide/activity"
import IconBadgeCheck from "~icons/lucide/badge-check"
import IconBot from "~icons/lucide/bot"
import IconComponent from "~icons/lucide/component"
import IconHome from "~icons/lucide/home"
import IconSparkle from "~icons/lucide/sparkle"

export const languages = [
  {
    id: "en-US",
    name: "English",
  },
  {
    id: "ja-JP",
    name: "Japanese",
  },
]

export const defaultLanguage = "en-US"

export const themes = [
  {
    id: "auto",
    name: "System",
  },
  {
    id: "light",
    name: "Light",
  },
  {
    id: "dark",
    name: "Dark",
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
    url: "https://hyperjump.io",
    id: "hyperjump",
    icon: IconHome,
    color: "bg-teal-500/20 text-teal-500/80",
  },
  {
    title: "Hyperjump AI",
    url: "https://hyperjump.ai",
    id: "hyperjump-ai",
    icon: IconBot,
    color: "bg-purple-500/20 text-purple-500/80",
  },
]

export const solutionsMenu = [
  {
    title: "Personal",
    items: [
      {
        title: "Hyperjump CLI",
        url: "https://hyperjump.io/cli",
        id: "hyperjump-cli",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
      {
        title: "Hyperjump SDK",
        url: "https://hyperjump.io/sdk",
        id: "hyperjump-sdk",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
    ],
  },
  {
    title: "Basic",
    items: [
      {
        title: "Hyperjump Teams",
        url: "https://hyperjump.io/teams",
        id: "hyperjump-teams",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
      {
        title: "Hyperjump Tasks",
        url: "https://hyperjump.io/tasks",
        id: "hyperjump-tasks",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
      {
        title: "Hyperjump Runs",
        url: "https://hyperjump.io/runs",
        id: "hyperjump-runs",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
    ],
  },
  {
    title: "Business",
    items: [
      {
        title: "Hyperjump Agents",
        url: "https://hyperjump.io/agents",
        id: "hyperjump-agents",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
      {
        title: "Hyperjump AI",
        url: "https://hyperjump.io/ai",
        id: "hyperjump-ai",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
      {
        title: "Hyperjump Platform",
        url: "https://hyperjump.io/platform",
        id: "hyperjump-platform",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
    ],
  },
  {
    title: "Enterprise",
    items: [
      {
        title: "Hyperjump Enterprise",
        url: "https://hyperjump.io/enterprise",
        id: "hyperjump-enterprise",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
      {
        title: "Hyperjump Cloud",
        url: "https://hyperjump.io/cloud",
        id: "hyperjump-cloud",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
      },
      {
        title: "Hyperjump On-Premise",
        url: "https://hyperjump.io/on-premise",
        id: "hyperjump-on-premise",
        icon: IconComponent,
        color: "bg-indigo-500/20 text-indigo-500/80",
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

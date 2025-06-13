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

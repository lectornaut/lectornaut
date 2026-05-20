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
  IconCode,
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
  IconMapPin,
  IconMdiFormatTextVariant,
  IconMessageCircle,
  IconMoon,
  IconPalette,
  IconScroll,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconSun,
  IconSunMoon,
  IconUSA,
  IconUserCog,
  IconUserRound,
  IconUsersRound,
} from "@/data/icons"
import type {
  BillingPlanKey,
  IBotAgentConfig,
  IBotAgentModel,
  IBotAgentModelToggles,
  IBotModelProvider,
} from "@/types/domain"

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
    id: "auto",
    name: "Auto",
    icon: IconSunMoon,
  },
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
] as const

export type ThemeId = (typeof themes)[number]["id"]
export const defaultTheme: ThemeId = "auto"

export const accents = [
  { id: "red", name: "Red", style: "bg-red-500" },
  { id: "orange", name: "Orange", style: "bg-orange-500" },
  { id: "amber", name: "Amber", style: "bg-amber-500" },
  { id: "yellow", name: "Yellow", style: "bg-yellow-500" },
  { id: "lime", name: "Lime", style: "bg-lime-500" },
  { id: "green", name: "Green", style: "bg-green-500" },
  { id: "emerald", name: "Emerald", style: "bg-emerald-500" },
  { id: "teal", name: "Teal", style: "bg-teal-500" },
  { id: "cyan", name: "Cyan", style: "bg-cyan-500" },
  { id: "sky", name: "Sky", style: "bg-sky-500" },
  { id: "blue", name: "Blue", style: "bg-blue-500" },
  { id: "indigo", name: "Indigo", style: "bg-indigo-500" },
  { id: "violet", name: "Violet", style: "bg-violet-500" },
  { id: "purple", name: "Purple", style: "bg-purple-500" },
  { id: "fuchsia", name: "Fuchsia", style: "bg-fuchsia-500" },
  { id: "pink", name: "Pink", style: "bg-pink-500" },
  { id: "rose", name: "Rose", style: "bg-rose-500" },
  { id: "base", name: "Base", style: "bg-foreground" },
  { id: "custom", name: "Custom", style: "bg-current" },
] as const

export type AccentId = (typeof accents)[number]["id"]

export const bases = [
  { id: "slate", name: "Slate", style: "bg-slate-500" },
  { id: "gray", name: "Gray", style: "bg-gray-500" },
  { id: "zinc", name: "Zinc", style: "bg-zinc-500" },
  { id: "neutral", name: "Neutral", style: "bg-neutral-500" },
  { id: "stone", name: "Stone", style: "bg-stone-500" },
  { id: "taupe", name: "Taupe", style: "bg-taupe-500" },
  { id: "mauve", name: "Mauve", style: "bg-mauve-500" },
  { id: "mist", name: "Mist", style: "bg-mist-500" },
  { id: "olive", name: "Olive", style: "bg-olive-500" },
  { id: "accent", name: "Accent", style: "bg-primary" },
  { id: "custom", name: "Custom", style: "bg-current" },
] as const

export type BaseId = (typeof bases)[number]["id"]

export const defaultBase: BaseId = "neutral"
export const defaultAccent: AccentId = "base"
export const defaultCustomBaseColor = "#737373"
export const defaultCustomAccentColor = "#2563eb"

export const fonts = [
  { id: "sans", name: "Sans", icon: IconFontSans, style: "font-sans" },
  { id: "serif", name: "Serif", icon: IconFontSansSerif, style: "font-serif" },
  { id: "mono", name: "Mono", icon: IconFontMono, style: "font-mono" },
] as const

export type FontId = (typeof fonts)[number]["id"]

export const defaultFileDropOverlayShortcutKeys = "cmd+shift+d"

/** Empty map = all shortcuts use their built-in defaults */
export const defaultShortcutOverrides: Record<string, string> = {}

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

// ────────────────────────────────────────────────────────────────────────────
// Bot agent (workspace AI client) — model catalog + per-workspace defaults.
// ────────────────────────────────────────────────────────────────────────────
//
// `botModels` is the flat UI catalog: each entry powers one row in the
// model dropdown. Each row carries a `provider` so the model picker can
// group entries by provider (Google / Anthropic / OpenAI). The wire-name
// `id` MUST match the server-side allowlist in `functions/src/bot.ts`
// (`BOT_AGENT_MODELS`) — keep both in sync, or the update callable will
// reject the chosen model with `invalid-argument`. The server's
// `resolveModel()` dispatches by prefix (`gemini-*` → Google,
// `claude-*` → Anthropic, `gpt-*` → OpenAI), so introducing a new
// family also requires updating that dispatcher.
//
// `botModelProviders` is the *display order* + label of the provider
// groups; the model picker iterates this list and renders one
// `<SelectGroup>` per enabled provider.
//
// `defaultBotModelProviderToggles` is the team-level provider policy
// default. Existing teams without a saved agent settings doc get all
// providers enabled until an owner/admin changes the settings.
//
// `defaultBotAgentConfig` mirrors the server's `DEFAULT_BOT_AGENT_CONFIG`.
// We duplicate it on the client so the form has something to render before
// the first callable response lands and so the "Reset to defaults" button
// has a target shape.

export const botModelProviders = [
  { id: "google", name: "Google Gemini" },
  { id: "anthropic", name: "Anthropic Claude" },
  { id: "openai", name: "OpenAI" },
] as const satisfies readonly { id: IBotModelProvider; name: string }[]

export const defaultBotModelProviderToggles: Record<
  IBotModelProvider,
  boolean
> = {
  google: true,
  anthropic: true,
  openai: true,
}

export const botModels = [
  // Google Gemini
  {
    id: "gemini-3-flash-preview",
    provider: "google",
    name: "Gemini 3 Flash (Preview)",
    description: "Latest preview — fast, capable, multimodal.",
    badge: "Preview",
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    name: "Gemini 2.5 Pro",
    description: "Most capable Gemini — best for complex reasoning.",
    badge: "Pro",
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    name: "Gemini 2.5 Flash",
    description: "Balanced speed and quality.",
    badge: null,
  },
  {
    id: "gemini-2.5-flash-lite",
    provider: "google",
    name: "Gemini 2.5 Flash Lite",
    description: "Lightweight — cheapest 2.5-class option.",
    badge: null,
  },
  {
    id: "gemini-2.0-flash",
    provider: "google",
    name: "Gemini 2.0 Flash",
    description: "Stable, mature workhorse.",
    badge: null,
  },
  {
    id: "gemini-2.0-flash-lite",
    provider: "google",
    name: "Gemini 2.0 Flash Lite",
    description: "Lowest cost Gemini — best for simple queries.",
    badge: null,
  },
  // Anthropic Claude
  {
    id: "claude-opus-4-5",
    provider: "anthropic",
    name: "Claude Opus 4.5",
    description: "Most capable Claude — long-form reasoning and writing.",
    badge: "Opus",
  },
  {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    name: "Claude Sonnet 4.5",
    description: "Balanced Claude — strong general-purpose default.",
    badge: null,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    description: "Fastest, cheapest Claude — good for quick replies.",
    badge: null,
  },
  // OpenAI
  {
    id: "gpt-4o",
    provider: "openai",
    name: "GPT-4o",
    description: "OpenAI flagship — multimodal, broad capability.",
    badge: null,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    name: "GPT-4o mini",
    description: "Smaller, faster, and cheaper than GPT-4o.",
    badge: null,
  },
  {
    id: "gpt-4-turbo",
    provider: "openai",
    name: "GPT-4 Turbo",
    description: "Previous-gen GPT-4 — stable, well-tested.",
    badge: null,
  },
] as const satisfies readonly {
  id: IBotAgentModel
  provider: IBotModelProvider
  name: string
  description: string
  badge: string | null
}[]

export type BotModelEntry = (typeof botModels)[number]

export interface BotModelInfo {
  id: string
  name: string
  description: string
  badge: string | null
  providerId: IBotModelProvider | null
  providerName: string
}

// Look up catalog metadata for a model id. Falls back to a synthetic
// entry when the id isn't in the static catalog — the server can
// (and will) ship new models before the client catalog catches up,
// and the UI shouldn't crash on a `summary.model` it doesn't know.
export const findBotModel = (id: string | null | undefined): BotModelInfo => {
  if (!id) {
    return {
      id: "",
      name: "Unknown",
      description: "",
      badge: null,
      providerId: null,
      providerName: "",
    }
  }
  const entry = botModels.find((m) => m.id === id)
  if (!entry) {
    return {
      id,
      name: id,
      description: "",
      badge: null,
      providerId: null,
      providerName: "",
    }
  }
  const provider = botModelProviders.find((p) => p.id === entry.provider)
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    badge: entry.badge,
    providerId: entry.provider,
    providerName: provider?.name ?? "",
  }
}

export const botChatModes = [
  {
    id: "auto",
    name: "Auto",
    description: "Balanced default — tools used when they directly help.",
  },
  {
    id: "agent",
    name: "Agent",
    description: "Proactive — eager tool use, longer narrated replies.",
  },
  {
    id: "manual",
    name: "Manual",
    description: "Read-only — explanation and suggestion only, no actions.",
  },
] as const

// Per-model availability toggles default. The form binds against this
// shape; the server normalizes missing keys to `true` on read so a
// newly-added model id starts enabled even for teams that saved their
// config before the model existed.
//
// `Object.fromEntries` + `as` is the most concise way to build a strict
// `Record<K, V>` from an array — `reduce` can't seed an empty object
// the compiler will accept as already satisfying the full record.
export const defaultBotModelToggles: IBotAgentModelToggles = Object.fromEntries(
  botModels.map((model) => [model.id, true])
) as IBotAgentModelToggles

export const defaultBotAgentConfig: IBotAgentConfig = {
  providers: { ...defaultBotModelProviderToggles },
  models: { ...defaultBotModelToggles },
  model: "gemini-3-flash-preview",
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 2048,
  defaultMode: "auto",
  systemPromptBase:
    "You are a helpful assistant for the user's team workspace.",
  promptSuffixes: {
    auto:
      "Default mode: answer concisely. Call a tool when it directly " +
      "advances the user's request, otherwise just reply with text. If " +
      "the request is ambiguous, prefer asking the user a clarifying " +
      "question via `askQuestion` over guessing.",
    agent:
      "Agent mode: be proactive. Prefer calling tools to gather concrete " +
      "data over guessing, and chain multiple tool calls when a question " +
      "needs them. Briefly narrate what you're doing and why. When you " +
      "need a decision from the user before continuing, ask via " +
      "`askQuestion` — don't pick on their behalf.",
    manual:
      "Manual mode: action tools are disabled. You are a read-only " +
      "conversational partner — explain, suggest, and discuss, but never " +
      "claim to take actions on the user's behalf. You may still ask " +
      "clarifying questions via `askQuestion` when it would help the " +
      "discussion.",
  },
  tools: {
    getWeather: true,
    rollDice: true,
    askQuestion: true,
    searchWorkspaceNodes: true,
    summarizeNode: true,
    customAgents: true,
  },
  titleMaxLength: 80,
  previewMaxLength: 200,
}

/**
 * Bound metadata for the slider/number fields. Mirrors
 * `BOT_AGENT_BOUNDS` server-side; if you tighten one, tighten the other.
 */
export const botAgentBounds = {
  temperature: { min: 0, max: 2, step: 0.05 },
  topP: { min: 0, max: 1, step: 0.01 },
  topK: { min: 1, max: 100, step: 1 },
  maxOutputTokens: { min: 256, max: 65536, step: 256 },
  systemPromptBase: { max: 4000 },
  promptSuffix: { max: 2000 },
  titleMaxLength: { min: 20, max: 200, step: 1 },
  previewMaxLength: { min: 50, max: 500, step: 1 },
} as const

export const defaultMenu = [
  {
    title: "Home",
    action: "Open your workspace dashboard",
    description: "Get a snapshot of activity across your workspace.",
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
    title: "Bot",
    action: "Chat with your AI assistant",
    description:
      "Chat with AI and use side panels for context, history, and actions.",
    url: "/bot",
    id: "bot",
    icon: IconMessageCircle,
    style: {
      text: "text-amber-700/90 dark:text-amber-300/90",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      grid: "",
    },
    shortcut: "⌘B",
  },
  {
    title: "Agents",
    action: "Create and manage AI agents",
    description: "Build, test, and organize your AI agents.",
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
    action: "Plan and track your tasks",
    description: "Track work, deadlines, and progress across projects.",
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
    action: "Monitor run status and history",
    description: "Track jobs across queues, states, and execution history.",
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
    title: "Write",
    action: "Draft and organize documents",
    description: "Capture notes, drafts, and long-form documents.",
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
    title: "Code",
    action: "Build and review code projects",
    description: "Work with repositories, files, and coding tasks.",
    url: "/code",
    id: "code",
    icon: IconCode,
    style: {
      text: "text-teal-700/90 dark:text-teal-300/90",
      bg: "bg-teal-50 dark:bg-teal-950/40",
      grid: "",
    },
    shortcut: "⌘C",
  },
  {
    title: "Maps",
    action: "Explore and annotate maps",
    description: "Visualize ideas and concepts in a structured way.",
    url: "/maps",
    id: "maps",
    icon: IconMapPin,
    style: {
      text: "text-yellow-700/90 dark:text-yellow-300/90",
      bg: "bg-yellow-50 dark:bg-yellow-950/40",
      grid: "",
    },
    shortcut: "⌘M",
  },
  {
    title: "Teams",
    action: "Manage teams and collaborators",
    description: "Organize members, roles, and shared workspaces.",
    url: "/teams",
    id: "teams",
    icon: IconUsersRound,
    style: {
      text: "text-indigo-700/90 dark:text-indigo-300/90",
      bg: "bg-indigo-50 dark:bg-indigo-950/40",
      grid: "",
    },
    shortcut: "⌘E",
  },
  {
    title: "Profile",
    action: "View and update your profile",
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
    url: "https://lectornaut.com",
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

export type SettingsPlan = {
  id: BillingPlanKey
  titleKey: string
  descriptionKey: string
  highlights: readonly string[]
}

export type SettingsPlanFeature = {
  name: string
  values: Record<BillingPlanKey, string | boolean>
}

export const settingsPlans = [
  {
    id: "personal",
    titleKey: "settings.plans.subscriptionPlan.personal.title",
    descriptionKey: "settings.plans.subscriptionPlan.personal.description",
    highlights: ["Personal Workspaces", "10 Agents", "100 Monthly Tasks"],
  },
  {
    id: "professional",
    titleKey: "settings.plans.subscriptionPlan.professional.title",
    descriptionKey: "settings.plans.subscriptionPlan.professional.description",
    highlights: ["Team Workspaces", "100 Agents", "1000 Monthly Tasks"],
  },
  {
    id: "business",
    titleKey: "settings.plans.subscriptionPlan.business.title",
    descriptionKey: "settings.plans.subscriptionPlan.business.description",
    highlights: ["Team Workspaces", "500 Agents", "5000 Monthly Tasks"],
  },
  {
    id: "enterprise",
    titleKey: "settings.plans.subscriptionPlan.enterprise.title",
    descriptionKey: "settings.plans.subscriptionPlan.enterprise.description",
    highlights: ["Team Workspaces", "1000 Agents", "10000 Monthly Tasks"],
  },
] as const satisfies readonly SettingsPlan[]

export const settingsPlanFeatures = [
  {
    name: "Workspaces",
    values: {
      personal: "1",
      professional: "5",
      business: "20",
      enterprise: "Unlimited",
    },
  },
  {
    name: "Storage",
    values: {
      personal: "5 GB",
      professional: "50 GB",
      business: "200 GB",
      enterprise: "1 TB",
    },
  },
  {
    name: "Support",
    values: {
      personal: false,
      professional: true,
      business: true,
      enterprise: true,
    },
  },
  {
    name: "Custom Domain",
    values: {
      personal: false,
      professional: false,
      business: true,
      enterprise: true,
    },
  },
  {
    name: "Team Members",
    values: {
      personal: false,
      professional: false,
      business: true,
      enterprise: true,
    },
  },
  {
    name: "Advanced Analytics",
    values: {
      personal: false,
      professional: false,
      business: true,
      enterprise: true,
    },
  },
  {
    name: "Priority Support",
    values: {
      personal: false,
      professional: false,
      business: false,
      enterprise: true,
    },
  },
  {
    name: "Account Manager",
    values: {
      personal: false,
      professional: false,
      business: false,
      enterprise: true,
    },
  },
  {
    name: "Custom SLAs",
    values: {
      personal: false,
      professional: false,
      business: false,
      enterprise: true,
    },
  },
  {
    name: "Onboarding Assistance",
    values: {
      personal: false,
      professional: false,
      business: false,
      enterprise: true,
    },
  },
] as const satisfies readonly SettingsPlanFeature[]

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
        icon: IconUserCog,
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
    ],
  },
  {
    title: "settings.titles.team",
    id: "team",
    links: [
      {
        name: "settings.titles.overview",
        icon: IconShieldCheck,
        id: "overview",
        description: "settings.descriptions.overview",
      },
      {
        name: "settings.titles.workspaces",
        icon: IconBlocks,
        id: "workspaces",
        description: "settings.descriptions.workspaces",
      },
      {
        name: "settings.titles.members",
        icon: IconUsersRound,
        id: "members",
        description: "settings.descriptions.members",
      },
      {
        name: "settings.titles.security",
        icon: IconLock,
        id: "security",
        description: "settings.descriptions.security",
      },
      {
        name: "settings.titles.ai",
        icon: IconSparkles,
        id: "ai",
        description: "settings.descriptions.ai",
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
        name: "settings.titles.teams",
        icon: IconComponent,
        id: "teams",
        description: "settings.descriptions.teams",
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

export const deepLinkExcludedPaths = [
  "/",
  "/enter",
  "/deeplink",
  "/welcome",
  "/pricing",
] as const

export const defaultTeamRole = "member"

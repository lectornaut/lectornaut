import IconJapan from "~icons/circle-flags/jp"
import IconUSA from "~icons/circle-flags/us"
import IconActivity from "~icons/lucide/activity"
import IconDownload from "~icons/lucide/arrow-down-to-line"
import IconProduct1 from "~icons/lucide/asterisk"
import IconBadgeCheck from "~icons/lucide/badge-check"
import IconDocumentation from "~icons/lucide/book-open"
import IconBot from "~icons/lucide/bot"
import IconDevelopers from "~icons/lucide/box"
import IconCareers from "~icons/lucide/briefcase"
import IconComponent from "~icons/lucide/component"
import IconAbout from "~icons/lucide/graduation-cap"
import IconCommunity from "~icons/lucide/heart"
import IconChangelog from "~icons/lucide/history"
import IconHome from "~icons/lucide/home"
import IconHelpCenter from "~icons/lucide/life-buoy"
import IconContact from "~icons/lucide/message-circle"
import IconSystem from "~icons/lucide/monitor"
import IconDark from "~icons/lucide/moon"
import IconBlog from "~icons/lucide/scroll"
import IconSecurity from "~icons/lucide/shield-check"
import IconSparkle from "~icons/lucide/sparkle"
import IconLight from "~icons/lucide/sun"
import IconCustomers from "~icons/lucide/users"
import IconFont from "~icons/mdi/format-text-variant"
import IconMono from "~icons/ri/font-mono"
import IconSans from "~icons/ri/font-sans"
import IconSerif from "~icons/ri/font-sans-serif"
import IconZoom from "~icons/ri/search-line"
import IconZoomIn from "~icons/ri/zoom-in-line"
import IconZoomOut from "~icons/ri/zoom-out-line"

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

export const fonts = [
  { id: "sans", name: "Sans", icon: IconSans },
  { id: "serif", name: "Serif", icon: IconSerif },
  { id: "mono", name: "Mono", icon: IconMono },
]

export const defaultFont = "sans"

export const sizes = [
  { id: "xs", name: "Extra small", icon: IconFont },
  { id: "sm", name: "Small", icon: IconFont },
  { id: "base", name: "Normal", icon: IconFont },
  { id: "lg", name: "Large", icon: IconFont },
  { id: "xl", name: "Extra large", icon: IconFont },
]

export const defaultSize = "sm"

export const zooms = [
  { id: "50", name: "50%", icon: IconZoomOut },
  { id: "75", name: "75%", icon: IconZoomOut },
  { id: "100", name: "100%", icon: IconZoom },
  { id: "125", name: "125%", icon: IconZoomIn },
  { id: "150", name: "150%", icon: IconZoomIn },
  { id: "175", name: "175%", icon: IconZoomIn },
  { id: "200", name: "200%", icon: IconZoomIn },
]

export const defaultZoom = "100"

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
    title: "Lectornaut",
    description: "The core platform for building AI agents",
    url: "https://lectornaut.io",
    id: "lectornaut",
    icon: IconProduct1,
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
    icon: IconDownload,
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
    icon: IconDevelopers,
    style: { text: "text-teal-500/80", bg: "bg-teal-500/20", grid: "" },
  },
  {
    title: "Documentation",
    description: "Guides and API references",
    url: "https://docs.lectornaut.io",
    id: "documentation",
    icon: IconDocumentation,
    style: { text: "text-emerald-500/80", bg: "bg-emerald-500/20", grid: "" },
  },
  {
    title: "Blog",
    description: "Insights and updates from team",
    url: "https://blog.lectornaut.io",
    id: "blog",
    icon: IconBlog,
    style: { text: "text-green-500/80", bg: "bg-green-500/20", grid: "" },
  },
  {
    title: "Changelog",
    description: "What's new in Lectornaut",
    url: "https://lectornaut.io/changelog",
    id: "changelog",
    icon: IconChangelog,
    style: { text: "text-lime-500/80", bg: "bg-lime-500/20", grid: "" },
  },
  {
    title: "Customers",
    description: "See how others use Lectornaut",
    url: "https://customers.lectornaut.io",
    id: "customers",
    icon: IconCustomers,
    style: { text: "text-yellow-500/80", bg: "bg-yellow-500/20", grid: "" },
  },
  {
    title: "Community",
    description: "Join the Lectornaut community",
    url: "https://community.lectornaut.io",
    id: "community",
    icon: IconCommunity,
    style: { text: "text-amber-500/80", bg: "bg-amber-500/20", grid: "" },
  },
  {
    title: "Security",
    description: "Safety and security resources",
    url: "https://security.lectornaut.io",
    id: "security",
    icon: IconSecurity,
    style: { text: "text-orange-500/80", bg: "bg-orange-500/20", grid: "" },
  },
  {
    title: "Help Center",
    description: "Get help and support",
    url: "https://help.lectornaut.io",
    id: "help-center",
    icon: IconHelpCenter,
    style: { text: "text-red-500/80", bg: "bg-red-500/20", grid: "" },
  },
]

export const companyMenu = [
  {
    title: "About",
    description: "Meet the team",
    url: "https://lectornaut.io/about",
    id: "about-us",
    icon: IconAbout,
    style: { text: "text-neutral-500/80", bg: "bg-neutral-500/20", grid: "" },
  },
  {
    title: "Careers",
    description: "Join our team",
    url: "https://lectornaut.io/careers",
    id: "careers",
    icon: IconCareers,
    style: { text: "text-neutral-500/80", bg: "bg-neutral-500/20", grid: "" },
  },
  {
    title: "Contact",
    description: "Get in touch with us",
    url: "https://lectornaut.io/contact",
    id: "contact-us",
    icon: IconContact,
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

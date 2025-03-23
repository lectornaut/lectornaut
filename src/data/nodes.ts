import BotIcon from "~icons/lucide/bot"
import BoxIcon from "~icons/lucide/box"
import BracesIcon from "~icons/lucide/braces"
import ChevronsLeftRightEllipsisIcon from "~icons/lucide/chevrons-left-right-ellipsis"
import ClockIcon from "~icons/lucide/clock"
import ConeIcon from "~icons/lucide/cone"
import DatabaseIcon from "~icons/lucide/database"
import FileIcon from "~icons/lucide/file"
import PencilRulerIcon from "~icons/lucide/pencil-ruler"
import PlugIcon from "~icons/lucide/plug"
import RepeatIcon from "~icons/lucide/repeat"
import SplitIcon from "~icons/lucide/split"
import TriangleAlertIcon from "~icons/lucide/triangle-alert"
import ZapIcon from "~icons/lucide/zap"

export const nodes = [
  {
    id: "actions",
    name: "Actions",
    groups: [
      {
        id: "basic-flow",
        name: "Basic Flow & Triggers",
        lists: [
          {
            id: "triggers",
            name: "Triggers",
            icon: ZapIcon,
            bg: "bg-sky-500/5 hover:bg-sky-500/10 active:bg-sky-500/10 data-[state=open]:bg-sky-500/10 data-[state=open]:hover:bg-sky-500/10 data-[state=open]:active:bg-sky-500/10",
            color:
              "text-sky-500 hover:text-sky-600 active:text-sky-600 data-[state=open]:text-sky-600 data-[state=open]:hover:text-sky-600 data-[state=open]:active:text-sky-600",
            border:
              "border-sky-600/50 hover:border-sky-600/75 active:border-sky-600/75 data-[state=open]:border-sky-600/75 data-[state=open]:hover:border-sky-600/75 data-[state=open]:active:border-sky-600/75",
            nodes: [
              { id: "start", name: "Start" },
              { id: "stop", name: "Stop" },
              { id: "trigger", name: "Trigger" },
            ],
          },
        ],
      },
      {
        id: "control-flow",
        name: "Control & Flow Management",
        lists: [
          {
            id: "conditions",
            name: "Conditions",
            icon: SplitIcon,
            bg: "bg-rose-500/5 hover:bg-rose-500/10 active:bg-rose-500/10 data-[state=open]:bg-rose-500/10 data-[state=open]:hover:bg-rose-500/10 data-[state=open]:active:bg-rose-500/10",
            color:
              "text-rose-500 hover:text-rose-600 active:text-rose-600 data-[state=open]:text-rose-600 data-[state=open]:hover:text-rose-600 data-[state=open]:active:text-rose-600",
            border:
              "border-rose-600/50 hover:border-rose-600/75 active:border-rose-600/75 data-[state=open]:border-rose-600/75 data-[state=open]:hover:border-rose-600/75 data-[state=open]:active:border-rose-600/75",
            nodes: [
              { id: "ifelse", name: "If-Else" },
              { id: "switch", name: "Switch-Case" },
              { id: "decision", name: "Decision" },
            ],
          },
          {
            id: "loops",
            name: "Loops",
            icon: RepeatIcon,
            bg: "bg-violet-500/5 hover:bg-violet-500/10 active:bg-violet-500/10 data-[state=open]:bg-violet-500/10 data-[state=open]:hover:bg-violet-500/10 data-[state=open]:active:bg-violet-500/10",
            color:
              "text-violet-500 hover:text-violet-600 active:text-violet-600 data-[state=open]:text-violet-600 data-[state=open]:hover:text-violet-600 data-[state=open]:active:text-violet-600",
            border:
              "border-violet-600/50 hover:border-violet-600/75 active:border-violet-600/75 data-[state=open]:border-violet-600/75 data-[state=open]:hover:border-violet-600/75 data-[state=open]:active:border-violet-600/75",
            nodes: [
              { id: "forloop", name: "For Loop" },
              { id: "whileloop", name: "While Loop" },
              { id: "dowhile", name: "Do-While" },
              { id: "timer", name: "Timer" },
            ],
          },
        ],
      },
      {
        id: "advanced-flow",
        name: "Advanced Flow Control",
        lists: [
          {
            id: "scheduling",
            name: "Scheduling & Timing",
            icon: ClockIcon,
            bg: "bg-cyan-500/5 hover:bg-cyan-500/10 active:bg-cyan-500/10 data-[state=open]:bg-cyan-500/10 data-[state=open]:hover:bg-cyan-500/10 data-[state=open]:active:bg-cyan-500/10",
            color:
              "text-cyan-500 hover:text-cyan-600 active:text-cyan-600 data-[state=open]:text-cyan-600 data-[state=open]:hover:text-cyan-600 data-[state=open]:active:text-cyan-600",
            border:
              "border-cyan-600/50 hover:border-cyan-600/75 active:border-cyan-600/75 data-[state=open]:border-cyan-600/75 data-[state=open]:hover:border-cyan-600/75 data-[state=open]:active:border-cyan-600/75",
            nodes: [
              { id: "cron", name: "Cron Job" },
              { id: "webhook", name: "Webhook Trigger" },
              { id: "scheduler", name: "Task Scheduler" },
              { id: "delay", name: "Delay" },
            ],
          },
        ],
      },
      {
        id: "error-handling",
        name: "Error & Exception Handling",
        lists: [
          {
            id: "exceptions",
            name: "Exceptions",
            icon: TriangleAlertIcon,
            bg: "bg-yellow-500/5 hover:bg-yellow-500/10 active:bg-yellow-500/10 data-[state=open]:bg-yellow-500/10 data-[state=open]:hover:bg-yellow-500/10 data-[state=open]:active:bg-yellow-500/10",
            color:
              "text-yellow-500 hover:text-yellow-600 active:text-yellow-600 data-[state=open]:text-yellow-600 data-[state=open]:hover:text-yellow-600 data-[state=open]:active:text-yellow-600",
            border:
              "border-yellow-600/50 hover:border-yellow-600/75 active:border-yellow-600/75 data-[state=open]:border-yellow-600/75 data-[state=open]:hover:border-yellow-600/75 data-[state=open]:active:border-yellow-600/75",
            nodes: [
              { id: "trycatch", name: "Try/Catch" },
              { id: "debug", name: "Debug" },
              { id: "errorhandler", name: "Error Handling" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "features",
    name: "Features",
    groups: [
      {
        id: "core-logic",
        name: "Core Logic & Data Operations",
        lists: [
          {
            id: "data-ops",
            name: "Data Operations",
            icon: BracesIcon,
            bg: "bg-emerald-500/5 hover:bg-emerald-500/10 active:bg-emerald-500/10 data-[state=open]:bg-emerald-500/10 data-[state=open]:hover:bg-emerald-500/10 data-[state=open]:active:bg-emerald-500/10",
            color:
              "text-emerald-500 hover:text-emerald-600 active:text-emerald-600 data-[state=open]:text-emerald-600 data-[state=open]:hover:text-emerald-600 data-[state=open]:active:text-emerald-600",
            border:
              "border-emerald-600/50 hover:border-emerald-600/75 active:border-emerald-600/75 data-[state=open]:border-emerald-600/75 data-[state=open]:hover:border-emerald-600/75 data-[state=open]:active:border-emerald-600/75",
            nodes: [
              { id: "function", name: "Function" },
              { id: "expression", name: "Expression Evaluator" },
              { id: "math", name: "Math Operation" },
              { id: "logical", name: "Logical Operation" },
              { id: "map", name: "Map" },
              { id: "filter", name: "Filter" },
              { id: "reduce", name: "Reduce" },
              { id: "aggregate", name: "Aggregate" },
            ],
          },
        ],
      },
      {
        id: "ai-operations",
        name: "AI Operations",
        lists: [
          {
            id: "ai-agents",
            name: "AI Agents",
            icon: BotIcon,
            bg: "bg-fuchsia-500/5 hover:bg-fuchsia-500/10 active:bg-fuchsia-500/10 data-[state=open]:bg-fuchsia-500/10 data-[state=open]:hover:bg-fuchsia-500/10 data-[state=open]:active:bg-fuchsia-500/10",
            color:
              "text-fuchsia-500 hover:text-fuchsia-600 active:text-fuchsia-600 data-[state=open]:text-fuchsia-600 data-[state=open]:hover:text-fuchsia-600 data-[state=open]:active:text-fuchsia-600",
            border:
              "border-fuchsia-600/50 hover:border-fuchsia-600/75 active:border-fuchsia-600/75 data-[state=open]:border-fuchsia-600/75 data-[state=open]:hover:border-fuchsia-600/75 data-[state=open]:active:border-fuchsia-600/75",
            nodes: [
              { id: "chatbot", name: "Chatbot" },
              { id: "nlp", name: "NLP Processing" },
              { id: "imagegen", name: "Image Generation" },
              { id: "textgen", name: "Text Generation" },
              { id: "speech", name: "Speech Synthesis" },
            ],
          },
        ],
      },
      {
        id: "data-management",
        name: "Data Management",
        lists: [
          {
            id: "variables",
            name: "Variables & Constants",
            icon: BoxIcon,
            bg: "bg-indigo-500/5 hover:bg-indigo-500/10 active:bg-indigo-500/10 data-[state=open]:bg-indigo-500/10 data-[state=open]:hover:bg-indigo-500/10 data-[state=open]:active:bg-indigo-500/10",
            color:
              "text-indigo-500 hover:text-indigo-600 active:text-indigo-600 data-[state=open]:text-indigo-600 data-[state=open]:hover:text-indigo-600 data-[state=open]:active:text-indigo-600",
            border:
              "border-indigo-600/50 hover:border-indigo-600/75 active:border-indigo-600/75 data-[state=open]:border-indigo-600/75 data-[state=open]:hover:border-indigo-600/75 data-[state=open]:active:border-indigo-600/75",
            nodes: [
              { id: "variable", name: "Variable" },
              { id: "constant", name: "Constant" },
              { id: "array", name: "Array/List" },
              { id: "object", name: "Object/Dictionary" },
              { id: "typeconversion", name: "Type Conversion" },
            ],
          },
        ],
      },
      {
        id: "utilities",
        name: "Utilities & Helpers",
        lists: [
          // automations
          {
            id: "automation",
            name: "Automations",
            icon: ClockIcon,
            bg: "bg-lime-500/5 hover:bg-lime-500/10 active:bg-lime-500/10 data-[state=open]:bg-lime-500/10 data-[state=open]:hover:bg-lime-500/10 data-[state=open]:active:bg-lime-500/10",
            color:
              "text-lime-500 hover:text-lime-600 active:text-lime-600 data-[state=open]:text-lime-600 data-[state=open]:hover:text-lime-600 data-[state=open]:active:text-lime-600",
            border:
              "border-lime-600/50 hover:border-lime-600/75 active:border-lime-600/75 data-[state=open]:border-lime-600/75 data-[state=open]:hover:border-lime-600/75 data-[state=open]:active:border-lime-600/75",
            nodes: [
              { id: "schedule", name: "Schedule" },
              { id: "reminder", name: "Reminder" },
              { id: "automation", name: "Automation" },
            ],
          },
          {
            id: "helpers",
            name: "Utilities",
            icon: PencilRulerIcon,
            bg: "bg-purple-500/5 hover:bg-purple-500/10 active:bg-purple-500/10 data-[state=open]:bg-purple-500/10 data-[state=open]:hover:bg-purple-500/10 data-[state=open]:active:bg-purple-500/10",
            color:
              "text-purple-500 hover:text-purple-600 active:text-purple-600 data-[state=open]:text-purple-600 data-[state=open]:hover:text-purple-600 data-[state=open]:active:text-purple-600",
            border:
              "border-purple-600/50 hover:border-purple-600/75 active:border-purple-600/75 data-[state=open]:border-purple-600/75 data-[state=open]:hover:border-purple-600/75 data-[state=open]:active:border-purple-600/75",
            nodes: [
              { id: "logging", name: "Logging" },
              { id: "comment", name: "Comment" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "apps",
    name: "Apps",
    groups: [
      {
        id: "api-web",
        name: "API & Web Services",
        lists: [
          {
            id: "apis",
            name: "APIs",
            icon: ChevronsLeftRightEllipsisIcon,
            bg: "bg-teal-500/5 hover:bg-teal-500/10 active:bg-teal-500/10 data-[state=open]:bg-teal-500/10 data-[state=open]:hover:bg-teal-500/10 data-[state=open]:active:bg-teal-500/10",
            color:
              "text-teal-500 hover:text-teal-600 active:text-teal-600 data-[state=open]:text-teal-600 data-[state=open]:hover:text-teal-600 data-[state=open]:active:text-teal-600",
            border:
              "border-teal-600/50 hover:border-teal-600/75 active:border-teal-600/75 data-[state=open]:border-teal-600/75 data-[state=open]:hover:border-teal-600/75 data-[state=open]:active:border-teal-600/75",
            nodes: [
              { id: "httprequest", name: "HTTP Request" },
              { id: "restapi", name: "REST API" },
              { id: "soapapi", name: "SOAP API" },
              { id: "graphql", name: "GraphQL" },
              { id: "webhook", name: "Webhook Listener" },
            ],
          },
        ],
      },
      {
        id: "app-integrations",
        name: "App Integrations",
        lists: [
          {
            id: "apps",
            name: "Apps",
            icon: ConeIcon,
            bg: "bg-orange-500/5 hover:bg-orange-500/10 active:bg-orange-500/10 data-[state=open]:bg-orange-500/10 data-[state=open]:hover:bg-orange-500/10 data-[state=open]:active:bg-orange-500/10",
            color:
              "text-orange-500 hover:text-orange-600 active:text-orange-600 data-[state=open]:text-orange-600 data-[state=open]:hover:text-orange-600 data-[state=open]:active:text-orange-600",
            border:
              "border-orange-600/50 hover:border-orange-600/75 active:border-orange-600/75 data-[state=open]:border-orange-600/75 data-[state=open]:hover:border-orange-600/75 data-[state=open]:active:border-orange-600/75",
            nodes: [
              { id: "email", name: "Email/SMTP" },
              { id: "sms", name: "SMS Gateway" },
              { id: "notification", name: "Notification" },
              { id: "socialmedia", name: "Social Media" },
              { id: "cloudstorage", name: "Cloud Storage" },
            ],
          },
        ],
      },
      {
        id: "third-party-integrations",
        name: "Third-Party Integrations",
        lists: [
          {
            id: "plugins",
            name: "Plugins & Extensions",
            icon: PlugIcon,
            bg: "bg-pink-500/5 hover:bg-pink-500/10 active:bg-pink-500/10 data-[state=open]:bg-pink-500/10 data-[state=open]:hover:bg-pink-500/10 data-[state=open]:active:bg-pink-500/10",
            color:
              "text-pink-500 hover:text-pink-600 active:text-pink-600 data-[state=open]:text-pink-600 data-[state=open]:hover:text-pink-600 data-[state=open]:active:text-pink-600",
            border:
              "border-pink-600/50 hover:border-pink-600/75 active:border-pink-600/75 data-[state=open]:border-pink-600/75 data-[state=open]:hover:border-pink-600/75 data-[state=open]:active:border-pink-600/75",
            nodes: [
              { id: "google-drive", name: "Google Drive" },
              { id: "slack", name: "Slack" },
              { id: "trello", name: "Trello" },
            ],
          },
        ],
      },
      {
        id: "database-files",
        name: "Database & File Systems",
        lists: [
          {
            id: "databases",
            name: "Databases",
            icon: DatabaseIcon,
            bg: "bg-red-500/5 hover:bg-red-500/10 active:bg-red-500/10 data-[state=open]:bg-red-500/10 data-[state=open]:hover:bg-red-500/10 data-[state=open]:active:bg-red-500/10",
            color:
              "text-red-500 hover:text-red-600 active:text-red-600 data-[state=open]:text-red-600 data-[state=open]:hover:text-red-600 data-[state=open]:active:text-red-600",
            border:
              "border-red-600/50 hover:border-red-600/75 active:border-red-600/75 data-[state=open]:border-red-600/75 data-[state=open]:hover:border-red-600/75 data-[state=open]:active:border-red-600/75",
            nodes: [
              { id: "sqldatabase", name: "SQL Database" },
              { id: "nosqldatabase", name: "NoSQL Database" },
            ],
          },
          {
            id: "files",
            name: "File Operations",
            icon: FileIcon,
            bg: "bg-blue-500/5 hover:bg-blue-500/10 active:bg-blue-500/10 data-[state=open]:bg-blue-500/10 data-[state=open]:hover:bg-blue-500/10 data-[state=open]:active:bg-blue-500/10",
            color:
              "text-blue-500 hover:text-blue-600 active:text-blue-600 data-[state=open]:text-blue-600 data-[state=open]:hover:text-blue-600 data-[state=open]:active:text-blue-600",
            border:
              "border-blue-600/50 hover:border-blue-600/75 active:border-blue-600/75 data-[state=open]:border-blue-600/75 data-[state=open]:hover:border-blue-600/75 data-[state=open]:active:border-blue-600/75",
            nodes: [
              { id: "fileops", name: "File Operations" },
              { id: "ftpsftp", name: "FTP/SFTP" },
            ],
          },
        ],
      },
    ],
  },
]

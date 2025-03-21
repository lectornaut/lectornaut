import { h } from "vue"
import BoxIcon from "~icons/lucide/box"
import BracesIcon from "~icons/lucide/braces"
import ChevronsLeftRightEllipsisIcon from "~icons/lucide/chevrons-left-right-ellipsis"
import ConeIcon from "~icons/lucide/cone"
import DatabaseIcon from "~icons/lucide/database"
import FileIcon from "~icons/lucide/file"
import PencilRulerIcon from "~icons/lucide/pencil-ruler"
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
            icon: h(ZapIcon),
            nodes: [
              { id: "start", name: "Start" },
              { id: "stop", name: "Stop" },
              { id: "trigger", name: "Trigger" },
              { id: "debug", name: "Debug" },
              { id: "comment", name: "Comment" },
              { id: "delay", name: "Delay" },
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
            icon: h(SplitIcon),
            nodes: [
              { id: "ifelse", name: "If-Else" },
              { id: "switch", name: "Switch-Case" },
              { id: "decision", name: "Decision" },
            ],
          },
          {
            id: "loops",
            name: "Loops",
            icon: h(RepeatIcon),
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
        id: "error-handling",
        name: "Error & Exception Handling",
        lists: [
          {
            id: "exceptions",
            name: "Exceptions",
            icon: h(TriangleAlertIcon),
            nodes: [
              { id: "trycatch", name: "Try/Catch" },
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
            icon: h(BracesIcon),
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
        id: "data-management",
        name: "Data Management",
        lists: [
          {
            id: "variables",
            name: "Variables & Constants",
            icon: h(BoxIcon),
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
          {
            id: "helpers",
            name: "Utilities",
            icon: h(PencilRulerIcon),
            nodes: [
              { id: "logging", name: "Logging" },
              { id: "advancedcomments", name: "Advanced Comments" },
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
            icon: h(ChevronsLeftRightEllipsisIcon),
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
            icon: h(ConeIcon),
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
        id: "database-files",
        name: "Database & File Systems",
        lists: [
          {
            id: "databases",
            name: "Databases",
            icon: h(DatabaseIcon),
            nodes: [
              { id: "sqldatabase", name: "SQL Database" },
              { id: "nosqldatabase", name: "NoSQL Database" },
            ],
          },
          {
            id: "files",
            name: "File Operations",
            icon: h(FileIcon),
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

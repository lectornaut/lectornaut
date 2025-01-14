import { h } from "vue"
import IconTransactions from "~icons/lucide/arrow-left-right"
import CircleIcon from "~icons/lucide/circle"
import CheckCircledIcon from "~icons/lucide/circle-check"
import QuestionMarkCircledIcon from "~icons/lucide/circle-dashed"
import StopwatchIcon from "~icons/lucide/circle-dot"
import IconHome from "~icons/lucide/home"
import ArrowUpIcon from "~icons/lucide/signal-high"
import ArrowDownIcon from "~icons/lucide/signal-low"
import ArrowRightIcon from "~icons/lucide/signal-medium"
import IconBalances from "~icons/lucide/wallet-minimal"
import CrossCircledIcon from "~icons/lucide/x-circle"

export const labels = [
  {
    value: "bug",
    label: "Bug",
  },
  {
    value: "feature",
    label: "Feature",
  },
  {
    value: "documentation",
    label: "Documentation",
  },
]

export const statuses = [
  {
    value: "backlog",
    label: "Backlog",
    icon: h(QuestionMarkCircledIcon),
  },
  {
    value: "todo",
    label: "Todo",
    icon: h(CircleIcon),
  },
  {
    value: "in progress",
    label: "In Progress",
    icon: h(StopwatchIcon),
  },
  {
    value: "done",
    label: "Done",
    icon: h(CheckCircledIcon),
  },
  {
    value: "canceled",
    label: "Canceled",
    icon: h(CrossCircledIcon),
  },
]

export const priorities = [
  {
    value: "low",
    label: "Low",
    icon: h(ArrowDownIcon),
  },
  {
    value: "medium",
    label: "Medium",
    icon: h(ArrowRightIcon),
  },
  {
    value: "high",
    label: "High",
    icon: h(ArrowUpIcon),
  },
]

export const links = [
  {
    title: "Home",
    label: "Systems Operational",
    icon: h(IconHome),
    to: "/home",
  },
  {
    title: "Welcome",
    label: "Welcome",
    icon: h(IconBalances),
    to: "/welcome",
  },
  {
    title: "Exit",
    label: "Exit",
    icon: h(IconTransactions),
    to: "/exit",
  },
]

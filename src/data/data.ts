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
    icon: QuestionMarkCircledIcon,
  },
  {
    value: "todo",
    label: "Todo",
    icon: CircleIcon,
  },
  {
    value: "in progress",
    label: "In Progress",
    icon: StopwatchIcon,
  },
  {
    value: "done",
    label: "Done",
    icon: CheckCircledIcon,
  },
  {
    value: "canceled",
    label: "Canceled",
    icon: CrossCircledIcon,
  },
]

export const priorities = [
  {
    value: "low",
    label: "Low",
    icon: ArrowDownIcon,
  },
  {
    value: "medium",
    label: "Medium",
    icon: ArrowRightIcon,
  },
  {
    value: "high",
    label: "High",
    icon: ArrowUpIcon,
  },
]

export const links = [
  {
    title: "Home",
    label: "Systems Operational",
    icon: IconHome,
    to: "/home",
  },
  {
    title: "Welcome",
    label: "Welcome",
    icon: IconBalances,
    to: "/welcome",
  },
  {
    title: "Exit",
    label: "Exit",
    icon: IconTransactions,
    to: "/exit",
  },
]

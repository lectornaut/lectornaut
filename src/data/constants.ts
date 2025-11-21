import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconCheckCircle,
  IconCircle,
  IconCircleDashed,
  IconCircleDot,
  IconXCircle,
} from "@/data/icons"

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
    icon: IconCircleDashed,
  },
  {
    value: "todo",
    label: "Todo",
    icon: IconCircle,
  },
  {
    value: "in progress",
    label: "In Progress",
    icon: IconCircleDot,
  },
  {
    value: "done",
    label: "Done",
    icon: IconCheckCircle,
  },
  {
    value: "canceled",
    label: "Canceled",
    icon: IconXCircle,
  },
]

export const priorities = [
  {
    value: "low",
    label: "Low",
    icon: IconArrowDown,
  },
  {
    value: "medium",
    label: "Medium",
    icon: IconArrowRight,
  },
  {
    value: "high",
    label: "High",
    icon: IconArrowUp,
  },
]

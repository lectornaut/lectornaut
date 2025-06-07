import DataTableColumnHeader from "@/components/table/DataTableColumnHeader.vue"
import DataTableRowActions from "@/components/table/DataTableRowActions.vue"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { labels, priorities, statuses } from "@/data/constants"
import type { Task } from "@/data/schema"
import type { ColumnDef } from "@tanstack/vue-table"

export const columns: ColumnDef<Task>[] = [
  {
    id: "select",
    header: ({ table }) =>
      h(Checkbox, {
        modelValue:
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate"),
        "onUpdate:modelValue": (value: unknown) =>
          table.toggleAllPageRowsSelected(!!value),
        ariaLabel: "Select all",
        class: "mr-2",
      }),
    cell: ({ row }) =>
      h(Checkbox, {
        modelValue: row.getIsSelected(),
        "onUpdate:modelValue": (value: unknown) => row.toggleSelected(!!value),
        ariaLabel: "Select row",
        class: "mr-2",
      }),
    enablePinning: true,
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: ({ column }) => h(DataTableColumnHeader, { column, title: "Task" }),
    cell: ({ row }) => h("div", { class: "" }, row.getValue("id")),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "title",
    header: ({ column }) =>
      h(DataTableColumnHeader, { column, title: "Title" }),
    cell: ({ row }) => {
      const label = labels.find((label) => label.value === row.original.label)
      return h(
        "div",
        {
          class: "flex gap-2 items-center justify-between",
        },
        [
          h("span", { class: "truncate font-medium" }, row.getValue("title")),
          label ? h(Badge, { variant: "outline" }, () => label.label) : null,
        ]
      )
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) =>
      h(DataTableColumnHeader, { column, title: "Status" }),
    cell: ({ row }) => {
      const status = statuses.find(
        (status) => status.value === row.getValue("status")
      )
      if (!status) return null
      return h("div", { class: "flex gap-2  items-center" }, [
        status.icon && h(status.icon, { class: "text-muted-foreground" }),
        h("span", status.label),
      ])
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: "priority",
    header: ({ column }) =>
      h(DataTableColumnHeader, { column, title: "Priority" }),
    cell: ({ row }) => {
      const priority = priorities.find(
        (priority) => priority.value === row.getValue("priority")
      )
      if (!priority) return null
      return h("div", { class: "flex gap-2 items-center " }, [
        priority.icon && h(priority.icon, { class: "text-muted-foreground" }),
        h("span", {}, priority.label),
      ])
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    id: "actions",
    cell: ({ row }) =>
      h(DataTableRowActions, { row, onExpand: row.toggleExpanded }),
    enablePinning: true,
  },
]

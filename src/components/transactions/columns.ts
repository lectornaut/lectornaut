import DataTableColumnHeader from "./DataTableColumnHeader.vue"
import DataTableRowActions from "./DataTableRowActions.vue"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { labels, priorities, statuses } from "@/data/data"
import type { Task } from "@/data/schema"
import type { ColumnDef } from "@tanstack/vue-table"
import { h } from "vue"

export const columns: ColumnDef<Task>[] = [
  {
    id: "select",
    header: ({ table }) =>
      h(Checkbox, {
        checked:
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate"),
        "onUpdate:checked": (value) => table.toggleAllPageRowsSelected(!!value),
        ariaLabel: "Select all",
        class:
          "flex w-3 aspect-square h-3 rounded-sm border-muted-foreground data-[state=checked]:bg-muted-foreground",
      }),
    cell: ({ row }) =>
      h(Checkbox, {
        checked: row.getIsSelected(),
        "onUpdate:checked": (value) => row.toggleSelected(!!value),
        ariaLabel: "Select row",
        class:
          "flex w-3 aspect-square h-3 rounded-sm border-muted-foreground data-[state=checked]:bg-muted-foreground",
      }),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: ({ column }) => h(DataTableColumnHeader, { column, title: "Task" }),
    cell: ({ row }) => h("div", { class: "truncate" }, row.getValue("id")),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "title",
    header: ({ column }) =>
      h(DataTableColumnHeader, { column, title: "Title" }),
    cell: ({ row }) => {
      const label = labels.find((label) => label.value === row.original.label)

      return h("div", { class: "flex items-center gap-2" }, [
        h(
          "span",
          { class: "max-w-64 truncate font-normal" },
          row.getValue("title")
        ),
        label
          ? h(
              Badge,
              {
                variant: "outline",
                class: "rounded-sm px-1 font-medium text-muted-foreground",
              },
              () => label.label
            )
          : null,
      ])
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

      return h("div", { class: "flex truncate gap-2 items-center" }, [
        status.icon && h(status.icon),
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

      return h("div", { class: "flex truncate gap-2 items-center" }, [
        priority.icon && h(priority.icon),
        h("span", {}, priority.label),
      ])
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    id: "actions",
    cell: ({ row }) => h(DataTableRowActions, { row }),
  },
]

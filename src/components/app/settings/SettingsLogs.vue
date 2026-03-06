<script lang="ts" setup>
import DataTableColumnHeader from "@/components/table/DataTableColumnHeader.vue"
import { Badge } from "@/components/ui/badge"
import { useAuditLogs } from "@/composables/useAuditLogs"
import { IconAlertTriangle, IconRefreshCw } from "@/data/icons"
import type { ILogEntry } from "@/types/logs"
import { DateFormatter } from "@internationalized/date"
import type { Column, ColumnDef } from "@tanstack/vue-table"
import { computed, h, onMounted } from "vue"

const df = new DateFormatter("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
})

const { logs, loading, error, hasMore, canViewLogs, fetchLogs } = useAuditLogs()

const formatTimestamp = (entry: ILogEntry) => {
  const timestamp = entry.timestamp?.toDate?.()
  return timestamp ? df.format(timestamp) : "—"
}

const formatActor = (entry: ILogEntry) =>
  entry.actor?.email || entry.actor?.userId || "Unknown"

const formatResource = (entry: ILogEntry) =>
  `${entry.resource.type}: ${entry.resource.id}`

const toUnknownColumn = (column: Column<ILogEntry, unknown>) =>
  column as Column<unknown, unknown>

const actorOptions = computed(() => {
  const values = new Set<string>()
  logs.value.forEach((entry) => {
    const actorLabel = formatActor(entry)
    if (actorLabel) values.add(actorLabel)
  })
  return Array.from(values)
    .sort()
    .map((actor) => ({ label: actor, value: actor }))
})

const columns = computed<ColumnDef<ILogEntry>[]>(() => [
  {
    id: "timestamp",
    accessorFn: (row) => row.timestamp?.toDate?.().getTime() ?? 0,
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: "Timestamp",
      }),
    cell: ({ row }) =>
      h("span", { class: "truncate" }, formatTimestamp(row.original)),
    filterFn: (row, id, value) => {
      if (!value || typeof value !== "object") return true
      const { start, end } = value as { start?: string; end?: string }
      if (!start && !end) return true

      const timestamp = row.getValue(id) as number
      if (!timestamp) return false

      if (start) {
        const startDate = new Date(`${start}T00:00:00`)
        if (
          !Number.isNaN(startDate.getTime()) &&
          timestamp < startDate.getTime()
        )
          return false
      }

      if (end) {
        const endDate = new Date(`${end}T23:59:59.999`)
        if (!Number.isNaN(endDate.getTime()) && timestamp > endDate.getTime())
          return false
      }

      return true
    },
    meta: {
      filterTitle: "Date",
      filterType: "dateRange",
    },
    enableSorting: true,
    enableHiding: false,
    enablePinning: false,
  },
  {
    id: "actor",
    accessorFn: (row) => formatActor(row),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: "Actor",
      }),
    cell: ({ row }) =>
      h("span", { class: "truncate" }, formatActor(row.original)),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
    meta: {
      filterTitle: "Actor",
      filterOptions: actorOptions.value,
    },
    enableSorting: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    accessorKey: "action",
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: "Action",
      }),
    cell: ({ row }) =>
      h(Badge, { variant: "outline" }, () => String(row.getValue("action"))),
    enableSorting: false,
    enableHiding: true,
    enablePinning: false,
  },
  {
    id: "resource",
    accessorFn: (row) => formatResource(row),
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: "Resource",
      }),
    cell: ({ row }) =>
      h("span", { class: "truncate" }, formatResource(row.original)),
    enableSorting: false,
    enableHiding: true,
    enablePinning: false,
  },
])
const refreshLogs = () => fetchLogs(true)
const loadMore = () => fetchLogs(false)

onMounted(() => {
  fetchLogs(true)
})
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field v-if="!canViewLogs" orientation="horizontal">
          <FieldContent>
            <div class="rounded-md border border-dashed p-6 text-sm">
              You do not have access to view audit logs.
            </div>
          </FieldContent>
        </Field>
        <template v-else>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>Audit Logs</FieldLabel>
              <FieldDescription>
                View system and activity logs for your team.
              </FieldDescription>
            </FieldContent>
            <Button variant="secondary" @click="refreshLogs">
              <IconRefreshCw />
              Refresh
            </Button>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <Empty v-if="loading">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Spinner />
                  </EmptyMedia>
                  <EmptyTitle>{{ $t("common.loading") }}</EmptyTitle>
                </EmptyHeader>
              </Empty>
              <Empty v-else-if="error">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconAlertTriangle />
                  </EmptyMedia>
                  <EmptyTitle>{{ $t("pages.join.states.error") }}</EmptyTitle>
                  <EmptyDescription>{{ error }}</EmptyDescription>
                </EmptyHeader>
              </Empty>
              <DataTable
                v-else
                :data="logs"
                :columns="columns"
                class="overflow-clip rounded-md border"
              />
            </FieldContent>
          </Field>
          <Field v-if="hasMore && logs.length > 0" orientation="horizontal">
            <FieldContent>
              <div class="flex justify-center">
                <Button
                  variant="secondary"
                  :disabled="loading"
                  @click="loadMore"
                >
                  Load More
                </Button>
              </div>
            </FieldContent>
          </Field>
        </template>
      </FieldSet>
    </FieldGroup>
  </div>
</template>

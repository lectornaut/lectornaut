<script lang="ts" setup>
import DataTableColumnHeader from "@/components/table/DataTableColumnHeader.vue"
import { Badge } from "@/components/ui/badge"
import { useAuditLogs } from "@/composables/useAuditLogs"
import { useTeamActions } from "@/composables/useTeamActions"
import { IconAlertTriangle, IconDownload, IconRefreshCw } from "@/data/icons"
import { saveTextFile } from "@/helpers/saveTextFile"
import { emitter } from "@/modules/mitt"
import { useAuthStore } from "@/stores/authStore"
import { useBillingStore } from "@/stores/billingStore"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"
import type { AppTableFeatures } from "@/components/table/features"
import type { ILogEntry } from "@/types/logs"
import type { Column, ColumnDef, RowData } from "@tanstack/vue-table"
import { computed, h, onMounted, ref } from "vue"

const { t } = useI18n()
const {
  logs,
  loading,
  error,
  hasMore,
  canViewLogs,
  fetchLogs,
  auditLogRetentionDays,
  canExportAuditLogs,
} = useAuditLogs()
const { canManageBilling } = useTeamActions()
const { currentTeamId } = storeToRefs(useAuthStore())
const { planKey } = storeToRefs(useBillingStore())
const planTitle = computed(() =>
  t(`settings.plans.subscriptionPlan.${planKey.value ?? "personal"}.title`)
)
const openPlans = (): void => {
  emitter.emit("Dialog.Settings.Open", "plans")
}

// Export = the rows already loaded (the page loads every retained entry).
// Plan-gated client-side; the data itself is admin-readable regardless.
const isExporting = ref(false)
const exportLogs = async (): Promise<void> => {
  if (!canExportAuditLogs.value || isExporting.value) return
  isExporting.value = true
  try {
    const rows = logs.value.map((entry) => ({
      ...entry,
      timestamp: entry.timestamp?.toDate?.()?.toISOString() ?? null,
    }))
    const stamp = new Date().toISOString().slice(0, 10)
    const saved = await saveTextFile(
      `audit-logs-${currentTeamId.value ?? "team"}-${stamp}.json`,
      JSON.stringify(rows, null, 2)
    )
    if (saved) toast.success(t("settings.logs.export.success"))
  } catch (err) {
    console.error("[SettingsLogs] export failed:", err)
    toast.error(t("settings.logs.export.error"))
  } finally {
    isExporting.value = false
  }
}

const fetchAllLogs = async (reset = true) => {
  await fetchLogs(reset)
  while (hasMore.value) {
    await fetchLogs(false)
  }
}

const formatTimestamp = (entry: ILogEntry) => {
  const timestamp = entry.timestamp?.toDate?.()
  return timestamp
    ? useDateFormat(timestamp, "MMM D, YYYY · h:mm A").value
    : "—"
}

const formatActor = (entry: ILogEntry) =>
  // Agent-authored entries carry only `agentId`/`agentName` (an autonomous
  // run has no `userId`/`email`), so surface the agent first — otherwise every
  // agent action collapses to "Unknown". Human actions fall straight through.
  entry.actor?.agentName ||
  entry.actor?.email ||
  entry.actor?.userId ||
  (entry.actor?.agentId
    ? t("settings.logs.agentActor")
    : t("settings.logs.unknownActor"))

const formatResource = (entry: ILogEntry) =>
  `${entry.resource.type}: ${entry.resource.id}`

const toUnknownColumn = (
  column: Column<AppTableFeatures, ILogEntry, unknown>
) => column as unknown as Column<AppTableFeatures, RowData, unknown>

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

const columns = computed<ColumnDef<AppTableFeatures, ILogEntry>[]>(() => [
  {
    id: "timestamp",
    accessorFn: (row) => row.timestamp?.toDate?.().getTime() ?? 0,
    header: ({ column }) =>
      h(DataTableColumnHeader, {
        column: toUnknownColumn(column),
        title: t("settings.logs.columnTimestamp"),
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
      filterTitle: t("settings.logs.filterDate"),
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
        title: t("settings.logs.columnActor"),
      }),
    cell: ({ row }) =>
      h("span", { class: "truncate" }, formatActor(row.original)),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
    meta: {
      filterTitle: t("settings.logs.filterActor"),
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
        title: t("settings.logs.columnAction"),
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
        title: t("settings.logs.columnResource"),
      }),
    cell: ({ row }) =>
      h("span", { class: "truncate" }, formatResource(row.original)),
    enableSorting: false,
    enableHiding: true,
    enablePinning: false,
  },
])
const refreshLogs = () => fetchAllLogs(true)

onMounted(() => {
  fetchAllLogs(true)
})
</script>

<template>
  <div class="p-6">
    <FieldGroup>
      <FieldSet>
        <Field v-if="!canViewLogs" orientation="horizontal">
          <FieldContent>
            <Empty class="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconAlertTriangle />
                </EmptyMedia>
                <EmptyTitle>{{
                  t("settings.logs.noPermissionTitle")
                }}</EmptyTitle>
                <EmptyDescription>
                  {{ t("settings.logs.noPermissionDescription") }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FieldContent>
        </Field>
        <template v-else>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>{{ $t("settings.logs.auditLogs.label") }}</FieldLabel>
              <FieldDescription>
                {{ $t("settings.logs.auditLogs.description") }}
                {{
                  auditLogRetentionDays < 0
                    ? t("settings.logs.retention.unlimited", {
                        plan: planTitle,
                      })
                    : t("settings.logs.retention.days", {
                        days: auditLogRetentionDays,
                        plan: planTitle,
                      })
                }}
              </FieldDescription>
            </FieldContent>
            <div class="flex items-center gap-2">
              <Button
                v-if="!canExportAuditLogs && canManageBilling"
                variant="outline"
                @click="openPlans"
              >
                {{ t("settings.logs.export.upgrade") }}
              </Button>
              <Button
                v-if="canExportAuditLogs"
                variant="outline"
                :disabled="loading || isExporting || logs.length === 0"
                @click="exportLogs"
              >
                <IconDownload />
                {{ t("settings.logs.export.button") }}
              </Button>
              <Button variant="secondary" @click="refreshLogs">
                <IconRefreshCw />
                {{ t("settings.logs.refresh") }}
              </Button>
            </div>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <LoadingState v-if="loading" :label="$t('common.loading')" />
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
                class="overflow-clip rounded-4xl border"
              />
            </FieldContent>
          </Field>
        </template>
      </FieldSet>
    </FieldGroup>
  </div>
</template>

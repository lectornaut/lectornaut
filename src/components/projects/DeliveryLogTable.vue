<script setup lang="ts">
import type { ProjectDeliveryLog, ProjectDeliveryStatus } from "@/types/projects"
import { valueUpdater } from "@/lib/utils"
import type { DateRange } from "reka-ui"
import {
  FlexRender,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useVueTable,
} from "@tanstack/vue-table"
import { DateFormatter, getLocalTimeZone } from "@internationalized/date"
import Badge from "@/components/ui/badge/Badge.vue"
import Button from "@/components/ui/button/Button.vue"
import Spinner from "@/components/ui/spinner/Spinner.vue"
import IconAlertCircle from "~icons/lucide/alert-triangle"
import IconCheckCircle from "~icons/lucide/check-circle"
import IconClock from "~icons/lucide/clock-3"
import IconRefreshCcw from "~icons/lucide/refresh-cw"
import IconActivity from "~icons/lucide/activity"
import IconPauseCircle from "~icons/lucide/pause-circle"
import IconSkipForward from "~icons/lucide/skip-forward"
import IconXCircle from "~icons/lucide/circle-x"
import IconEye from "~icons/lucide/eye"
import IconRotateCcw from "~icons/lucide/rotate-ccw"
import type { Component } from "vue"
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue"

const props = defineProps<{
  logs: ProjectDeliveryLog[]
  statusFilter: ProjectDeliveryStatus[]
  dateRange: DateRange | null
  statuses: ProjectDeliveryStatus[]
  retryingId?: string | null
  testing?: boolean
}>()

const emit = defineEmits<{
  (e: "retry", deliveryId: string): void
  (e: "inspect", delivery: ProjectDeliveryLog): void
  (e: "clearFilters"): void
  (e: "test"): void
}>()

const timezone = getLocalTimeZone()
const formatter = new DateFormatter("en-US", {
  month: "short",
  day: "2-digit",
})

const sorting = ref<SortingState>([
  {
    id: "triggeredAt",
    desc: true,
  },
])

const pageSize = ref(25)
const isAutoLoading = ref(false)
const scrollContainerRef = ref<HTMLElement | null>(null)
const scrollWrapper = scrollContainerRef

const statusMeta: Record<
  ProjectDeliveryStatus,
  {
    label: string
    icon: Component
    badgeClass: string
    textClass: string
  }
> = {
  success: {
    label: "Success",
    icon: IconCheckCircle,
    badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
    textClass: "text-emerald-500",
  },
  failed: {
    label: "Failed",
    icon: IconXCircle,
    badgeClass: "border-destructive/40 bg-destructive/10 text-destructive",
    textClass: "text-destructive",
  },
  pending: {
    label: "Pending",
    icon: IconPauseCircle,
    badgeClass: "border-muted-foreground/20 bg-muted text-muted-foreground",
    textClass: "text-muted-foreground",
  },
  processing: {
    label: "Processing",
    icon: IconActivity,
    badgeClass: "border-primary/40 bg-primary/10 text-primary",
    textClass: "text-primary",
  },
  queued: {
    label: "Queued",
    icon: IconClock,
    badgeClass: "border-sky-500/40 bg-sky-500/10 text-sky-500",
    textClass: "text-sky-500",
  },
  retrying: {
    label: "Retrying",
    icon: IconRefreshCcw,
    badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-500",
    textClass: "text-amber-500",
  },
  throttled: {
    label: "Throttled",
    icon: IconAlertCircle,
    badgeClass: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500",
    textClass: "text-yellow-600",
  },
  skipped: {
    label: "Skipped",
    icon: IconSkipForward,
    badgeClass: "border-muted-foreground/30 bg-muted text-muted-foreground",
    textClass: "text-muted-foreground",
  },
}

const toTitleCase = (value: string) =>
  value
    .split(/[\s-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")

const filteredLogs = computed(() => {
  if (!props.logs?.length) return []

  const statuses = props.statusFilter
  const hasStatusFilter = statuses.length > 0

  const start = props.dateRange?.start
    ? props.dateRange.start.toDate(timezone)
    : null
  const end = props.dateRange?.end
    ? (() => {
        const value = props.dateRange?.end?.toDate(timezone)
        if (!value) return null
        const inclusive = new Date(value)
        inclusive.setHours(23, 59, 59, 999)
        return inclusive
      })()
    : null

  return props.logs.filter((log) => {
    if (hasStatusFilter && !statuses.includes(log.status)) return false

    const triggered = new Date(log.triggeredAt)
    if (Number.isNaN(triggered.getTime())) return false

    if (start && triggered < start) return false
    if (end && triggered > end) return false

    return true
  })
})

watch(
  () => [props.statusFilter, props.dateRange, props.logs],
  () => {
    pageSize.value = 25
    nextTick(() => {
      const el = scrollContainerRef.value
      if (el) el.scrollTop = 0
    })
  },
  { deep: true }
)

const visibleLogs = computed(() => filteredLogs.value.slice(0, pageSize.value))
const totalCount = computed(() => filteredLogs.value.length)
const displayedCount = computed(() => visibleLogs.value.length)
const hasMore = computed(() => displayedCount.value < totalCount.value)
const statusFilterValues = computed(() => props.statusFilter)
const allLogsCount = computed(() => props.logs.length)

const loadMore = () => {
  if (!hasMore.value) return
  pageSize.value += 25
}

const handleScroll = () => {
  const el = scrollWrapper.value
  if (!el || isAutoLoading.value || !hasMore.value) return
  const threshold = 64
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
    isAutoLoading.value = true
    loadMore()
    requestAnimationFrame(() => {
      isAutoLoading.value = false
    })
  }
}

onMounted(() => {
  nextTick(() => {
    scrollWrapper.value = document.getElementById("project-delivery-scroll")
    scrollWrapper.value?.addEventListener("scroll", handleScroll, {
      passive: true,
    })
  })
})

onBeforeUnmount(() => {
  scrollWrapper.value?.removeEventListener("scroll", handleScroll)
})

const dateRangeLabel = computed(() => {
  if (!props.dateRange?.start && !props.dateRange?.end) return null
  const start = props.dateRange?.start?.toDate(timezone)
  const end = props.dateRange?.end?.toDate(timezone)

  if (start && end) {
    return `${formatter.format(start)} – ${formatter.format(end)}`
  }
  if (start) {
    return `Since ${formatter.format(start)}`
  }
  if (end) {
    return `Until ${formatter.format(end)}`
  }
  return null
})

const activeStatuses = computed(() => props.statusFilter.map(toTitleCase))
const hasActiveFilters = computed(
  () => activeStatuses.value.length > 0 || !!dateRangeLabel.value
)

const formatTimestamp = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const formatRelative = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  const diffMs = Date.now() - date.getTime()
  const seconds = Math.round(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  return `${weeks}w ago`
}

const formatResponse = (ms?: number | null) => {
  if (!ms || ms <= 0) return "—"
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`
  const minutes = seconds / 60
  return `${minutes.toFixed(minutes >= 10 ? 0 : 1)} min`
}

const truncate = (value: string | undefined | null, length = 60) => {
  if (!value) return "—"
  if (value.length <= length) return value
  return `${value.slice(0, length)}…`
}

const columns = computed<ColumnDef<ProjectDeliveryLog>[]>(() => [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const meta = statusMeta[row.original.status]
      return h(
        "div",
        { class: "flex items-center gap-2" },
        [
          h(meta.icon, { class: `${meta.textClass} size-4` }),
          h(
            Badge,
            {
              variant: "outline",
              class: `${meta.badgeClass} border text-[0.65rem] font-medium uppercase tracking-wide`,
            },
            () => meta.label
          ),
          row.original.test
            ? h(
                Badge,
                {
                  variant: "secondary",
                  class: "bg-muted text-muted-foreground text-[0.65rem] uppercase",
                },
                () => "Test"
              )
            : null,
        ].filter(Boolean)
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: "triggeredAt",
    header: "Triggered",
    cell: ({ row }) =>
      h("div", { class: "flex flex-col" }, [
        h(
          "span",
          { class: "font-mono text-xs" },
          formatTimestamp(row.original.triggeredAt)
        ),
        h(
          "span",
          { class: "text-muted-foreground text-[0.65rem]" },
          formatRelative(row.original.triggeredAt)
        ),
      ]),
  },
  {
    accessorKey: "destination",
    header: "Destination",
    cell: ({ row }) =>
      h(
        "div",
        { class: "max-w-[240px] truncate text-xs" },
        row.original.destination
      ),
  },
  {
    accessorKey: "responseTimeMs",
    header: "Response",
    cell: ({ row }) =>
      h(
        "span",
        { class: "text-xs font-medium" },
        formatResponse(row.original.responseTimeMs)
      ),
  },
  {
    accessorKey: "attempt",
    header: "Attempt",
    cell: ({ row }) =>
      h(
        Badge,
        {
          variant: "outline",
          class: "border-border bg-muted/60 text-[0.65rem]",
        },
        () => `#${row.original.attempt}`
      ),
  },
  {
    id: "error",
    header: "Message",
    cell: ({ row }) =>
      h(
        "span",
        { class: "max-w-[260px] truncate text-xs" },
        truncate(row.original.error?.message ?? row.original.responsePayload?.status)
      ),
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row }) => {
      const isRetrying = props.retryingId === row.original.id
      const canRetry =
        row.original.status !== "success" && row.original.status !== "skipped"
      return h("div", { class: "flex items-center gap-1" }, [
        h(
          Button,
          {
            variant: "ghost",
            size: "icon-xs",
            title: "Inspect delivery",
            onClick: () => emit("inspect", row.original),
          },
          () => h(IconEye, { class: "size-4" })
        ),
        h(
          Button,
          {
            variant: "ghost",
            size: "icon-xs",
            title: canRetry ? "Retry delivery" : "Retry unavailable",
            disabled: !canRetry || isRetrying,
            onClick: () => {
              if (!canRetry || isRetrying) return
              emit("retry", row.original.id)
            },
          },
          () =>
            isRetrying
              ? h(Spinner, { class: "size-3" })
              : h(IconRotateCcw, { class: "size-4" })
        ),
      ])
    },
    enableSorting: false,
  },
])

const table = useVueTable({
  get data() {
    return visibleLogs.value
  },
  get columns() {
    return columns.value
  },
  state: {
    get sorting() {
      return sorting.value
    },
  },
  onSortingChange: (updater) => valueUpdater(updater, sorting),
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
})

const statusOptionsSorted = computed(() =>
  [...props.statuses].sort((a, b) => a.localeCompare(b))
)
</script>

<template>
  <Card class="flex h-full flex-col shadow-none">
    <CardHeader class="gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-col">
          <CardTitle class="text-lg font-semibold">Delivery log</CardTitle>
          <CardDescription class="text-xs">
            Showing {{ displayedCount }} of {{ totalCount }} deliveries
            <template v-if="allLogsCount !== totalCount">
              ({{ allLogsCount }} total)
            </template>
          </CardDescription>
        </div>
        <div class="flex items-center gap-2">
          <Button
            v-if="hasActiveFilters"
            variant="outline"
            size="xs"
            class="text-xs"
            @click="emit('clearFilters')"
          >
            Clear filters
          </Button>
          <Button
            variant="default"
            size="sm"
            class="gap-2"
            :disabled="testing"
            @click="emit('test')"
          >
            <Spinner v-if="testing" class="size-3" />
            <icon-lucide-flask-conical v-else class="size-4" />
            Trigger test event
          </Button>
        </div>
      </div>
      <div
        v-if="hasActiveFilters"
        class="flex flex-wrap items-center gap-2 text-xs"
      >
        <template v-for="status in activeStatuses" :key="status">
          <Badge variant="secondary" class="bg-muted text-muted-foreground">
            Status · {{ status }}
          </Badge>
        </template>
        <Badge
          v-if="dateRangeLabel"
          variant="secondary"
          class="bg-muted text-muted-foreground"
        >
          {{ dateRangeLabel }}
        </Badge>
      </div>
      <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>Status filters:</span>
        <span
          v-for="option in statusOptionsSorted"
          :key="option"
          :class="[
            'rounded-full border px-2 py-[2px]',
            statusFilterValues.includes(option)
              ? 'border-primary/60 bg-primary/10 text-primary'
              : 'border-muted bg-muted/40',
          ]"
        >
          {{ toTitleCase(option) }}
        </span>
      </div>
    </CardHeader>
    <CardContent class="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
      <div id="project-delivery-scroll" class="flex-1 overflow-auto">
        <OverlayScrollbarsWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead v-for="header in table.getFlatHeaders()" :key="header.id">
                  <FlexRender
                    :render="header.column.columnDef.header"
                    :props="header.getContext()"
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-if="table.getRowModel().rows.length">
                <TableRow
                  v-for="row in table.getRowModel().rows"
                  :key="row.id"
                  class="align-top"
                >
                  <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                    <FlexRender
                      :render="cell.column.columnDef.cell"
                      :props="cell.getContext()"
                    />
                  </TableCell>
                </TableRow>
              </template>
              <template v-else>
                <TableRow>
                  <TableCell :colspan="columns.length" class="h-32 text-center">
                    <div class="flex flex-col items-center gap-2">
                      <icon-lucide-inbox class="text-muted-foreground size-6" />
                      <p class="text-muted-foreground text-sm">
                        No deliveries match the current filters.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              </template>
            </TableBody>
          </Table>
        </OverlayScrollbarsWrapper>
      </div>
      <div
        v-if="hasMore || isAutoLoading"
        class="border-t px-4 py-3 text-center"
      >
        <Button variant="ghost" size="sm" @click="loadMore">
          <Spinner v-if="isAutoLoading" class="mr-2 size-3" />
          <span>{{ isAutoLoading ? "Loading" : "Load more" }}</span>
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

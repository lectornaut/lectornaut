<script setup lang="ts">
import DeliveryInspectorSheet from "@/components/projects/DeliveryInspectorSheet.vue"
import DeliveryLogTable from "@/components/projects/DeliveryLogTable.vue"
import DeliveryMetrics from "@/components/projects/DeliveryMetrics.vue"
import type { ProjectDeliveryLog, ProjectDeliveryStatus } from "@/types/projects"
import { useProjectDeliveriesStore } from "@/stores/projectDeliveriesStore"
import { DateFormatter, getLocalTimeZone, today } from "@internationalized/date"
import type { DateRange } from "reka-ui"
import { toast } from "vue-sonner"
import { computed, nextTick, ref, watch } from "vue"
import IconAlertTriangle from "~icons/lucide/alert-triangle"
import IconChartNoAxesColumn from "~icons/lucide/chart-no-axes-column"
import IconInbox from "~icons/lucide/inbox"

const route = useRoute("/projects/[channelId]")

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Projects",
    breadcrumb: (r: { params: { channelId?: string } }) =>
      r.params?.channelId ? `Channel ${r.params.channelId}` : "Channel",
  },
})

const store = useProjectDeliveriesStore()

const channelId = computed(() => route.params.channelId as string)

const channel = computed(() => store.getChannelById(channelId.value) ?? null)

useHead(() => ({
  title: channel.value ? `${channel.value.name} · Projects` : "Projects",
}))

const timezone = getLocalTimeZone()
const dateLabelFormatter = new DateFormatter("en-US", {
  dateStyle: "medium",
})

const defaultRange: DateRange = {
  start: today(timezone).subtract({ days: 7 }),
  end: today(timezone),
}

const dateRange = ref<DateRange | null>(null)
const calendarRange = computed<DateRange>({
  get: () => dateRange.value ?? defaultRange,
  set: (value) => {
    dateRange.value = value
  },
})

const statusFilter = ref<ProjectDeliveryStatus[]>([])

const deliveries = computed(() => store.getDeliveriesForChannel(channelId.value))
const summary = computed(() => store.getChannelSummary(channelId.value))

const statusCounts = computed<Record<ProjectDeliveryStatus, number>>(() => {
  const counts = {} as Record<ProjectDeliveryStatus, number>
  for (const log of deliveries.value) {
    counts[log.status] = (counts[log.status] ?? 0) + 1
  }
  return counts
})

const channelStatuses = computed<ProjectDeliveryStatus[]>(() => {
  const unique = new Set<ProjectDeliveryStatus>(deliveries.value.map((log) => log.status))
  if (unique.size === 0) {
    for (const status of store.statusOptions) {
      unique.add(status)
    }
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b))
})

const selectedDelivery = ref<ProjectDeliveryLog | null>(null)
const inspectorOpen = ref(false)

const retryingId = ref<string | null>(null)
const testing = ref(false)

const presets: { id: number; label: string; value: DateRange }[] = [
  {
    id: 7,
    label: "Last 7 days",
    value: {
      start: today(timezone).subtract({ days: 7 }),
      end: today(timezone),
    },
  },
  {
    id: 14,
    label: "Last 14 days",
    value: {
      start: today(timezone).subtract({ days: 14 }),
      end: today(timezone),
    },
  },
  {
    id: 30,
    label: "Last 30 days",
    value: {
      start: today(timezone).subtract({ days: 30 }),
      end: today(timezone),
    },
  },
  {
    id: 90,
    label: "Last 90 days",
    value: {
      start: today(timezone).subtract({ days: 90 }),
      end: today(timezone),
    },
  },
]

const rangeLabel = computed(() => {
  if (!dateRange.value?.start || !dateRange.value?.end) return "All time"
  return `${dateLabelFormatter.format(dateRange.value.start.toDate(timezone))} – ${dateLabelFormatter.format(dateRange.value.end.toDate(timezone))}`
})

const toggleStatus = (status: ProjectDeliveryStatus, checked: boolean) => {
  if (checked) {
    if (!statusFilter.value.includes(status)) {
      statusFilter.value = [...statusFilter.value, status]
    }
  } else {
    statusFilter.value = statusFilter.value.filter((item) => item !== status)
  }
}

const clearFilters = () => {
  statusFilter.value = []
  dateRange.value = null
}

const handleInspect = (delivery: ProjectDeliveryLog) => {
  selectedDelivery.value = delivery
  inspectorOpen.value = true
}

const handleRetry = async (deliveryId: string) => {
  retryingId.value = deliveryId
  try {
    const result = await store.retryDelivery(deliveryId)
    retryingId.value = null
    if (!result.success) {
      toast.error("Retry failed", {
        description: result.error ?? "Unexpected error while retrying delivery.",
      })
      return
    }

    toast.success("Retry dispatched", {
      description: `Delivery ${result.delivery?.id ?? deliveryId} has been queued for retry.`,
    })

    if (result.fallbackMessage) {
      toast.info("Callable unavailable", {
        description: result.fallbackMessage,
      })
    }
  } catch (error) {
    retryingId.value = null
    toast.error("Retry failed", {
      description:
        error instanceof Error ? error.message : "Unexpected error while retrying delivery.",
    })
  }
}

const handleTest = async () => {
  if (!channel.value) return
  testing.value = true
  try {
    const result = await store.testChannel(channel.value.id)
    testing.value = false

    if (!result.success) {
      toast.error("Test event failed", {
        description: result.error ?? "Unable to trigger test delivery.",
      })
      return
    }

    toast.success("Test event sent", {
      description: result.delivery
        ? `Delivery ${result.delivery.id} added to the log.`
        : "The channel accepted a simulated test event.",
    })

    if (result.fallbackMessage) {
      toast.info("Callable unavailable", {
        description: result.fallbackMessage,
      })
    }

    nextTick(() => {
      if (result.delivery) {
        selectedDelivery.value = result.delivery
      }
    })
  } catch (error) {
    testing.value = false
    toast.error("Test event failed", {
      description:
        error instanceof Error ? error.message : "Unable to trigger test delivery.",
    })
  }
}

watch(
  () => channelId.value,
  () => {
    statusFilter.value = []
    dateRange.value = null
    inspectorOpen.value = false
    selectedDelivery.value = null
    if (!store.getChannelById(channelId.value)) {
      toast.error("Channel missing", {
        description: "We could not find a channel with this identifier.",
      })
    }
  },
  { immediate: true }
)

const toTitleCase = (value: string) =>
  value
    .split(/[\s-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <template v-if="channel">
        <SidebarHeader class="gap-1">
          <SidebarGroupLabel class="text-left">
            {{ channel.name }}
          </SidebarGroupLabel>
          <SidebarGroupDescription class="text-left text-xs">
            {{ channel.description }}
          </SidebarGroupDescription>
        </SidebarHeader>
        <Separator />
        <SidebarContent>
          <OverlayScrollbarsWrapper>
            <SidebarGroup>
              <SidebarGroupLabel>Status filters</SidebarGroupLabel>
              <SidebarGroupContent class="grid gap-2">
                <div
                  v-for="status in channelStatuses"
                  :key="status"
                  class="flex items-center gap-3"
                >
                  <Checkbox
                    :checked="statusFilter.includes(status)"
                    @update:checked="(value) => toggleStatus(status, !!value)"
                  />
                  <span class="text-xs font-medium uppercase tracking-wide">
                    {{ toTitleCase(status) }}
                  </span>
                  <Badge
                    variant="outline"
                    class="ml-auto border-muted bg-muted/40 text-[0.65rem]"
                  >
                    {{ statusCounts[status] ?? 0 }}
                  </Badge>
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
            <Separator class="my-3" />
            <SidebarGroup>
              <SidebarGroupLabel>Date range</SidebarGroupLabel>
              <SidebarGroupContent class="grid gap-3">
                <Popover>
                  <PopoverTrigger as-child>
                    <Button variant="outline" size="sm" class="justify-start">
                      <icon-lucide-calendar class="mr-2 size-4" />
                      <span>{{ rangeLabel }}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-[320px] p-0" align="start">
                    <div class="p-2">
                      <Select v-model="dateRange">
                        <SelectTrigger>
                          <SelectValue placeholder="Choose preset" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="preset in presets"
                            :key="preset.id"
                            :value="preset.value"
                          >
                            {{ preset.label }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Separator />
                    <RangeCalendar
                      v-model="calendarRange"
                      :max-value="today(timezone)"
                      initial-focus
                      class="p-2"
                    />
                    <div class="flex items-center justify-between gap-2 p-2">
                      <Button variant="ghost" size="xs" @click="dateRange = null">
                        Clear
                      </Button>
                      <Button variant="outline" size="xs" @click="dateRange = defaultRange">
                        Last 7 days
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </SidebarGroupContent>
            </SidebarGroup>
          </OverlayScrollbarsWrapper>
        </SidebarContent>
        <Separator />
        <SidebarFooter>
          <Button variant="ghost" size="sm" class="w-full" @click="clearFilters">
            Reset filters
          </Button>
        </SidebarFooter>
      </template>
      <template v-else>
        <EmptySection
          centered
          :icon="IconAlertTriangle"
          title="Channel not found"
          description="The requested channel is unavailable."
        />
      </template>
    </Sidebar>
  </Teleport>

  <div class="flex grow flex-col overflow-hidden">
    <div v-if="channel" class="flex h-full flex-col gap-2 p-2">
      <DeliveryLogTable
        :logs="deliveries"
        :status-filter="statusFilter"
        :date-range="dateRange"
        :statuses="channelStatuses"
        :retrying-id="retryingId"
        :testing="testing"
        @inspect="handleInspect"
        @retry="handleRetry"
        @clear-filters="clearFilters"
        @test="handleTest"
      />
    </div>
    <EmptySection
      v-else
      centered
      :icon="IconInbox"
      title="Channel missing"
      description="We could not load data for this channel."
    />
  </div>

  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <template v-if="channel">
        <SidebarHeader>
          <SidebarGroupLabel class="text-left">Metrics</SidebarGroupLabel>
        </SidebarHeader>
        <Separator />
        <SidebarContent>
          <OverlayScrollbarsWrapper>
            <DeliveryMetrics :summary="summary" />
          </OverlayScrollbarsWrapper>
        </SidebarContent>
      </template>
      <template v-else>
        <EmptySection
          centered
          :icon="IconChartNoAxesColumn"
          title="No metrics"
          description="Metrics are unavailable until a channel is selected."
        />
      </template>
    </Sidebar>
  </Teleport>

  <DeliveryInspectorSheet
    v-model:open="inspectorOpen"
    :delivery="selectedDelivery"
  />
</template>

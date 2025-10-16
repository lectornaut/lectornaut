<script setup lang="ts">
import type { ProjectChannelSummary } from "@/types/projects"
import { computed } from "vue"

const props = defineProps<{
  summary: ProjectChannelSummary | null
}>()

const successPercentage = computed(() => {
  const value = props.summary?.successRate ?? 0
  return Math.max(0, Math.min(100, Math.round(value * 100)))
})

const formattedAverage = computed(() => {
  const ms = props.summary?.averageResponseMs ?? 0
  if (ms <= 0) return "—"
  if (ms >= 1000) {
    const seconds = ms / 1000
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  }
  return `${ms}ms`
})

const lastError = computed(() => props.summary?.lastError)

const formattedErrorTime = computed(() => {
  if (!lastError.value?.occurredAt) return null
  const date = new Date(lastError.value.occurredAt)
  if (Number.isNaN(date.getTime())) return lastError.value.occurredAt
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
})

const totalDeliveriesLabel = computed(() => {
  if (!props.summary) return "No deliveries recorded"
  if (props.summary.totalDeliveries === 0) return "No deliveries recorded"
  return `${props.summary.successCount} of ${props.summary.totalDeliveries} deliveries succeeded`
})

const failureCountLabel = computed(() => {
  if (!props.summary) return ""
  if (props.summary.failureCount === 0) return "None"
  return `${props.summary.failureCount} delivery${props.summary.failureCount === 1 ? "" : "ies"}`
})
</script>

<template>
  <div class="grid gap-3">
    <Card class="shadow-none">
      <CardHeader>
        <CardTitle>{{ summary?.channelName ?? "Channel metrics" }}</CardTitle>
        <CardDescription>
          Overview of recent delivery health and performance for this channel.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <section class="grid gap-3">
          <header class="flex items-center justify-between text-sm font-medium">
            <span>Success rate</span>
            <span>{{ successPercentage }}%</span>
          </header>
          <Progress :model-value="successPercentage" class="h-1.5" />
          <p class="text-muted-foreground text-xs">
            {{ totalDeliveriesLabel }}
          </p>
        </section>
        <Separator />
        <section class="grid gap-2">
          <header class="flex items-center justify-between text-sm font-medium">
            <span>Average response time</span>
            <Badge variant="secondary">{{ formattedAverage }}</Badge>
          </header>
          <p class="text-muted-foreground text-xs">
            Includes successful and failed deliveries with captured response times.
          </p>
        </section>
        <Separator />
        <section class="grid gap-2">
          <header class="flex items-center justify-between text-sm font-medium">
            <span>Recent errors</span>
            <Badge
              v-if="summary?.failureCount"
              variant="outline"
              class="border-destructive/40 bg-destructive/10 text-destructive"
            >
              {{ failureCountLabel }}
            </Badge>
          </header>
          <template v-if="lastError">
            <p class="text-xs font-medium leading-relaxed">
              {{ lastError.message }}
            </p>
            <p class="text-muted-foreground text-xs">
              {{ formattedErrorTime ?? "Time unknown" }}
              <template v-if="lastError.deliveryId">
                · Delivery {{ lastError.deliveryId }}
              </template>
            </p>
            <p v-if="lastError.code" class="text-muted-foreground text-xs">
              Error code: {{ lastError.code }}
            </p>
          </template>
          <p v-else class="text-muted-foreground text-xs">
            No recent failures detected for this channel.
          </p>
        </section>
      </CardContent>
    </Card>
  </div>
</template>

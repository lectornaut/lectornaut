<script setup lang="ts">
import type { ProjectDelivery } from "@/types"
import { computed } from "vue"

const props = defineProps({
  logs: {
    type: Array as () => ProjectDelivery[],
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: "",
  },
})

const emit = defineEmits<{
  (event: "inspect", payload: ProjectDelivery): void
  (event: "retry", payload: ProjectDelivery): void
}>()

const hasLogs = computed(() => !props.loading && props.logs.length > 0)

const statusBadgeClass: Record<ProjectDelivery["status"], string> = {
  success: "bg-emerald-500/10 text-emerald-500",
  failed: "bg-destructive/10 text-destructive",
  pending: "bg-amber-500/10 text-amber-500",
}

const formatDate = (value: ProjectDelivery["loggedAt"]) => {
  if (!value) return "—"

  if (value instanceof Date) {
    return value.toLocaleString()
  }

  // Firestore Timestamp has toDate
  // @ts-expect-error - runtime check for firebase Timestamp
  if (typeof value.toDate === "function") {
    // @ts-expect-error - firebase Timestamp compatibility
    return value.toDate().toLocaleString()
  }

  return `${value}`
}

const formatDuration = (value: ProjectDelivery["durationMs"]) => {
  if (typeof value !== "number") return "—"
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`
  }

  return `${value} ms`
}

const handleInspect = (delivery: ProjectDelivery) => {
  emit("inspect", delivery)
}

const handleRetry = (delivery: ProjectDelivery) => {
  emit("retry", delivery)
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
    <div v-if="loading" class="p-6 text-sm text-muted-foreground" data-test="log-loading">
      Loading deliveries…
    </div>

    <div
      v-else-if="error"
      class="flex items-center gap-2 border-b border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      data-test="log-error"
      role="alert"
    >
      {{ error }}
    </div>

    <div v-else-if="!hasLogs" class="space-y-2 p-6 text-sm text-muted-foreground" data-test="log-empty">
      <p class="font-medium text-foreground">No deliveries recorded yet</p>
      <p>
        Hook up your first channel to start seeing webhook attempts, responses, and failures in
        real time.
      </p>
    </div>

    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-border text-sm" data-test="log-table">
        <thead class="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">Channel</th>
            <th scope="col" class="px-4 py-3 font-medium">Status</th>
            <th scope="col" class="px-4 py-3 font-medium">Response</th>
            <th scope="col" class="px-4 py-3 font-medium">Duration</th>
            <th scope="col" class="px-4 py-3 font-medium">Logged</th>
            <th scope="col" class="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border bg-card">
          <tr v-for="log in logs" :key="log.id" class="align-top" data-test="log-row">
            <td class="px-4 py-3">
              <div class="flex flex-col gap-1">
                <span class="font-medium text-foreground">{{ log.channelId }}</span>
                <span class="text-xs text-muted-foreground">{{ log.payloadSummary }}</span>
              </div>
            </td>
            <td class="px-4 py-3">
              <span
                class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium"
                :class="statusBadgeClass[log.status]"
                data-test="log-status"
              >
                {{ log.status }}
              </span>
            </td>
            <td class="px-4 py-3">
              <span data-test="log-response">{{ log.responseCode ?? "—" }}</span>
            </td>
            <td class="px-4 py-3">
              <span data-test="log-duration">{{ formatDuration(log.durationMs) }}</span>
            </td>
            <td class="px-4 py-3">
              <span class="whitespace-nowrap" data-test="log-date">{{ formatDate(log.loggedAt) }}</span>
            </td>
            <td class="px-4 py-3">
              <div class="flex justify-end gap-2">
                <button
                  class="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  data-test="log-inspect"
                  @click="handleInspect(log)"
                >
                  Inspect
                </button>
                <button
                  class="inline-flex h-8 items-center justify-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  data-test="log-retry"
                  :disabled="log.status !== 'failed'"
                  :aria-disabled="log.status !== 'failed'"
                  @click="handleRetry(log)"
                >
                  Retry
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

import { projectChannels, projectDeliveryLogs } from "@/data/projectDeliveries"
import type {
  ProjectChannel,
  ProjectChannelSummary,
  ProjectDeliveryLog,
  ProjectDeliveryStatus,
} from "@/types/projects"
import { getFunctions, httpsCallable } from "firebase/functions"
import { defineStore } from "pinia"
import { computed, ref } from "vue"

interface DeliveryActionResult {
  success: boolean
  fallbackMessage?: string
  error?: string
  delivery?: ProjectDeliveryLog
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const parseErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message)
  }
  return "Unexpected error"
}

const cloneChannels = () => projectChannels.map((channel) => ({ ...channel }))
const cloneDeliveries = () => projectDeliveryLogs.map((log) => ({ ...log }))

const statusOrder: Record<ProjectDeliveryStatus, number> = {
  success: 0,
  failed: 1,
  pending: 2,
  processing: 3,
  queued: 4,
  retrying: 5,
  throttled: 6,
  skipped: 7,
}

const callCallable = async (name: string, payload: Record<string, unknown>) => {
  try {
    const callable = httpsCallable(getFunctions(), name)
    await callable(payload)
    return { success: true as const }
  } catch (error) {
    return { success: false as const, error: parseErrorMessage(error) }
  }
}

const calculateAverage = (values: number[]) => {
  if (values.length === 0) return 0
  const total = values.reduce((acc, value) => acc + value, 0)
  return Math.round(total / values.length)
}

const normalizeTimestamp = (value?: string | null) =>
  value ? new Date(value).toISOString() : undefined

export const useProjectDeliveriesStore = defineStore("projectDeliveries", () => {
  const channels = ref<ProjectChannel[]>(cloneChannels())
  const deliveries = ref<ProjectDeliveryLog[]>(cloneDeliveries())

  const statusOptions = computed<ProjectDeliveryStatus[]>(() => {
    const statuses = new Set<ProjectDeliveryStatus>()
    for (const delivery of deliveries.value) {
      statuses.add(delivery.status)
    }
    return Array.from(statuses)
  })

  const getChannelById = (channelId: string) =>
    channels.value.find((channel) => channel.id === channelId)

  const getDeliveriesForChannel = (channelId: string) =>
    deliveries.value
      .filter((delivery) => delivery.channelId === channelId)
      .sort((a, b) => {
        const triggeredDiff =
          new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
        if (triggeredDiff !== 0) return triggeredDiff
        return statusOrder[a.status] - statusOrder[b.status]
      })

  const computeSummary = (channelId: string): ProjectChannelSummary | null => {
    const channel = getChannelById(channelId)
    if (!channel) return null

    const channelDeliveries = getDeliveriesForChannel(channelId)

    const totalDeliveries = channelDeliveries.length
    const successCount = channelDeliveries.filter(
      (delivery) => delivery.status === "success"
    ).length
    const failureCount = channelDeliveries.filter(
      (delivery) => delivery.status === "failed"
    ).length

    const responseValues = channelDeliveries
      .map((delivery) => delivery.responseTimeMs)
      .filter((value): value is number => typeof value === "number" && value > 0)
    const averageResponseMs =
      channel.stats?.avgResponseMs ?? calculateAverage(responseValues)

    const fallbackLastError = channelDeliveries
      .filter((delivery) => delivery.error)
      .sort((a, b) =>
        new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
      )[0]

    const lastError = channel.stats?.lastError
      ? {
          message: channel.stats.lastError.message,
          code: channel.stats.lastError.code,
          occurredAt: normalizeTimestamp(channel.stats.lastError.at),
          deliveryId: channel.stats.lastError.deliveryId,
        }
      : fallbackLastError?.error
        ? {
            ...fallbackLastError.error,
            deliveryId: fallbackLastError.id,
          }
        : undefined

    const successRate = channel.stats?.successRate
      ? channel.stats.successRate
      : totalDeliveries === 0
        ? 0
        : Number((successCount / totalDeliveries).toFixed(3))

    return {
      channelId,
      channelName: channel.name,
      successRate,
      averageResponseMs,
      totalDeliveries,
      successCount,
      failureCount,
      lastError,
    }
  }

  const upsertDelivery = (delivery: ProjectDeliveryLog) => {
    const index = deliveries.value.findIndex(({ id }) => id === delivery.id)
    if (index === -1) {
      deliveries.value = [delivery, ...deliveries.value]
    } else {
      deliveries.value[index] = { ...deliveries.value[index], ...delivery }
    }
  }

  const retryDelivery = async (
    deliveryId: string
  ): Promise<DeliveryActionResult> => {
    const delivery = deliveries.value.find(({ id }) => id === deliveryId)
    if (!delivery) {
      return {
        success: false,
        error: "Delivery was not found",
      }
    }

    const startedAt = Date.now()
    const previousAttempt = { ...delivery }

    upsertDelivery({
      ...delivery,
      status: "processing",
      error: null,
    })

    const callableResult = await callCallable("retryProjectDelivery", {
      channelId: delivery.channelId,
      deliveryId,
    })

    await wait(600)

    const completedAt = new Date()
    const responseTimeMs = Math.max(320, Date.now() - startedAt)

    upsertDelivery({
      ...previousAttempt,
      status: "success",
      attempt: previousAttempt.attempt + 1,
      triggeredAt: new Date(startedAt).toISOString(),
      completedAt: completedAt.toISOString(),
      responseTimeMs,
      error: null,
      responsePayload: {
        acknowledged: true,
        attempt: previousAttempt.attempt + 1,
        simulated: !callableResult.success,
      },
    })

    return {
      success: true,
      fallbackMessage: callableResult.success ? undefined : callableResult.error,
      delivery: deliveries.value.find(({ id }) => id === deliveryId),
    }
  }

  const testChannel = async (
    channelId: string
  ): Promise<DeliveryActionResult> => {
    const channel = getChannelById(channelId)
    if (!channel) {
      return {
        success: false,
        error: "Channel was not found",
      }
    }

    const startedAt = Date.now()

    const callableResult = await callCallable("testProjectChannel", {
      channelId,
    })

    await wait(500)

    const triggeredAt = new Date(startedAt)
    const completedAt = new Date()

    const delivery: ProjectDeliveryLog = {
      id: `test-${channelId}-${startedAt}`,
      channelId,
      status: "success",
      attempt: 1,
      destination: channel.target ?? channel.name,
      triggeredAt: triggeredAt.toISOString(),
      completedAt: completedAt.toISOString(),
      responseTimeMs: Math.max(260, Date.now() - startedAt),
      requestPayload: {
        event: "test.triggered",
        initiatedBy: "ui",
      },
      transformedPayload: {
        channelId,
        mode: "test",
      },
      responsePayload: {
        acknowledged: true,
        simulated: !callableResult.success,
      },
      error: null,
      test: true,
    }

    deliveries.value = [delivery, ...deliveries.value]

    return {
      success: true,
      fallbackMessage: callableResult.success ? undefined : callableResult.error,
      delivery,
    }
  }

  return {
    channels,
    deliveries,
    statusOptions,
    getChannelById,
    getDeliveriesForChannel,
    getChannelSummary: computeSummary,
    retryDelivery,
    testChannel,
  }
})

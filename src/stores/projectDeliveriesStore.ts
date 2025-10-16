import { firestore } from "@/modules/firebase"
import type {
  ProjectDelivery,
  ProjectDeliveryStats,
  ProjectDeliveryStatus,
} from "@/types"
import {
  collection,
  limit,
  orderBy,
  query,
  type CollectionReference,
  type Query,
} from "firebase/firestore"
import { defineStore, storeToRefs } from "pinia"
import { computed, reactive, ref, shallowRef, watch } from "vue"
import { useCollection, useCurrentUser } from "vuefire"

import { useProjectChannelsStore } from "./projectChannelsStore"

const DELIVERIES_SSR_KEY = "projects:deliveries"
const MAX_STREAMED_DELIVERIES = 500

const createDeliveriesKey = (
  uid: string,
  projectId: string,
  channelId: string
) => `${uid}::${projectId}::${channelId}`

export const useProjectDeliveriesStore = defineStore(
  "projectDeliveries",
  () => {
    const user = useCurrentUser()
    const channelsStore = useProjectChannelsStore()
    const { activeProjectId, selectedChannelId } = storeToRefs(channelsStore)

    const filters = reactive({
      statuses: [] as ProjectDeliveryStatus[],
      responseCodes: [] as number[],
      search: "",
      startDate: null as Date | null,
      endDate: null as Date | null,
    })

    const page = ref(1)
    const pageSize = ref(25)
    const aggregatedStats = ref<ProjectDeliveryStats | null>(null)

    const collectionsCache = shallowRef(
      new Map<string, CollectionReference<ProjectDelivery>>()
    )
    const queryCache = shallowRef(new Map<string, Query<ProjectDelivery>>())

    const resetCaches = () => {
      collectionsCache.value.clear()
      queryCache.value.clear()
    }

    watch(
      () => user.value?.uid,
      () => {
        page.value = 1
        aggregatedStats.value = null
        resetCaches()
      }
    )

    watch(
      () => [activeProjectId.value, selectedChannelId.value],
      () => {
        page.value = 1
        aggregatedStats.value = null
      }
    )

    const resolveCollection = (
      projectId: string,
      channelId: string
    ): CollectionReference<ProjectDelivery> | null => {
      if (!user.value) return null

      const key = createDeliveriesKey(user.value.uid, projectId, channelId)
      const cached = collectionsCache.value.get(key)
      if (cached) return cached

      const collectionRef = collection(
        firestore,
        "users",
        user.value.uid,
        "projects",
        projectId,
        "channels",
        channelId,
        "deliveries"
      ) as CollectionReference<ProjectDelivery>

      collectionsCache.value.set(key, collectionRef)
      return collectionRef
    }

    const resolveQuery = (
      projectId: string,
      channelId: string
    ): Query<ProjectDelivery> | null => {
      if (!user.value) return null

      const key = `${createDeliveriesKey(user.value.uid, projectId, channelId)}::default`
      const cached = queryCache.value.get(key)
      if (cached) return cached

      const collectionRef = resolveCollection(projectId, channelId)
      if (!collectionRef) return null

      const deliveriesQuery = query(
        collectionRef,
        orderBy("createdAt", "desc"),
        limit(MAX_STREAMED_DELIVERIES)
      )

      queryCache.value.set(key, deliveriesQuery)
      return deliveriesQuery
    }

    const deliveriesSource = useCollection<ProjectDelivery>(
      computed(() => {
        if (!user.value) return null
        const projectId = activeProjectId.value
        const channelId = selectedChannelId.value
        if (!projectId || !channelId) return null
        return resolveQuery(projectId, channelId)
      }),
      {
        wait: true,
        ssrKey: DELIVERIES_SSR_KEY,
      }
    )

    const deliveries = computed(() => deliveriesSource.value ?? [])
    const isLoading = computed(() => deliveriesSource.pending.value)

    const resetPage = () => {
      page.value = 1
    }

    watch(filters, resetPage, { deep: true })

    const filteredDeliveries = computed(() => {
      const list = deliveries.value

      if (!list.length) return []

      const statuses = filters.statuses
      const responseCodes = filters.responseCodes
      const hasStatuses = statuses.length > 0
      const hasResponseCodes = responseCodes.length > 0
      const search = filters.search.trim().toLowerCase()
      const start = filters.startDate ? filters.startDate.getTime() : null
      const end = filters.endDate ? filters.endDate.getTime() : null

      return list.filter((delivery) => {
        if (hasStatuses && !statuses.includes(delivery.status)) return false

        if (hasResponseCodes) {
          if (typeof delivery.responseCode !== "number") return false
          if (!responseCodes.includes(delivery.responseCode)) return false
        }

        if (start && delivery.createdAt.toMillis() < start) return false
        if (end && delivery.createdAt.toMillis() > end) return false

        if (search) {
          const haystack = [
            delivery.id,
            delivery.status,
            delivery.summary,
            delivery.errorMessage,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()

          if (!haystack.includes(search)) return false
        }

        return true
      })
    })

    const totalPages = computed(() => {
      const total = filteredDeliveries.value.length
      if (!total) return 1
      return Math.max(1, Math.ceil(total / pageSize.value))
    })

    watch(
      [filteredDeliveries, pageSize],
      () => {
        if (page.value > totalPages.value) {
          page.value = totalPages.value
        }
      },
      { immediate: true }
    )

    const paginatedDeliveries = computed(() => {
      const start = (page.value - 1) * pageSize.value
      const end = start + pageSize.value
      return filteredDeliveries.value.slice(start, end)
    })

    const hasNextPage = computed(() => page.value < totalPages.value)
    const hasPreviousPage = computed(() => page.value > 1)

    const nextPage = () => {
      if (hasNextPage.value) page.value += 1
    }

    const previousPage = () => {
      if (hasPreviousPage.value) page.value -= 1
    }

    const derivedStats = computed<ProjectDeliveryStats>(() => {
      if (aggregatedStats.value) return aggregatedStats.value

      const list = deliveries.value

      let success = 0
      let failed = 0
      let pending = 0
      let durationSum = 0
      let durationCount = 0
      let lastFailure: ProjectDelivery["createdAt"] | null = null

      for (const delivery of list) {
        switch (delivery.status) {
          case "success":
            success += 1
            break
          case "failed": {
            failed += 1
            const timestamp = delivery.createdAt
            if (
              timestamp &&
              (!lastFailure || timestamp.toMillis() > lastFailure.toMillis())
            ) {
              lastFailure = timestamp
            }
            break
          }
          case "pending":
          case "processing":
            pending += 1
            break
          default:
            pending += 1
        }

        if (
          typeof delivery.durationMs === "number" &&
          Number.isFinite(delivery.durationMs)
        ) {
          durationSum += delivery.durationMs
          durationCount += 1
        }
      }

      const total = list.length
      const successRate = total ? success / total : 0
      const averageDurationMs =
        durationCount > 0 ? Math.round(durationSum / durationCount) : null

      return {
        total,
        success,
        failed,
        pending,
        successRate,
        averageDurationMs,
        lastFailureAt: lastFailure ?? null,
      }
    })

    const setAggregatedStats = (stats: ProjectDeliveryStats | null) => {
      aggregatedStats.value = stats
    }

    const resetFilters = () => {
      filters.statuses = []
      filters.responseCodes = []
      filters.search = ""
      filters.startDate = null
      filters.endDate = null
    }

    return {
      filters,
      page,
      pageSize,
      deliveries,
      filteredDeliveries,
      paginatedDeliveries,
      totalPages,
      hasNextPage,
      hasPreviousPage,
      nextPage,
      previousPage,
      resetPage,
      resetFilters,
      isLoading,
      derivedStats,
      aggregatedStats,
      setAggregatedStats,
    }
  }
)

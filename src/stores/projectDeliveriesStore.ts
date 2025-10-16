import type { ProjectDelivery, ProjectDeliveryStatus } from "@/types"
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore"
import { defineStore } from "pinia"
import { computed, ref } from "vue"
import { useCollection, useFirestore } from "vuefire"

const DEFAULT_LOG_BASE = "https://hooks.lectornaut.dev/deliveries"

type DeliveryInput = {
  channelId: string
  payloadSummary: string
  status?: ProjectDeliveryStatus
  responseCode?: number | null
  durationMs?: number | null
  error?: string | null
}

type DeliveryUpdate = Partial<
  Pick<
    ProjectDelivery,
    | "status"
    | "responseCode"
    | "durationMs"
    | "error"
    | "payloadSummary"
    | "loggedAt"
  >
>

const getTimestampValue = (value: ProjectDelivery["loggedAt"]) => {
  if (!value) return 0
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  // Firestore Timestamp has a toMillis method
  // @ts-expect-error - runtime check for firebase Timestamp
  if (typeof value.toMillis === "function") {
    // @ts-expect-error - Firebase Timestamp compatibility
    return value.toMillis()
  }
  return Number(value) || 0
}

export const useProjectDeliveriesStore = defineStore("project-deliveries", () => {
  const db = useFirestore()
  const collectionRef = collection(db, "projectDeliveries")
  const documents = useCollection<ProjectDelivery>(collectionRef)
  const projectId = ref<string | null>(null)
  const channelFilter = ref<string | null>(null)

  const logBase = computed(
    () => import.meta.env.VITE_PROJECTS_LOG_BASE_URL ?? DEFAULT_LOG_BASE
  )

  const deliveries = computed(() => {
    let items = documents.value ?? []

    if (projectId.value) {
      items = items.filter((delivery) => delivery.projectId === projectId.value)
    }

    if (channelFilter.value) {
      items = items.filter((delivery) => delivery.channelId === channelFilter.value)
    }

    return [...items].sort((a, b) => getTimestampValue(b.loggedAt) - getTimestampValue(a.loggedAt))
  })

  const stats = computed(() => {
    const total = deliveries.value.length
    const success = deliveries.value.filter((item) => item.status === "success").length
    const failed = deliveries.value.filter((item) => item.status === "failed").length
    const pending = deliveries.value.filter((item) => item.status === "pending").length

    const durations = deliveries.value
      .map((item) => item.durationMs ?? null)
      .filter((value): value is number => typeof value === "number")

    const averageDuration =
      durations.length === 0
        ? null
        : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)

    const successRate = total === 0 ? 1 : success / total

    return {
      total,
      success,
      failed,
      pending,
      successRate,
      averageDuration,
    }
  })

  const setProjectId = (id: string | null) => {
    projectId.value = id
  }

  const filterByChannel = (id: string | null) => {
    channelFilter.value = id
  }

  const deliveryLogUrl = (deliveryId: string) => {
    if (!projectId.value) {
      throw new Error("A project must be selected before generating URLs")
    }

    const sanitizedBase = logBase.value.replace(/\/$/, "")
    return `${sanitizedBase}/${projectId.value}/deliveries/${deliveryId}`
  }

  const createDelivery = async (input: DeliveryInput) => {
    if (!projectId.value) {
      throw new Error("A project must be selected before recording deliveries")
    }

    const timestamp = serverTimestamp()

    const docRef = await addDoc(collectionRef, {
      projectId: projectId.value,
      channelId: input.channelId,
      payloadSummary: input.payloadSummary,
      status: input.status ?? "pending",
      responseCode: input.responseCode ?? null,
      durationMs: input.durationMs ?? null,
      error: input.error ?? null,
      loggedAt: timestamp,
    })

    return docRef.id
  }

  const updateDelivery = async (id: string, update: DeliveryUpdate) => {
    const docRef = doc(collectionRef, id)
    await updateDoc(docRef, {
      ...update,
      loggedAt: update.loggedAt ?? serverTimestamp(),
    })
  }

  const deleteDelivery = async (id: string) => {
    const docRef = doc(collectionRef, id)
    await deleteDoc(docRef)
  }

  return {
    projectId,
    channelFilter,
    deliveries,
    stats,
    logBase,
    setProjectId,
    filterByChannel,
    deliveryLogUrl,
    createDelivery,
    updateDelivery,
    deleteDelivery,
  }
})

import type {
  ProjectChannel,
  ProjectChannelStatus,
  ProjectChannelType,
} from "@/types"
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

const DEFAULT_WEBHOOK_BASE = "https://hooks.lectornaut.dev/projects"

type ChannelInput = {
  name: string
  type: ProjectChannelType
  endpoint: string
  secret?: string
  status?: ProjectChannelStatus
}

type ChannelUpdate = Partial<
  Pick<
    ProjectChannel,
    | "name"
    | "type"
    | "endpoint"
    | "secret"
    | "status"
    | "failureCount"
    | "lastDeliveryAt"
  >
>

export const useProjectChannelsStore = defineStore("project-channels", () => {
  const db = useFirestore()
  const collectionRef = collection(db, "projectChannels")
  const documents = useCollection<ProjectChannel>(collectionRef)
  const projectId = ref<string | null>(null)

  const webhookBase = computed(
    () => import.meta.env.VITE_PROJECTS_WEBHOOK_BASE_URL ?? DEFAULT_WEBHOOK_BASE
  )

  const channels = computed(() => {
    const items = documents.value ?? []

    if (!projectId.value) {
      return items
    }

    return items.filter((channel) => channel.projectId === projectId.value)
  })

  const stats = computed(() => {
    const total = channels.value.length
    const active = channels.value.filter((channel) => channel.status === "active").length
    const paused = channels.value.filter((channel) => channel.status === "paused").length
    const disabled = channels.value.filter((channel) => channel.status === "disabled").length
    const failing = channels.value.filter((channel) => channel.failureCount > 0).length

    const successRate = total === 0 ? 1 : (total - failing) / total

    return {
      total,
      active,
      paused,
      disabled,
      failing,
      successRate,
    }
  })

  const setProjectId = (id: string | null) => {
    projectId.value = id
  }

  const channelWebhookUrl = (channelId: string) => {
    if (!projectId.value) {
      throw new Error("A project must be selected before generating URLs")
    }

    const sanitizedBase = webhookBase.value.replace(/\/$/, "")
    return `${sanitizedBase}/${projectId.value}/channels/${channelId}`
  }

  const createChannel = async (input: ChannelInput) => {
    if (!projectId.value) {
      throw new Error("A project must be selected before creating channels")
    }

    const timestamp = serverTimestamp()
    const status = input.status ?? "active"

    const docRef = await addDoc(collectionRef, {
      name: input.name,
      type: input.type,
      endpoint: input.endpoint,
      secret: input.secret ?? null,
      status,
      projectId: projectId.value,
      failureCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastDeliveryAt: null,
    })

    return docRef.id
  }

  const updateChannel = async (id: string, update: ChannelUpdate) => {
    const docRef = doc(collectionRef, id)
    await updateDoc(docRef, {
      ...update,
      updatedAt: serverTimestamp(),
    })
  }

  const deleteChannel = async (id: string) => {
    const docRef = doc(collectionRef, id)
    await deleteDoc(docRef)
  }

  const recordDelivery = async (id: string, succeeded: boolean, deliveredAt: Date) => {
    const channel = channels.value.find((item) => item.id === id)

    if (!channel) {
      return
    }

    const failureCount = succeeded ? 0 : channel.failureCount + 1

    await updateChannel(id, {
      failureCount,
      lastDeliveryAt: deliveredAt,
      status: succeeded ? channel.status : "paused",
    })
  }

  return {
    projectId,
    channels,
    stats,
    webhookBase,
    setProjectId,
    channelWebhookUrl,
    createChannel,
    updateChannel,
    deleteChannel,
    recordDelivery,
  }
})

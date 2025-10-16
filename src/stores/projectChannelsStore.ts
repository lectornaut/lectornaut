import type { ProjectChannel, ProjectChannelStatus } from "@/types"
import { defineStore } from "pinia"
import { v4 as uuidv4 } from "uuid"
import { computed, ref } from "vue"

export const DEFAULT_CHANNEL_TRANSFORMATION = `export default async function transform(event) {
  // Inspect the inbound event and return the payload
  return event
}
`

const createSecret = () => uuidv4().replace(/-/g, "").slice(0, 32)

const seedChannels = (): ProjectChannel[] => {
  const now = Date.now()
  return [
    {
      id: uuidv4(),
      name: "Marketing Site",
      targetUrl: "https://hooks.lectornaut.io/marketing",
      status: "active",
      secret: createSecret(),
      transformation: DEFAULT_CHANNEL_TRANSFORMATION,
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 14),
      updatedAt: new Date(now - 1000 * 60 * 15),
      lastEventAt: new Date(now - 1000 * 60 * 5),
      totalEvents: 2843,
      successRate: 99,
    },
    {
      id: uuidv4(),
      name: "Product Announcements",
      targetUrl: "https://hooks.lectornaut.io/announcements",
      status: "paused",
      secret: createSecret(),
      transformation: DEFAULT_CHANNEL_TRANSFORMATION,
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 28),
      updatedAt: new Date(now - 1000 * 60 * 60 * 6),
      lastEventAt: new Date(now - 1000 * 60 * 60 * 24),
      totalEvents: 742,
      successRate: 96,
    },
    {
      id: uuidv4(),
      name: "Customer Onboarding",
      targetUrl: "https://hooks.lectornaut.io/onboarding",
      status: "error",
      secret: createSecret(),
      transformation: DEFAULT_CHANNEL_TRANSFORMATION,
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 5),
      updatedAt: new Date(now - 1000 * 60 * 30),
      lastEventAt: new Date(now - 1000 * 60 * 30),
      totalEvents: 128,
      successRate: 82,
    },
  ]
}

export const useProjectChannelsStore = defineStore("projectChannels", () => {
  const channels = ref<ProjectChannel[]>(seedChannels())
  const selectedChannelId = ref<string | null>(channels.value[0]?.id ?? null)

  const sortedChannels = computed(() =>
    [...channels.value].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )
  )

  const activeChannel = computed(
    () =>
      channels.value.find(
        (channel) => channel.id === selectedChannelId.value
      ) ?? null
  )

  const selectChannel = (id: string | null) => {
    selectedChannelId.value = id
  }

  const getChannelById = (id: string) =>
    channels.value.find((channel) => channel.id === id) ?? null

  const createChannel = async (
    payload: Pick<ProjectChannel, "name" | "targetUrl" | "transformation"> & {
      status?: ProjectChannelStatus
    }
  ) => {
    const now = new Date()
    const channel: ProjectChannel = {
      id: uuidv4(),
      name: payload.name.trim(),
      targetUrl: payload.targetUrl.trim(),
      status: payload.status ?? "active",
      secret: createSecret(),
      transformation: payload.transformation,
      createdAt: now,
      updatedAt: now,
      lastEventAt: null,
      totalEvents: 0,
      successRate: 100,
    }

    channels.value = [channel, ...channels.value]
    selectedChannelId.value = channel.id

    return channel
  }

  const updateChannel = async (
    id: string,
    payload: Partial<
      Pick<ProjectChannel, "name" | "targetUrl" | "status" | "transformation">
    >
  ) => {
    const index = channels.value.findIndex((channel) => channel.id === id)
    if (index === -1) {
      throw new Error("Channel not found")
    }

    const current = channels.value[index]
    const updated: ProjectChannel = {
      ...current,
      ...payload,
      name: payload.name?.trim() ?? current.name,
      targetUrl: payload.targetUrl?.trim() ?? current.targetUrl,
      transformation: payload.transformation ?? current.transformation,
      status: payload.status ?? current.status,
      updatedAt: new Date(),
    }

    channels.value.splice(index, 1, updated)

    return updated
  }

  const setChannelStatus = (id: string, status: ProjectChannelStatus) => {
    const channel = channels.value.find((item) => item.id === id)
    if (!channel) {
      throw new Error("Channel not found")
    }

    channel.status = status
    channel.updatedAt = new Date()
  }

  const regenerateSecret = async (id: string) => {
    const channel = channels.value.find((item) => item.id === id)
    if (!channel) {
      throw new Error("Channel not found")
    }

    channel.secret = createSecret()
    channel.updatedAt = new Date()

    return channel.secret
  }

  return {
    channels,
    sortedChannels,
    selectedChannelId,
    selectChannel,
    activeChannel,
    getChannelById,
    createChannel,
    updateChannel,
    setChannelStatus,
    regenerateSecret,
  }
})

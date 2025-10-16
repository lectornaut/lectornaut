import {
  useAddDoc,
  useDeleteDoc,
  useUpdateDoc,
} from "@/composables/useFirestore"
import { firebaseApp, firestore } from "@/modules/firebase"
import type { ProjectChannel, ProjectChannelMutationPayload } from "@/types"
import {
  collection,
  doc,
  orderBy,
  query,
  serverTimestamp,
  type CollectionReference,
  type DocumentReference,
  type Query,
} from "firebase/firestore"
import {
  getFunctions,
  httpsCallable,
  type HttpsCallable,
} from "firebase/functions"
import { defineStore } from "pinia"
import { computed, ref, shallowRef, watch } from "vue"
import { toast } from "vue-sonner"
import { useCollection, useCurrentUser, useDocument } from "vuefire"

interface CreateChannelOptions {
  generateSecret?: boolean
}

interface UpdateChannelOptions {
  rotateSecret?: boolean
}

const CHANNELS_SSR_KEY = "projects:channels"
const CHANNEL_DOCUMENT_SSR_KEY = "projects:channel"
const GENERATE_SECRET_FUNCTION =
  import.meta.env.VITE_PROJECT_CHANNEL_SECRET_FUNCTION ??
  "generateProjectChannelSecret"

const createCollectionKey = (uid: string, projectId: string) =>
  `${uid}::${projectId}`

export const useProjectChannelsStore = defineStore("projectChannels", () => {
  const user = useCurrentUser()

  const activeProjectId = ref<string | null>(null)
  const selectedChannelId = ref<string | null>(null)

  const collectionCache = shallowRef(
    new Map<string, CollectionReference<ProjectChannel>>()
  )
  const queryCache = shallowRef(new Map<string, Query<ProjectChannel>>())

  let generateSecretCallable: HttpsCallable<
    { projectId: string; channelId?: string },
    { secret: string }
  > | null = null

  const resetCaches = () => {
    collectionCache.value.clear()
    queryCache.value.clear()
  }

  watch(
    () => user.value?.uid,
    () => {
      activeProjectId.value = null
      selectedChannelId.value = null
      resetCaches()
    }
  )

  watch(activeProjectId, () => {
    selectedChannelId.value = null
  })

  const resolveProjectId = (projectId?: string | null) =>
    projectId ?? activeProjectId.value

  const ensureCollection = (projectId: string | null | undefined) => {
    if (!user.value || !projectId) return null

    const key = createCollectionKey(user.value.uid, projectId)
    const cached = collectionCache.value.get(key)
    if (cached) return cached

    const ref = collection(
      firestore,
      "users",
      user.value.uid,
      "projects",
      projectId,
      "channels"
    ) as CollectionReference<ProjectChannel>

    collectionCache.value.set(key, ref)
    return ref
  }

  const ensureQuery = (projectId: string) => {
    if (!user.value) return null

    const key = `${createCollectionKey(user.value.uid, projectId)}::default`
    const cached = queryCache.value.get(key)
    if (cached) return cached

    const collectionRef = ensureCollection(projectId)
    if (!collectionRef) return null

    const q = query(collectionRef, orderBy("createdAt", "desc"))
    queryCache.value.set(key, q)
    return q
  }

  const channelsSource = useCollection<ProjectChannel>(
    computed(() => {
      const projectId = resolveProjectId()
      if (!projectId || !user.value) return null
      return ensureQuery(projectId)
    }),
    {
      wait: true,
      ssrKey: CHANNELS_SSR_KEY,
    }
  )

  const channels = computed(() => channelsSource.value ?? [])
  const channelsPending = computed(() => channelsSource.pending.value)

  watch(
    channels,
    (list) => {
      if (!list.length) {
        selectedChannelId.value = null
        return
      }

      if (
        selectedChannelId.value &&
        !list.some((channel) => channel.id === selectedChannelId.value)
      ) {
        selectedChannelId.value = list[0]?.id ?? null
        return
      }

      if (!selectedChannelId.value) {
        selectedChannelId.value = list[0]?.id ?? null
      }
    },
    { immediate: true }
  )

  const selectedChannelSource = useDocument<ProjectChannel>(
    computed(() => {
      if (!user.value) return null
      if (!selectedChannelId.value) return null
      const projectId = resolveProjectId()
      if (!projectId) return null
      return doc(
        firestore,
        "users",
        user.value.uid,
        "projects",
        projectId,
        "channels",
        selectedChannelId.value
      ) as DocumentReference<ProjectChannel>
    }),
    {
      ssrKey: CHANNEL_DOCUMENT_SSR_KEY,
    }
  )

  const selectedChannel = computed(
    () => selectedChannelSource.value ?? undefined
  )
  const selectedChannelPending = computed(
    () => selectedChannelSource.pending.value
  )

  const ensureGenerateSecretCallable = () => {
    if (import.meta.env.SSR) {
      throw new Error("Callable functions cannot be initialised on the server.")
    }

    if (!generateSecretCallable) {
      const region = import.meta.env.VITE_FUNCTIONS_REGION
      const functions = region
        ? getFunctions(firebaseApp, region)
        : getFunctions(firebaseApp)

      generateSecretCallable = httpsCallable<
        { projectId: string; channelId?: string },
        { secret: string }
      >(functions, GENERATE_SECRET_FUNCTION)
    }

    return generateSecretCallable
  }

  const generateSecret = async (
    projectId: string,
    channelId?: string
  ): Promise<string> => {
    try {
      const callable = ensureGenerateSecretCallable()
      const result = await callable({ projectId, channelId })
      const secret = result.data?.secret
      if (typeof secret !== "string" || !secret.length) {
        throw new Error("Missing secret in callable response")
      }
      return secret
    } catch (error) {
      console.error("Error generating channel secret:", error)
      toast.error("Failed to generate a channel secret")
      throw error
    }
  }

  const createChannel = async (
    payload: ProjectChannelMutationPayload,
    options: CreateChannelOptions = {}
  ) => {
    if (!user.value) {
      toast.error("You must be signed in to create a channel")
      return
    }

    const projectId = resolveProjectId(payload.projectId)
    if (!projectId) {
      toast.error("Select a project before creating a channel")
      return
    }

    const collectionRef = ensureCollection(projectId)
    if (!collectionRef) return

    const docPayload: ProjectChannelMutationPayload = {
      ...payload,
      projectId,
      createdAt: payload.createdAt ?? serverTimestamp(),
      updatedAt: payload.updatedAt ?? serverTimestamp(),
    }

    if (options.generateSecret) {
      try {
        docPayload.secret = await generateSecret(projectId)
      } catch {
        return
      }
    }

    await useAddDoc(collectionRef, docPayload as object)
  }

  const updateChannel = async (
    channelId: string,
    updates: Partial<ProjectChannelMutationPayload>,
    options: UpdateChannelOptions = {}
  ) => {
    if (!user.value) {
      toast.error("You must be signed in to update a channel")
      return
    }

    const projectId = resolveProjectId(updates.projectId)
    if (!projectId) {
      toast.error("Select a project before updating a channel")
      return
    }

    const collectionRef = ensureCollection(projectId)
    if (!collectionRef) return

    const current = channels.value.find((channel) => channel.id === channelId)
    if (!current) {
      toast.error("Channel not found")
      return
    }

    const docPayload: Partial<ProjectChannelMutationPayload> = {
      ...updates,
      updatedAt: serverTimestamp(),
    }
    docPayload.projectId = projectId

    if (options.rotateSecret) {
      try {
        docPayload.secret = await generateSecret(projectId, channelId)
      } catch {
        return
      }
    }

    await useUpdateDoc(collectionRef, channelId, docPayload as object, current)
  }

  const deleteChannel = async (channelId: string) => {
    if (!user.value) {
      toast.error("You must be signed in to delete a channel")
      return
    }

    const projectId = resolveProjectId()
    if (!projectId) {
      toast.error("Select a project before deleting a channel")
      return
    }

    const collectionRef = ensureCollection(projectId)
    if (!collectionRef) return

    const current = channels.value.find((channel) => channel.id === channelId)
    if (!current) {
      toast.error("Channel not found")
      return
    }

    await useDeleteDoc(collectionRef, channelId, current)

    if (selectedChannelId.value === channelId) {
      selectedChannelId.value = null
    }
  }

  const rotateSecret = async (channelId: string) => {
    await updateChannel(channelId, {}, { rotateSecret: true })
  }

  const setActiveProject = (projectId: string | null) => {
    activeProjectId.value = projectId
  }

  const setSelectedChannel = (channelId: string | null) => {
    selectedChannelId.value = channelId
  }

  const refresh = async () => {
    await channelsSource.promise.value
  }

  return {
    activeProjectId,
    selectedChannelId,
    channels,
    channelsPending,
    selectedChannel,
    selectedChannelPending,
    setActiveProject,
    setSelectedChannel,
    createChannel,
    updateChannel,
    deleteChannel,
    rotateSecret,
    refresh,
  }
})

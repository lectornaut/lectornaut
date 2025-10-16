import {
  collection,
  doc,
  orderBy,
  query,
  where,
  type CollectionReference,
  type DocumentReference,
  type FirestoreDataConverter,
  type Query,
} from "firebase/firestore"
import { useFirestore } from "vuefire"

import type { Channel, ChannelLog, ChannelStats } from "@/types"
import {
  FIRESTORE_CHANNELS_COLLECTION,
  FIRESTORE_CHANNEL_LOGS_COLLECTION,
  FIRESTORE_PROJECTS_COLLECTION,
} from "@/types"

export const channelConverter: FirestoreDataConverter<Channel> = {
  toFirestore(channel) {
    const { id, stats, ...rest } = channel

    return {
      ...rest,
      stats: {
        totalLogs: stats.totalLogs,
        totalTokens: stats.totalTokens,
        lastLogAt: stats.lastLogAt,
        lastErrorAt: stats.lastErrorAt,
      },
    }
  },
  fromFirestore(snapshot, options) {
    const data = snapshot.data(options) as Omit<Channel, "id" | "stats"> & {
      stats?: Partial<ChannelStats>
    }

    return {
      id: snapshot.id,
      ...data,
      stats: {
        totalLogs: data.stats?.totalLogs ?? 0,
        totalTokens: data.stats?.totalTokens ?? 0,
        lastLogAt: data.stats?.lastLogAt ?? null,
        lastErrorAt: data.stats?.lastErrorAt ?? null,
      },
    }
  },
}

export const channelLogConverter: FirestoreDataConverter<ChannelLog> = {
  toFirestore(log) {
    const { id, ...rest } = log
    return rest
  },
  fromFirestore(snapshot, options) {
    const data = snapshot.data(options) as Omit<ChannelLog, "id">

    return {
      id: snapshot.id,
      ...data,
      input: data.input ?? null,
      output: data.output ?? null,
    }
  },
}

export const projectsCollection = () =>
  collection(useFirestore(), FIRESTORE_PROJECTS_COLLECTION)

export const channelsCollection = (): CollectionReference<Channel> =>
  collection(useFirestore(), FIRESTORE_CHANNELS_COLLECTION).withConverter(
    channelConverter
  )

export const channelDocument = (
  channelId: string
): DocumentReference<Channel> => doc(channelsCollection(), channelId)

export const channelLogsCollection = (
  channelId: string
): CollectionReference<ChannelLog> =>
  collection(
    channelDocument(channelId),
    FIRESTORE_CHANNEL_LOGS_COLLECTION
  ).withConverter(channelLogConverter)

export const channelLogsQuery = (channelId: string): Query<ChannelLog> =>
  query(channelLogsCollection(channelId), orderBy("createdAt", "desc"))

export const channelsByOwnerQuery = (ownerId: string): Query<Channel> =>
  query(
    channelsCollection(),
    where("ownerId", "==", ownerId),
    orderBy("createdAt", "desc")
  )

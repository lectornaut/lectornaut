/**
 * Notification Settings Store
 * ===========================
 *
 * Owns the per-user notification preferences — channel toggles (email/in-app/
 * native), category opt-ins (communication/marketing), and delivery frequency.
 * Backed by the per-user `users/{uid}/settings/notifications` document.
 *
 * Unlike the other settings concerns, this one is **cache-authoritative, not
 * localStorage-backed**: `notificationSettings` reads straight from the realtime
 * TanStack cache (`useDocumentQuery` → `normalizeNotificationSettings`), and a
 * toggle applies its optimistic value into that cache via the shared `useRunWrite`
 * seam — held until the server ack reconciles it, rolled back on failure. A
 * single-flight `isUpdatingNotifications` guard serializes toggles.
 *
 * Also owns `sendTestNotification`, which fires a server-side test through the
 * callable and, for the native channel on Tauri, additionally requests OS
 * permission and posts a local desktop notification.
 *
 * Distinct from `useNotifications` (the in-app notification *feed*): this store
 * is the *settings*. Extracted from the former `settingsStore` monolith as
 * phase 2 of its split; its sole consumer is `SettingsNotifications.vue`.
 */

import { sendTestNotification as sendTestNotificationCallable } from "@/composables/useFunctions"
import { isTauri } from "@/composables/usePlatform"
import { firestore } from "@/modules/firebase"
import { queryClient } from "@/modules/queryClient"
import {
  areNotificationSettingsEqual,
  cloneNotificationSettings,
  normalizeNotificationFrequency,
  normalizeNotificationSettings,
  type NotificationFrequency,
  type UserNotificationSettings,
} from "@/types/notifications"
import { getErrorMessage } from "@/utils/firebase/firebase-errors"
import { useRunWrite } from "@/utils/firebase/firebase-mutation"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { queryKeys } from "@/utils/firebase/firebase-query-keys"
import { mutateSetDocument } from "@/utils/firebase/firebase-sync-engine"
import { convertFileSrc } from "@tauri-apps/api/core"
import { resolveResource } from "@tauri-apps/api/path"
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as sendNativeNotification,
} from "@tauri-apps/plugin-notification"
import { doc } from "firebase/firestore"
import { defineStore } from "pinia"
import { toast } from "vue-sonner"
import { useCurrentUser } from "vuefire"

export const useNotificationSettingsStore = defineStore(
  "notificationSettings",
  () => {
    const user = useCurrentUser()

    const notificationSettingsDocRef = computed(() => {
      if (!user.value?.uid) return null
      return doc(
        firestore,
        "users",
        user.value.uid,
        "settings",
        "notifications"
      )
    })

    const { data: notificationSettingsDoc, isLoading: notificationPending } =
      useDocumentQuery(notificationSettingsDocRef)

    const isUpdatingNotifications = ref<string | null>(null)

    // Reads straight from the realtime cache; the toggle below applies its
    // optimistic value into that cache (held until the server ack reconciles it),
    // which replaces the former optimistic-ref + reconcile-clear watch.
    const notificationSettings = computed(() =>
      normalizeNotificationSettings(notificationSettingsDoc.value)
    )

    const runWrite = useRunWrite("settings.notifications")

    async function persistNotificationSettings(
      key: string,
      updater: (current: UserNotificationSettings) => UserNotificationSettings,
      messages: {
        success: string
        error: string
      }
    ): Promise<boolean> {
      const docRef = notificationSettingsDocRef.value
      if (!docRef || isUpdatingNotifications.value !== null) {
        return false
      }

      const previous = cloneNotificationSettings(notificationSettings.value)
      const next = updater(previous)

      if (areNotificationSettingsEqual(previous, next)) {
        return true
      }

      const cacheKey = queryKeys.doc(docRef.path)
      const previousCache =
        queryClient.getQueryData<Record<string, unknown>>(cacheKey)
      isUpdatingNotifications.value = key

      try {
        await runWrite({
          keys: [cacheKey],
          apply: () =>
            queryClient.setQueryData(
              cacheKey,
              next as unknown as Record<string, unknown>
            ),
          rollback: () => queryClient.setQueryData(cacheKey, previousCache),
          fn: async () => {
            await mutateSetDocument(
              docRef,
              next as unknown as Record<string, unknown>,
              {
                source: "settings.notifications.persist",
                merge: true,
              }
            )
          },
        })
        toast.success(messages.success)
        return true
      } catch (error) {
        toast.error(messages.error, {
          description: getErrorMessage(error),
        })
        return false
      } finally {
        isUpdatingNotifications.value = null
      }
    }

    async function updateNotificationCategory(
      category: "communication" | "marketing",
      value: boolean
    ): Promise<boolean> {
      return persistNotificationSettings(
        category,
        (current) => ({
          ...current,
          categories: {
            ...current.categories,
            [category]: value,
          },
        }),
        {
          success: "Notification category updated",
          error: "Failed to update notification category",
        }
      )
    }

    async function updateNotificationFrequency(
      value: unknown
    ): Promise<boolean> {
      if (typeof value !== "string") return false
      const frequency: NotificationFrequency =
        normalizeNotificationFrequency(value)

      return persistNotificationSettings(
        "frequency",
        (current) => ({
          ...current,
          frequency,
        }),
        {
          success: "Notification frequency updated",
          error: "Failed to update notification frequency",
        }
      )
    }

    async function updateNotificationChannel(
      channel: "email" | "inApp" | "native",
      value: boolean
    ): Promise<boolean> {
      return persistNotificationSettings(
        channel,
        (current) => ({
          ...current,
          channels: {
            ...current.channels,
            [channel]: value,
          },
        }),
        {
          success: "Notification channel updated",
          error: "Failed to update notification channel",
        }
      )
    }

    const isSendingTestNotification = ref<"email" | "inApp" | "native" | null>(
      null
    )

    async function sendTestNotification(
      channel: "email" | "inApp" | "native"
    ): Promise<boolean> {
      if (isSendingTestNotification.value) return false

      isSendingTestNotification.value = channel

      try {
        await sendTestNotificationCallable({ channel })

        if (channel === "native" && isTauri.value) {
          let granted = await isPermissionGranted()
          if (!granted) {
            const permission = await requestPermission()
            granted = permission === "granted"
          }

          if (granted) {
            let iconPath: string | undefined
            try {
              iconPath = await resolveResource("icons/icon.png")
            } catch {
              // Resource not available in dev mode
            }

            sendNativeNotification({
              title: "Test notification",
              body: "This is a test desktop notification. Everything is working!",
              sound: "default",
              ...(iconPath && {
                icon: iconPath,
                attachments: [
                  {
                    id: "icon",
                    url: convertFileSrc(iconPath),
                  },
                ],
              }),
            })
          } else {
            toast.error("Desktop notification permission denied")
            return false
          }
        }

        toast.success("Test notification sent")
        return true
      } catch (error) {
        toast.error("Failed to send test notification", {
          description: getErrorMessage(error),
        })
        return false
      } finally {
        isSendingTestNotification.value = null
      }
    }

    const isNotificationLoading = computed(() => notificationPending.value)

    return {
      notificationSettings,
      isUpdatingNotifications,
      isNotificationLoading,
      updateNotificationCategory,
      updateNotificationFrequency,
      updateNotificationChannel,
      sendTestNotification,
      isSendingTestNotification,
    }
  }
)

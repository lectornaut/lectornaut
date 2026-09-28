import { isMainTauriWindow, isTauri } from "@/composables/usePlatform"
import { firestore } from "@/modules/firebase"
import { invoke } from "@tauri-apps/api/core"
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore"
import { useCurrentUser } from "vuefire"

// Don't replay alerts that piled up while the app was closed for longer.
const MAX_REPLAY_AGE_MS = 60 * 60 * 1000
// Beyond this many at once, collapse into a single summary alert.
const MAX_BURST = 3
const PAGE_SIZE = 20

const seenAtKey = (uid: string) => `nativeNotificationsSeenAt:${uid}`

async function showNativeNotification(
  title: string,
  body: string
): Promise<void> {
  // The plugin's JS `sendNotification` goes through `window.Notification`,
  // which WKWebView may keep as its own no-op impl; call Rust directly.
  await invoke("plugin:notification|notify", {
    options: { title, body, sound: "Glass" },
  })
}

/**
 * Turns the server-written `users/{uid}/nativeNotifications` feed into OS
 * notifications. The server already applied category, frequency and channel
 * preferences, so every new doc is shown. Runs only in the main desktop
 * window so multiple windows never duplicate an alert.
 */
export function useNativeNotificationDelivery() {
  if (!isTauri.value || !isMainTauriWindow.value) return

  const user = useCurrentUser()

  watch(
    () => user.value?.uid,
    (uid, _previous, onCleanup) => {
      if (!uid) return

      const key = seenAtKey(uid)
      const now = Date.now()
      const stored = Number(localStorage.getItem(key)) || 0
      let seenAt = stored ? Math.max(stored, now - MAX_REPLAY_AGE_MS) : now
      if (!stored) localStorage.setItem(key, String(seenAt))

      const feed = query(
        collection(firestore, "users", uid, "nativeNotifications"),
        where("createdAt", ">", Timestamp.fromMillis(seenAt)),
        orderBy("createdAt", "desc"),
        limit(PAGE_SIZE)
      )

      const unsubscribe = onSnapshot(
        feed,
        (snapshot) => {
          const fresh = snapshot
            .docChanges()
            .filter((change) => change.type === "added")
            .map((change) => change.doc.data())
            .map((data) => ({
              title: typeof data.title === "string" ? data.title : "",
              body:
                typeof data.description === "string" ? data.description : "",
              createdAt:
                data.createdAt instanceof Timestamp
                  ? data.createdAt.toMillis()
                  : 0,
            }))
            .filter((item) => item.title && item.createdAt > seenAt)
            .sort((a, b) => a.createdAt - b.createdAt)

          if (fresh.length === 0) return

          seenAt = fresh[fresh.length - 1].createdAt
          localStorage.setItem(key, String(seenAt))

          const alerts =
            fresh.length > MAX_BURST
              ? [
                  {
                    title: `${fresh.length} new notifications`,
                    body: fresh
                      .slice(-MAX_BURST)
                      .map((item) => item.title)
                      .join(" · "),
                  },
                ]
              : fresh

          for (const alert of alerts) {
            showNativeNotification(alert.title, alert.body).catch((error) =>
              console.error("Failed to show native notification:", error)
            )
          }
        },
        (error) => console.error("Native notification feed failed:", error)
      )

      onCleanup(unsubscribe)
    },
    { immediate: true }
  )
}

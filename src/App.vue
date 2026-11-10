<script lang="ts" setup>
import { useCloseConfirmation } from "@/composables/useCloseConfirmation"
import { resumeSessionWatcher } from "@/composables/useDeviceSessions"
import { useDialogActionHotkey } from "@/composables/useDialogActionHotkey"
import { useGlobalHotkeys } from "@/composables/useGlobalHotkeys"
import { useGlobalHotkeySequences } from "@/composables/useGlobalHotkeySequences"
import { useMenuActionHotkey } from "@/composables/useMenuActionHotkey"
import { useNativeNotificationDelivery } from "@/composables/useNativeNotificationDelivery"
import { useTabRouterSync } from "@/composables/useTabRouterSync"
import { useCurrentUser } from "vuefire"

const user = useCurrentUser()
const router = useRouter()
const route = useRoute()

// Register all global application hotkeys for the app's lifetime.
useGlobalHotkeys()

// Register Vim/Linear-style multi-key sequences: "G" then a page letter to go
// to a destination, "C" then a letter to create. Surfaced in the ⌘K palette.
useGlobalHotkeySequences()

// Enter fires the proceed button ([data-dialog-action], or shadcn's
// AlertDialogAction) of whichever dialog the keystroke originates in.
useDialogActionHotkey()

// Bare keys fire the [data-hotkey] item of whichever open menu the
// keystroke originates in (the menu-item counterpart of the above).
useMenuActionHotkey()

// Confirm before a keyboard shortcut (desktop) or a browser tab close with
// work in flight (web) ends the app; see the composable for exact paths.
useCloseConfirmation()

// Desktop main window only: surface server-routed alerts as OS notifications.
useNativeNotificationDelivery()

// Route ⇄ tab-strip sync. Here, not in Tabbar: Tabbar remounts on every layout
// change, and the sync's state has to outlive that.
useTabRouterSync()

// Only handle redirecting logged-in users away from guest-only pages.
// Logout redirects are NOT handled here - the router beforeEach guard
// handles protecting routes that require authentication.
watch(
  user,
  async (currentUser, oldUser) => {
    // Resume session watcher on page load for already-authenticated users
    if (currentUser && !oldUser) {
      resumeSessionWatcher(currentUser.uid)
    }

    // Handle authenticated user landing on guest-only routes (e.g., /enter)
    if (currentUser && route.meta.requiresGuest === true) {
      const redirect =
        typeof route.query?.redirect === "string"
          ? route.query.redirect
          : "/start"
      await router.push(redirect)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex size-full">
    <RouterView />
    <Actions />
  </div>
</template>

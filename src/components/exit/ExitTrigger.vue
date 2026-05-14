<script lang="ts" setup>
import { logout } from "@/modules/auth"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()

const openExit = ref(false)

const handleLogout = async () => {
  await logout()
}

emitter.on("Dialog.Exit.Open", () => {
  openExit.value = !openExit.value
})
</script>

<template>
  <AlertDialog v-model:open="openExit">
    <AlertDialogContent class="w-sm max-w-fit">
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("pages.exit.dialog.title") }}
        </AlertDialogTitle>
        <AlertDialogDescription class="text-xs">
          {{ t("pages.exit.dialog.description") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>
          {{ t("actions.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction @click="handleLogout()">
          {{ t("pages.exit.dialog.logout") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script lang="ts" setup>
import { logoutRevoked } from "@/modules/auth"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()
const open = ref(false)

async function handleLogout() {
  open.value = false
  await logoutRevoked()
}

onMounted(() => {
  emitter.on("session:revoked", () => {
    open.value = true
  })
})

onUnmounted(() => {
  emitter.off("session:revoked")
})
</script>

<template>
  <AlertDialog :open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("settings.account.devices.revokedTitle") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("settings.account.devices.revokedDescription") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction @click="handleLogout">
          {{ t("settings.account.devices.revokedAction") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script lang="ts" setup>
import { useKeychain } from "@/composables/useKeychain"
import { logout } from "@/modules/auth"
import { emitter } from "@/modules/mitt"
import { useAuthStore } from "@/stores/authStore"

const { t } = useI18n()
const { currentUser } = useAuthStore()
const { hasAccount } = useKeychain()

const openExit = ref(false)
const removeKeychainProfile = ref(false)

const currentUserInKeychain = computed(
  () => currentUser && hasAccount(currentUser.uid)
)

const handleLogout = async () => {
  await logout(removeKeychainProfile.value)
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
      <FieldLabel v-if="currentUserInKeychain" for="remove-keychain-profile">
        <Field orientation="horizontal">
          <Checkbox
            id="remove-keychain-profile"
            v-model="removeKeychainProfile"
          />
          <FieldLabel for="remove-keychain-profile">
            {{ t("pages.exit.dialog.removeKeychainProfile") }}
          </FieldLabel>
        </Field>
      </FieldLabel>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("actions.cancel") }}</AlertDialogCancel>
        <AlertDialogAction @click="handleLogout()">
          {{ t("pages.exit.dialog.logout") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { logout } from "@/modules/auth"
import emitter from "@/modules/mitt"

const openExit = ref(false)

emitter.on("Dialog.Exit.Open", () => {
  openExit.value = !openExit.value
})
</script>

<template>
  <AlertDialog v-model:open="openExit">
    <AlertDialogContent class="w-sm max-w-fit">
      <AlertDialogHeader>
        <AlertDialogTitle> Are you sure you want to logout? </AlertDialogTitle>
        <AlertDialogDescription>
          You will be redirected to the login page.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction @click="logout()"> Logout </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { logout } from "@/modules/auth"
import emitter from "@/modules/mitt"

const router = useRouter()
const openExit = ref(false)

const logoutUser = async () => {
  await logout().then(async () => {
    await router.push("/")
  })
}

emitter.on("Dialog.Exit.Open", () => {
  openExit.value = !openExit.value
})
</script>

<template>
  <AlertDialog :open="openExit" @update:open="openExit = false">
    <AlertDialogTrigger as-child><slot /></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle> Are you sure you want to logout? </AlertDialogTitle>
        <AlertDialogDescription>
          You will be redirected to the login page.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction @click="logoutUser"> Logout </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

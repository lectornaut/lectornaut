<script setup lang="ts">
import { logout } from "@/modules/auth"

const router = useRouter()

const logoutUser = async () => {
  await logout().then(async () => {
    await router.push("/")
  })
}
</script>

<template>
  <AlertDialog>
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

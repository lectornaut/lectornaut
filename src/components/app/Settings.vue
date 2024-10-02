<script setup lang="ts">
import { themes } from "@/helpers/defaults"
import emitter from "@/modules/mitt"
import { store } from "@/modules/theme"
import {
  deleteUser,
  sendEmailVerification,
  verifyBeforeUpdateEmail,
} from "firebase/auth"
import { toast } from "vue-sonner"
import { updateCurrentUserProfile, useCurrentUser } from "vuefire"

const openSettings = ref(false)
const defaultTab = ref("account")

emitter.on("Dialog.Settings.Open", (event: unknown) => {
  const selected = event as string
  defaultTab.value = selected
  openSettings.value = !openSettings.value
})

const user = useCurrentUser()

const displayName = computed({
  get: () => user.value?.displayName ?? "",
  set: (value: string) => {
    updateCurrentUserProfile({ displayName: value })
  },
})

const sendingVerificationEmail = ref(false)
const sendVerificationEmail = async () => {
  sendingVerificationEmail.value = true

  await sendEmailVerification(user.value!)
    .then(() => {
      toast.info("Verification email sent", {
        description: "Please check your inbox for the verification email.",
      })
    })
    .catch((error) => {
      toast.error("Failed to send verification email", {
        description: error.message,
      })
    })
    .finally(() => {
      sendingVerificationEmail.value = false
    })
}

const newEmail = ref("")
const changingEmail = ref(false)
const changeEmail = async () => {
  changingEmail.value = true

  await verifyBeforeUpdateEmail(user.value!, newEmail.value)
    .then(() => {
      toast.info("Verification email sent", {
        description: "Please check your inbox for the verification email.",
      })
    })
    .catch((error) => {
      toast.error("Failed to send verification email", {
        description: error.message,
      })
    })
    .finally(() => {
      changingEmail.value = false
    })
}

const deleteAccount = async () => {
  await deleteUser(user.value!)
    .then(() => {
      toast.success("Account deleted", {
        description: "Your account has been successfully deleted.",
      })
    })
    .catch((error) => {
      toast.error("Failed to delete account", {
        description: error.message,
      })
    })
}
</script>

<template>
  <Dialog :open="openSettings" @update:open="openSettings = false">
    <DialogContent
      class="h-[-webkit-fill-available] max-w-4xl overflow-clip p-0"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Manage your preferences and settings.
        </DialogDescription>
      </DialogHeader>
      <Tabs
        :default-value="defaultTab"
        orientation="vertical"
        class="relative grid h-full w-full grid-cols-5 overflow-auto"
      >
        <TabsList
          class="sticky top-0 col-span-1 grid grid-cols-1 content-start rounded-none"
        >
          <TabsTrigger class="justify-start" value="account">
            <div class="flex items-center justify-start gap-2">
              <icon-lucide-circle-user />
              Account
            </div>
          </TabsTrigger>
          <TabsTrigger class="justify-start" value="appearance">
            <div class="flex items-center justify-start gap-2">
              <icon-lucide-palette />
              Appearance
            </div>
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="account"
          class="col-span-4 mt-0 transition duration-300 animate-in fade-in"
        >
          <div class="flex h-full w-full flex-col gap-4 px-8 py-6">
            <div class="flex flex-col">
              <h3 class="text-lg font-semibold">Account</h3>
              <p class="text-muted-foreground">Manage your account settings.</p>
            </div>
            <Separator />
            <div class="flex items-center gap-4">
              <Avatar class="h-16 w-16">
                <AvatarImage
                  :src="user?.photoURL!"
                  :alt="user?.displayName"
                  referrerpolicy="no-referrer"
                />
                <AvatarFallback>{{ user?.displayName }}</AvatarFallback>
              </Avatar>
              <div class="grid gap-2">
                <Label for="name" class="text-muted-foreground">
                  Preferred name
                </Label>
                <Input
                  id="name"
                  v-model="displayName"
                  label="Name"
                  placeholder="Your name"
                  class="h-8 w-64 focus:border-inherit focus:ring-0"
                />
              </div>
            </div>
            <Separator />
            <div class="flex items-center gap-4">
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium leading-none">Email</p>
                <p class="text-muted-foreground">
                  {{ user?.email }}
                  <icon-lucide-badge-check v-if="user?.emailVerified" />
                </p>
              </div>
              <div class="ml-auto flex gap-2">
                <Button
                  v-if="!user?.emailVerified"
                  size="xs"
                  variant="secondary"
                  :disabled="sendingVerificationEmail"
                  class="gap-2"
                  @click="sendVerificationEmail"
                >
                  <icon-lucide-loader
                    v-if="sendingVerificationEmail"
                    class="animate-spin"
                  />
                  Verify email
                </Button>
                <Dialog>
                  <DialogTrigger>
                    <Button size="xs" variant="outline">
                      Change email
                    </Button></DialogTrigger
                  >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle> Change email </DialogTitle>
                      <DialogDescription>
                        Update your email address.
                      </DialogDescription>
                    </DialogHeader>
                    <div>
                      <Input
                        v-model="newEmail"
                        label="New email"
                        placeholder="Your new email address"
                        class="focus:border-inherit focus:ring-0"
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        :disabled="changingEmail || !newEmail"
                        class="gap-2"
                        @click="changeEmail"
                      >
                        <icon-lucide-loader
                          v-if="changingEmail"
                          class="animate-spin"
                        />
                        Send verification email
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium leading-none">Delete account</p>
                <p class="text-muted-foreground">
                  Permanently delete your account.
                </p>
              </div>
              <div class="ml-auto flex gap-2">
                <AlertDialog>
                  <AlertDialogTrigger>
                    <Button size="xs" variant="destructive" class="gap-2">
                      Delete account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle> Delete account </AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete your account?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction as-child @click="deleteAccount">
                        <Button variant="destructive">Delete account </Button>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        </TabsContent>
        <TabsContent
          value="appearance"
          class="col-span-4 mt-0 transition duration-300 animate-in fade-in"
        >
          <div class="flex h-full w-full flex-col gap-4 px-8 py-6">
            <div class="flex flex-col">
              <h3 class="text-lg font-semibold">Appearance</h3>
              <p class="text-muted-foreground">
                Customize the appearance of the app.
              </p>
            </div>
            <Separator />
            <div class="flex items-center gap-4">
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium leading-none">Theme</p>
                <p class="text-muted-foreground">
                  Customize how template app looks on your device.
                </p>
              </div>
              <div class="ml-auto flex gap-2">
                <Select v-model="store" :default-value="store">
                  <SelectTrigger class="h-8 gap-2">
                    <SelectValue placeholder="Select a theme" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem
                      v-for="mode in themes"
                      :key="mode.id"
                      :value="mode.id"
                      class="gap-4"
                    >
                      {{ mode.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      <DialogFooter class="sr-only">
        <Button type="submit"> Save changes </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

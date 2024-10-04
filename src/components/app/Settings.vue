<script setup lang="ts">
import { themes } from "@/helpers/defaults"
import { languages } from "@/helpers/defaults"
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

const { locale } = useI18n()
watch(locale, (newLocale) => localStorage.setItem("locale", newLocale))
</script>

<template>
  <Dialog :open="openSettings" @update:open="openSettings = false">
    <DialogContent class="h-2/3 w-3/5 max-w-none overflow-clip p-0">
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
          class="col-span-4 mt-0 transition duration-200 animate-in fade-in"
        >
          <div class="flex h-full w-full flex-col gap-6 px-8 py-6">
            <div class="flex flex-col">
              <h3 class="text-lg font-semibold">Account</h3>
              <p class="flex items-center gap-2 text-muted-foreground">
                Manage your account settings.
              </p>
            </div>
            <Separator />
            <div class="flex items-center gap-4">
              <div class="relative">
                <Avatar class="h-16 w-16">
                  <AvatarImage
                    :src="user?.photoURL!"
                    :alt="user?.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback>{{ user?.displayName }}</AvatarFallback>
                </Avatar>
                <span
                  class="absolute -bottom-0 -right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-primary p-2 text-primary-foreground"
                >
                  <icon-lucide-upload />
                </span>
              </div>
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
                <p class="text-sm font-medium leading-none">Primary email</p>
                <p class="flex items-center gap-2 text-muted-foreground">
                  {{ user?.email }}
                  <TooltipProvider v-if="user?.emailVerified">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Badge
                          size="xs"
                          variant="outline"
                          class="gap-1 px-1 font-normal"
                        >
                          <icon-lucide-badge-check />
                          Verified
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        We've verified your email address.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
                    <Button size="sm" variant="outline">
                      Change primary email
                    </Button>
                  </DialogTrigger>
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
                <p class="text-sm font-medium leading-none">
                  Connected accounts
                </p>
                <p class="flex items-center gap-2 text-muted-foreground">
                  Manage your connected accounts.
                </p>
              </div>
              <div class="ml-auto flex gap-2">
                <Button size="sm" variant="outline" class="gap-2">
                  Connect a new account
                </Button>
              </div>
            </div>
            <div
              v-for="provider in user?.providerData"
              :key="provider.providerId"
              class="flex items-center gap-4"
            >
              <div class="relative">
                <Avatar class="h-8 w-8">
                  <AvatarImage
                    :src="provider.photoURL!"
                    :alt="provider.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <AvatarFallback>{{ provider.displayName }}</AvatarFallback>
                </Avatar>
                <span
                  class="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-background"
                >
                  <icon-logos-google-icon
                    v-if="provider.providerId === 'google.com'"
                  />
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium leading-none">
                  {{ provider.displayName }}
                </p>
                <p class="flex items-center gap-2 text-muted-foreground">
                  {{ provider.email }}
                </p>
              </div>
              <div class="ml-auto flex gap-2">
                <Button size="xs" variant="secondary" class="gap-2">
                  Disconnect
                </Button>
              </div>
            </div>
            <Separator />
            <div class="flex items-center gap-4">
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium leading-none">Delete account</p>
                <p class="flex items-center gap-2 text-muted-foreground">
                  Permanently delete your account.
                </p>
              </div>
              <div class="ml-auto flex gap-2">
                <AlertDialog>
                  <AlertDialogTrigger>
                    <Button size="sm" variant="destructive" class="gap-2">
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
                      <AlertDialogAction
                        variant="destructive"
                        @click="deleteAccount"
                      >
                        Delete account
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
          class="col-span-4 mt-0 transition duration-200 animate-in fade-in"
        >
          <div class="flex h-full w-full flex-col gap-6 px-8 py-6">
            <div class="flex flex-col">
              <h3 class="text-lg font-semibold">Appearance</h3>
              <p class="flex items-center gap-2 text-muted-foreground">
                Customize the appearance of the app.
              </p>
            </div>
            <Separator />
            <div class="flex items-center gap-4">
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium leading-none">Theme</p>
                <p class="flex items-center gap-2 text-muted-foreground">
                  Customize how template app looks on your device.
                </p>
              </div>
              <div class="ml-auto flex gap-2">
                <Select v-model="store" :default-value="store">
                  <SelectTrigger class="h-9 gap-2">
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
            <div class="flex items-center gap-4">
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium leading-none">Language</p>
                <p class="flex items-center gap-2 text-muted-foreground">
                  Choose your preferred language.
                </p>
              </div>
              <div class="ml-auto flex gap-2">
                <Select v-model="locale" :default-value="locale">
                  <SelectTrigger class="h-9 gap-2">
                    <SelectValue placeholder="Select a language" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem
                      v-for="language in languages"
                      :key="language.id"
                      :value="language.id"
                      class="gap-4"
                    >
                      {{ language.name }}
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

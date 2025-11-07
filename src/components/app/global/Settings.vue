<script lang="ts" setup>
import {
  accents,
  fonts,
  languages,
  sizes,
  themes,
  zooms,
} from "@/helpers/defaults"
import { getInitials } from "@/helpers/utilities"
import emitter from "@/modules/mitt"
import { accent, font, size, store, zoom } from "@/modules/theme"
import {
  deleteUser,
  sendEmailVerification,
  unlink,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "firebase/auth"
import { ref as storageRef } from "firebase/storage"
import { toast } from "vue-sonner"
import {
  updateCurrentUserProfile,
  useCurrentUser,
  useFirebaseStorage,
  useStorageFile,
} from "vuefire"
import IconActivity from "~icons/lucide/activity"
import IconDollarSignBadge from "~icons/lucide/badge-dollar-sign"
import IconBell from "~icons/lucide/bell"
import IconBlocks from "~icons/lucide/blocks"
import IconBolt from "~icons/lucide/bolt"
import IconBot from "~icons/lucide/bot"
import IconCircleUserRound from "~icons/lucide/circle-user-round"
import IconComponent from "~icons/lucide/component"
import IconCreditCard from "~icons/lucide/credit-card"
import IconDatabase from "~icons/lucide/database"
import IconLock from "~icons/lucide/lock"
import IconLogs from "~icons/lucide/logs"
import IconPalette from "~icons/lucide/palette"
import IconSettings from "~icons/lucide/settings"
import IconUsersRound from "~icons/lucide/users-round"

const openSettings = ref(false)
const activeTab = ref("preferences")

emitter.on("Dialog.Settings.Open", (event) => {
  const selected = event as string
  activeTab.value = selected
  openSettings.value = !openSettings.value
})

const user = useCurrentUser()

const displayName = computed({
  get: () => user.value?.displayName ?? "User",
  set: (value: string) => {
    updateCurrentUserProfile({ displayName: value })
  },
})

const photoURL = computed({
  get: () => user.value?.photoURL ?? "",
  set: (value: string) => {
    updateCurrentUserProfile({ photoURL: value })
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

const newPassword = ref("")
const changingPassword = ref(false)
const changePassword = async () => {
  changingPassword.value = true

  await updatePassword(user.value!, newPassword.value)
    .then(() => {
      toast.success("Password updated", {
        description: "Your password has been successfully updated.",
      })
    })
    .catch((error) => {
      toast.error("Failed to update password", {
        description: error.message,
      })
    })
    .finally(() => {
      changingPassword.value = false
    })
}

const deletingAccount = ref(false)
const deleteAccount = async () => {
  deletingAccount.value = true

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
    .finally(() => {
      deletingAccount.value = false
    })
}

const unlinkingProviderMap = ref<Record<string, boolean>>({})
const unlinkProvider = async (providerId: string) => {
  unlinkingProviderMap.value = {
    ...unlinkingProviderMap.value,
    [providerId]: true,
  }

  await unlink(user.value!, providerId)
    .then(() => {
      toast.success("Provider unlinked", {
        description: "The provider has been successfully unlinked.",
      })
    })
    .catch((error) => {
      toast.error("Failed to unlink provider", {
        description: error.message,
      })
    })
    .finally(() => {
      unlinkingProviderMap.value = {
        ...unlinkingProviderMap.value,
        [providerId]: false,
      }
    })
}

const storage = useFirebaseStorage()
const profilePhotoFileRef = storageRef(
  storage,
  `${user.value?.uid}/images/profilePhoto.jpg`
)

const { url, uploadProgress, uploadError, uploadTask, upload } =
  useStorageFile(profilePhotoFileRef)

watch(
  () => url.value,
  (newVal, oldVal) => {
    if (oldVal === undefined) return
    if (oldVal === null && newVal) {
      try {
        photoURL.value = newVal
        toast.success("Profile picture updated", {
          description: "Your profile picture has been updated successfully.",
        })
        reset()
        filename.value = ""
      } catch (error) {
        console.error("Error updating profile with new photo URL:", error)
        toast.error("Failed to update profile picture", {
          description: error as string,
        })
      }
    }
  }
)

const uploadPicture = async () => {
  const data = files.value?.item(0)
  if (data) {
    try {
      toast.info("Uploading profile picture", {
        description: "Please wait while we upload your profile picture.",
      })
      filename.value = data.name
      await upload(data)
    } catch (error) {
      console.error("Error uploading picture or updating profile:", error)
      toast.error("Failed to upload profile picture", {
        description: error as string,
      })
    }
  }
}

const filename = ref<string>()
const { files, open, reset } = useFileDialog()

watch(files, uploadPicture)

const { locale } = useI18n()
watch(locale, (newLocale) => localStorage.setItem("locale", newLocale))

const getComputedProviderName = (provider: string) => {
  switch (provider) {
    case "google.com":
      return "Google.com"
    case "password":
      return "Password"
    default:
      return "Unknown"
  }
}

const passwordExists = computed(() => {
  return user.value?.providerData.some(
    (provider) => provider.providerId === "password"
  )
})

const navigations = [
  {
    title: "General",
    id: "general",
    links: [
      {
        name: "Preferences",
        icon: IconSettings,
        id: "preferences",
        description: "Manage your general settings and preferences.",
      },
      {
        name: "Account",
        icon: IconCircleUserRound,
        id: "account",
        description: "Manage your account settings.",
      },
      {
        name: "Notifications",
        icon: IconBell,
        id: "notifications",
        description: "Manage your notification preferences.",
      },
      {
        name: "Appearance",
        icon: IconPalette,
        id: "appearance",
        description: "Customize the appearance of the app.",
      },
      {
        name: "Security",
        icon: IconLock,
        id: "security",
        description: "Manage your security settings.",
      },
    ],
  },
  {
    title: "Workspace",
    id: "workspace",
    links: [
      {
        name: "Agents",
        icon: IconBot,
        id: "agents",
        description: "Manage your workspace agents.",
      },
      {
        name: "People",
        icon: IconUsersRound,
        id: "people",
        description: "Manage people in your organization.",
      },
      {
        name: "Teams",
        icon: IconComponent,
        id: "teams",
        description: "Manage your workspace teams.",
      },
      {
        name: "Runs",
        icon: IconActivity,
        id: "runs",
        description: "View and manage your runs.",
      },
      {
        name: "Knowledge",
        icon: IconDatabase,
        id: "knowledge",
        description: "Manage your workspace knowledge base.",
      },
      {
        name: "Integrations",
        icon: IconBlocks,
        id: "integrations",
        description: "Manage your workspace integrations.",
      },
      {
        name: "Logs",
        icon: IconLogs,
        id: "logs",
        description: "View system and activity logs.",
      },
    ],
  },
  {
    title: "Administration",
    id: "administration",
    links: [
      {
        name: "General",
        icon: IconBolt,
        id: "general",
        description: "General administration settings.",
      },
      {
        name: "Billing",
        icon: IconCreditCard,
        id: "billing",
        description: "Manage your billing information and subscriptions.",
      },
      {
        name: "Plans",
        icon: IconDollarSignBadge,
        id: "plans",
        description: "View and manage your subscription plans.",
      },
    ],
  },
]
</script>

<template>
  <Dialog v-model:open="openSettings">
    <DialogContent
      class="h-3/4 max-h-3/4! w-3/4 max-w-3/4! overflow-auto overscroll-none scroll-smooth p-0"
    >
      <Tabs
        v-model="activeTab"
        :default-value="activeTab"
        class="flex size-full flex-col overflow-auto overscroll-none scroll-smooth"
        orientation="vertical"
      >
        <SidebarProvider
          :default-open="true"
          class="h-full min-h-auto overflow-auto overscroll-none scroll-smooth"
        >
          <Sidebar collapsible="none">
            <TabsList class="contents">
              <SidebarContent>
                <OverlayScrollbarsWrapper>
                  <SidebarGroup
                    v-for="navigation in navigations"
                    :key="navigation.id"
                  >
                    <SidebarGroupLabel>
                      {{ navigation.title }}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem
                          v-for="item in navigation.links"
                          :key="item.name"
                        >
                          <TabsTrigger
                            :value="item.id"
                            as-child
                            class="data-[state=active]:bg-sidebar-accent text-secondary-foreground data-[state=active]:text-sidebar-accent-foreground data-[state=active]:shadow-none"
                          >
                            <SidebarMenuButton
                              :is-active="item.id === activeTab"
                              class="justify-start"
                            >
                              <Component :is="item.icon" />
                              <span>{{ item.name }}</span>
                            </SidebarMenuButton>
                          </TabsTrigger>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                </OverlayScrollbarsWrapper>
              </SidebarContent>
            </TabsList>
          </Sidebar>
          <Separator orientation="vertical" />
          <div
            class="flex flex-1 flex-col overflow-auto overscroll-none scroll-smooth"
          >
            <DialogHeader class="p-6">
              <DialogTitle>
                {{
                  navigations
                    .find((nav) =>
                      nav.links.some((link) => link.id === activeTab)
                    )
                    ?.links.find((link) => link.id === activeTab)?.name
                }}
              </DialogTitle>
              <DialogDescription>
                {{
                  navigations
                    .find((nav) =>
                      nav.links.some((link) => link.id === activeTab)
                    )
                    ?.links.find((link) => link.id === activeTab)?.description
                }}
              </DialogDescription>
            </DialogHeader>
            <Separator />
            <OverlayScrollbarsWrapper>
              <TabsContent
                class="overflow-auto overscroll-none scroll-smooth"
                value="preferences"
              >
                <div class="p-6">
                  <div class="flex items-center gap-4">
                    <div
                      class="group relative flex flex-col items-center gap-2"
                    ></div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent
                class="overflow-auto overscroll-none scroll-smooth"
                value="account"
              >
                <div class="p-6">
                  <FieldGroup>
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="profile-picture">
                            Profile picture
                          </FieldLabel>
                          <FieldDescription>
                            Upload or remove your profile picture.
                          </FieldDescription>
                        </FieldContent>
                        <div
                          class="group relative flex flex-col items-center gap-2"
                        >
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <Avatar
                                  class="size-16 cursor-pointer"
                                  @click="
                                    open({ accept: 'image/*', multiple: false })
                                  "
                                >
                                  <template v-if="uploadTask">
                                    <Spinner />
                                  </template>
                                  <template v-else-if="uploadError">
                                    <icon-lucide-alert-triangle />
                                  </template>
                                  <template v-else>
                                    <AvatarImage
                                      :src="user?.photoURL!"
                                      :alt="user?.displayName"
                                      referrerpolicy="no-referrer"
                                    />
                                    <AvatarFallback>
                                      {{
                                        getInitials(user?.displayName as string)
                                      }}
                                    </AvatarFallback>
                                  </template>
                                </Avatar>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{
                                  uploadTask
                                    ? `${uploadProgress ? (uploadProgress * 100).toFixed(0) : 0}%`
                                    : "Upload profile picture"
                                }}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <Button
                                  v-if="photoURL"
                                  class="border-background absolute top-0 right-0 size-6 rounded-full border-2 p-2 opacity-0 transition group-hover:opacity-100"
                                  size="icon"
                                  @click="photoURL = ''"
                                >
                                  <icon-lucide-x />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Remove profile picture
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="name">Preferred name</FieldLabel>
                          <FieldDescription>
                            Enter your preferred display name.
                          </FieldDescription>
                        </FieldContent>
                        <Input
                          id="name"
                          v-model="displayName"
                          label="Name"
                          placeholder="Your name"
                          class="h-8 w-64 focus:border-inherit focus:ring-0"
                        />
                      </Field>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="email">Email</FieldLabel>
                          <FieldDescription>
                            {{ user?.email }}
                            <TooltipProvider v-if="user?.emailVerified">
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <Badge
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
                          </FieldDescription>
                        </FieldContent>
                        <div class="flex gap-2">
                          <Button
                            v-if="!user?.emailVerified"
                            variant="secondary"
                            :disabled="sendingVerificationEmail"
                            @click="sendVerificationEmail"
                          >
                            <Spinner v-if="sendingVerificationEmail" />
                            <span>Verify email</span>
                          </Button>
                          <Dialog>
                            <DialogTrigger>
                              <Button variant="outline"> Change email </Button>
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
                                  placeholder="New email address"
                                />
                              </div>
                              <DialogFooter>
                                <Button
                                  :disabled="changingEmail || !newEmail"
                                  @click="changeEmail"
                                >
                                  <Spinner v-if="changingEmail" />
                                  <span>Send verification email</span>
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="password">Password</FieldLabel>
                          <FieldDescription>
                            Set a password to log in to your account.
                          </FieldDescription>
                        </FieldContent>
                        <Dialog>
                          <DialogTrigger>
                            <Button variant="outline">
                              <span>
                                {{
                                  passwordExists
                                    ? "Change password"
                                    : "Set password"
                                }}
                              </span>
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>
                                {{
                                  passwordExists
                                    ? "Change password"
                                    : "Set password"
                                }}
                              </DialogTitle>
                              <DialogDescription>
                                Update your password.
                              </DialogDescription>
                            </DialogHeader>
                            <div>
                              <Input
                                v-model="newPassword"
                                label="New password"
                                placeholder="New password"
                              />
                            </div>
                            <DialogFooter>
                              <Button
                                :disabled="changingPassword || !newPassword"
                                @click="changePassword"
                              >
                                <Spinner v-if="changingPassword" />
                                <span>Change password</span>
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </Field>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="identity-providers">
                            Identity providers
                          </FieldLabel>
                          <FieldDescription>
                            Manage your connected accounts and sign-in methods.
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline">
                          <span>Connect a new account</span>
                        </Button>
                      </Field>
                      <div
                        v-if="
                          user?.providerData && user.providerData.length > 0
                        "
                        class="flex flex-col-reverse gap-4"
                      >
                        <div
                          v-for="provider in user?.providerData"
                          :key="provider.providerId"
                          class="flex items-center gap-4"
                        >
                          <div class="relative">
                            <Avatar class="size-8">
                              <AvatarImage
                                :src="provider.photoURL as string"
                                :alt="provider.displayName"
                                referrerpolicy="no-referrer"
                              />
                              <AvatarFallback>
                                {{ getInitials(provider.displayName ?? "") }}
                              </AvatarFallback>
                            </Avatar>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <span
                                    class="bg-background border-background absolute -right-2 -bottom-2 flex items-center justify-center rounded-full border-4"
                                  >
                                    <icon-logos-google-icon
                                      v-if="
                                        provider.providerId === 'google.com'
                                      "
                                    />
                                    <icon-lucide-asterisk
                                      v-else-if="
                                        provider.providerId === 'password'
                                      "
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {{
                                    getComputedProviderName(provider.providerId)
                                  }}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <div class="flex flex-col gap-1">
                            <p class="leading-none font-medium">
                              {{ provider.displayName }}
                            </p>
                            <p
                              class="text-muted-foreground flex items-center gap-2"
                            >
                              {{ provider.email }}
                            </p>
                          </div>
                          <div class="ml-auto flex gap-2">
                            <Button
                              :disabled="
                                unlinkingProviderMap[provider.providerId]
                              "
                              variant="secondary"
                              @click="unlinkProvider(provider.providerId)"
                            >
                              <Spinner
                                v-if="unlinkingProviderMap[provider.providerId]"
                              />
                              <span> Remove </span>
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div v-else class="text-muted-foreground">
                        No connected accounts.
                      </div>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="delete-account">
                            Delete account
                          </FieldLabel>
                          <FieldDescription>
                            Permanently delete your account.
                          </FieldDescription>
                        </FieldContent>
                        <AlertDialog>
                          <AlertDialogTrigger as-child>
                            <Button variant="destructive">
                              <Spinner v-if="deletingAccount" />
                              <span>Delete account</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete account
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete your account?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                :disabled="deletingAccount"
                                variant="destructive"
                                @click="deleteAccount"
                              >
                                <Spinner v-if="deletingAccount" />
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </Field>
                    </FieldSet>
                  </FieldGroup>
                </div>
              </TabsContent>
              <TabsContent
                class="overflow-auto overscroll-none scroll-smooth"
                value="appearance"
              >
                <div class="p-6">
                  <FieldGroup>
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="theme">Theme</FieldLabel>
                          <FieldDescription>
                            Customize how Lectornaut looks on your device.
                          </FieldDescription>
                        </FieldContent>
                        <Select id="theme" v-model="store">
                          <SelectTrigger class="h-9 gap-2">
                            <SelectValue placeholder="Select a theme" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem
                              v-for="mode in themes"
                              :key="mode.id"
                              :value="mode.id"
                            >
                              <Component :is="mode.icon" />
                              {{ mode.name }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="accent">Accent</FieldLabel>
                          <FieldDescription>
                            Choose your preferred accent color.
                          </FieldDescription>
                        </FieldContent>
                        <Select id="accent" v-model="accent">
                          <SelectTrigger class="h-9 gap-2">
                            <SelectValue placeholder="Select an accent color" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem
                              v-for="color in accents"
                              :key="color.id"
                              :value="color.id"
                            >
                              <icon-mdi-circle
                                :class="`text-${color.id}-500`"
                              />
                              {{ color.name }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="language">Language</FieldLabel>
                          <FieldDescription>
                            Choose your preferred language.
                          </FieldDescription>
                        </FieldContent>
                        <Select id="language" v-model="locale">
                          <SelectTrigger class="h-9 gap-2">
                            <SelectValue placeholder="Select a language" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem
                              v-for="language in languages"
                              :key="language.id"
                              :value="language.id"
                            >
                              <Component :is="language.icon" />
                              {{ language.name }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="font">Font</FieldLabel>
                          <FieldDescription>
                            Choose your preferred font.
                          </FieldDescription>
                        </FieldContent>
                        <Select id="font" v-model="font">
                          <SelectTrigger class="h-9 gap-2">
                            <SelectValue placeholder="Select a font" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem
                              v-for="family in fonts"
                              :key="family.id"
                              :value="family.id"
                            >
                              <Component :is="family.icon" />
                              <span :class="`font-${family.id}`">
                                {{ family.name }}
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="text-size">Text</FieldLabel>
                          <FieldDescription>
                            Adjust the text size for better readability.
                          </FieldDescription>
                        </FieldContent>
                        <Select id="text-size" v-model="size" class="w-40">
                          <SelectTrigger class="h-9 gap-2">
                            <SelectValue placeholder="Select text size" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem
                              v-for="scale in sizes"
                              :key="scale.id"
                              :value="scale.id"
                            >
                              <Component :is="scale.icon" />
                              <span :class="`text-${scale.id}`">
                                {{ scale.name }}
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="zoom-level">Zoom</FieldLabel>
                          <FieldDescription>
                            Press Ctrl/Cmd +/- to zoom in and out.
                          </FieldDescription>
                        </FieldContent>
                        <Select id="zoom-level" v-model="zoom" class="w-40">
                          <SelectTrigger class="h-9 gap-2">
                            <SelectValue placeholder="Select zoom level" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem
                              v-for="level in zooms"
                              :key="level.id"
                              :value="level.id"
                            >
                              <Component :is="level.icon" />
                              {{ level.name }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </FieldSet>
                  </FieldGroup>
                </div>
              </TabsContent>
              <TabsContent
                class="overflow-auto overscroll-none scroll-smooth"
                value="notifications"
              >
                <div class="p-6">
                  <FieldGroup>
                    <FieldSet>
                      <FieldLabel>Notification Categories</FieldLabel>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="communication-notifications">
                            Communication
                          </FieldLabel>
                          <FieldDescription>
                            Notifications about messages, calls, and team
                            communications.
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          id="communication-notifications"
                          :model-value="true"
                        />
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="marketing-notifications">
                            Marketing and Promotions
                          </FieldLabel>
                          <FieldDescription>
                            Promotional emails, feature announcements, and
                            product updates.
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          id="marketing-notifications"
                          :model-value="true"
                        />
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="security-notifications">
                            Security
                          </FieldLabel>
                          <FieldDescription>
                            Account security alerts, login attempts, and privacy
                            updates.
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          id="security-notifications"
                          :model-value="true"
                          disabled
                        />
                      </Field>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <FieldLabel>Notification Frequency</FieldLabel>
                      <FieldDescription>
                        Choose how often you want to receive notifications.
                      </FieldDescription>
                      <RadioGroup default-value="immediate">
                        <Field orientation="horizontal">
                          <RadioGroupItem
                            id="notify-immediate"
                            value="immediate"
                          />
                          <FieldLabel for="notify-immediate">
                            Immediately
                          </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem id="notify-daily" value="daily" />
                          <FieldLabel for="notify-daily"> Daily </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem id="notify-weekly" value="weekly" />
                          <FieldLabel for="notify-weekly"> Weekly </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem id="notify-none" value="none" />
                          <FieldLabel for="notify-none">
                            No notifications
                          </FieldLabel>
                        </Field>
                      </RadioGroup>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <FieldLabel>Notification Channels</FieldLabel>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="email-notifications">
                            Email notifications
                          </FieldLabel>
                          <FieldDescription>
                            Manage your email notification preferences.
                          </FieldDescription>
                        </FieldContent>
                        <Switch id="email-notifications" :model-value="true" />
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="push-notifications">
                            Push notifications
                          </FieldLabel>
                          <FieldDescription>
                            Manage your push notification preferences.
                          </FieldDescription>
                        </FieldContent>
                        <Switch id="push-notifications" :model-value="true" />
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="inapp-notifications">
                            In-app notifications
                          </FieldLabel>
                          <FieldDescription>
                            Manage your in-app notification preferences.
                          </FieldDescription>
                        </FieldContent>
                        <Switch id="inapp-notifications" :model-value="true" />
                      </Field>
                    </FieldSet>
                  </FieldGroup>
                </div>
              </TabsContent>
              <TabsContent
                class="overflow-auto overscroll-none scroll-smooth"
                value="billing"
              >
                <div class="p-6">
                  <FieldGroup>
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="current-plan">
                            Current plan
                          </FieldLabel>
                          <FieldDescription>
                            View details about your current subscription plan.
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline"> View plan details </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="payment-method">
                            Payment method
                          </FieldLabel>
                          <FieldDescription>
                            Manage your payment methods and billing information.
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline"> Edit payment method </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="billing-address">
                            Billing address
                          </FieldLabel>
                          <FieldDescription>
                            Manage your billing address and contact information.
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline">
                          Edit billing address
                        </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="billing-history">
                            Billing history
                          </FieldLabel>
                          <FieldDescription>
                            View your billing history and invoices.
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline"> View invoices </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="upgrade-plan">
                            Upgrade plan
                          </FieldLabel>
                          <FieldDescription>
                            Explore and upgrade to a different subscription
                            plan.
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline"> Upgrade plan </Button>
                      </Field>
                    </FieldSet>
                  </FieldGroup>
                </div>
              </TabsContent>
              <TabsContent
                class="overflow-auto overscroll-none scroll-smooth"
                value="plans"
              >
                <div class="p-6">
                  <FieldGroup>
                    <FieldSet>
                      <FieldLabel for="subscription-plan">
                        Subscription Plan
                      </FieldLabel>
                      <FieldDescription>
                        Select the subscription plan that best fits your needs.
                      </FieldDescription>
                      <RadioGroup
                        default-value="personal"
                        class="grid grid-cols-1 gap-2"
                      >
                        <FieldLabel for="personal">
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>Personal</FieldTitle>
                              <FieldDescription>
                                Perfect for individual users and personal
                                projects.
                              </FieldDescription>
                            </FieldContent>
                            <RadioGroupItem id="personal" value="personal" />
                          </Field>
                        </FieldLabel>
                        <FieldLabel for="professional">
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>Professional</FieldTitle>
                              <FieldDescription>
                                Ideal for freelancers and small teams with
                                advanced features.
                              </FieldDescription>
                            </FieldContent>
                            <RadioGroupItem
                              id="professional"
                              value="professional"
                            />
                          </Field>
                        </FieldLabel>
                        <FieldLabel for="business">
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>Business</FieldTitle>
                              <FieldDescription>
                                Designed for growing businesses with
                                collaboration tools.
                              </FieldDescription>
                            </FieldContent>
                            <RadioGroupItem id="business" value="business" />
                          </Field>
                        </FieldLabel>
                        <FieldLabel for="enterprise">
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>Enterprise</FieldTitle>
                              <FieldDescription>
                                Complete solution for large organizations with
                                custom support.
                              </FieldDescription>
                            </FieldContent>
                            <RadioGroupItem
                              id="enterprise"
                              value="enterprise"
                            />
                          </Field>
                        </FieldLabel>
                      </RadioGroup>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <FieldLabel>Subscription Term</FieldLabel>
                      <FieldDescription>
                        Yearly and monthly terms offer significant savings.
                      </FieldDescription>
                      <RadioGroup default-value="yearly">
                        <Field orientation="horizontal">
                          <RadioGroupItem id="plan-yearly" value="yearly" />
                          <FieldLabel for="plan-yearly">
                            Yearly (Save 20%)
                          </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem id="plan-monthly" value="monthly" />
                          <FieldLabel for="plan-monthly"> Monthly </FieldLabel>
                        </Field>
                      </RadioGroup>
                    </FieldSet>
                  </FieldGroup>
                </div>
              </TabsContent>
            </OverlayScrollbarsWrapper>
            <Separator />
            <DialogFooter class="p-6">
              <DialogClose as-child>
                <Button variant="outline"> Cancel </Button>
              </DialogClose>
              <DialogClose as-child>
                <Button> Save </Button>
              </DialogClose>
            </DialogFooter>
          </div>
        </SidebarProvider>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>

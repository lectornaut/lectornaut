<script lang="ts" setup>
import {
  IconAlertTriangle,
  IconAsterisk,
  IconBadgeCheck,
  IconCircleFilled,
  IconGoogleIcon,
  IconX,
} from "@/data/icons"
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

const { locale, t } = useI18n()
watch(locale, (newLocale) => localStorage.setItem("locale", newLocale))

const getComputedProviderName = (provider: string) => {
  switch (provider) {
    case "google.com":
      return t("settings.account.identityProviders.google")
    case "password":
      return t("settings.account.identityProviders.password")
    default:
      return t("common.unknown")
  }
}

const passwordExists = computed(() => {
  return user.value?.providerData.some(
    (provider) => provider.providerId === "password"
  )
})

const navigations = computed(() => [
  {
    title: t("settings.titles.general"),
    id: "general",
    links: [
      {
        name: t("settings.titles.preferences"),
        icon: IconSettings,
        id: "preferences",
        description: t("settings.descriptions.preferences"),
      },
      {
        name: t("settings.titles.account"),
        icon: IconCircleUserRound,
        id: "account",
        description: t("settings.descriptions.account"),
      },
      {
        name: t("settings.titles.notifications"),
        icon: IconBell,
        id: "notifications",
        description: t("settings.descriptions.notifications"),
      },
      {
        name: t("settings.titles.appearance"),
        icon: IconPalette,
        id: "appearance",
        description: t("settings.descriptions.appearance"),
      },
      {
        name: t("settings.titles.security"),
        icon: IconLock,
        id: "security",
        description: t("settings.descriptions.security"),
      },
    ],
  },
  {
    title: t("settings.titles.workspace"),
    id: "workspace",
    links: [
      {
        name: t("settings.titles.agents"),
        icon: IconBot,
        id: "agents",
        description: t("settings.descriptions.agents"),
      },
      {
        name: t("settings.titles.people"),
        icon: IconUsersRound,
        id: "people",
        description: t("settings.descriptions.people"),
      },
      {
        name: t("settings.titles.teams"),
        icon: IconComponent,
        id: "teams",
        description: t("settings.descriptions.teams"),
      },
      {
        name: t("settings.titles.runs"),
        icon: IconActivity,
        id: "runs",
        description: t("settings.descriptions.runs"),
      },
      {
        name: t("settings.titles.knowledge"),
        icon: IconDatabase,
        id: "knowledge",
        description: t("settings.descriptions.knowledge"),
      },
      {
        name: t("settings.titles.integrations"),
        icon: IconBlocks,
        id: "integrations",
        description: t("settings.descriptions.integrations"),
      },
      {
        name: t("settings.titles.logs"),
        icon: IconLogs,
        id: "logs",
        description: t("settings.descriptions.logs"),
      },
    ],
  },
  {
    title: t("settings.titles.administration"),
    id: "administration",
    links: [
      {
        name: t("settings.titles.general"),
        icon: IconBolt,
        id: "general",
        description: t("settings.descriptions.general"),
      },
      {
        name: t("settings.titles.billing"),
        icon: IconCreditCard,
        id: "billing",
        description: t("settings.descriptions.billing"),
      },
      {
        name: t("settings.titles.plans"),
        icon: IconDollarSignBadge,
        id: "plans",
        description: t("settings.descriptions.plans"),
      },
    ],
  },
])
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
                            {{ t("settings.account.profilePicture.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t("settings.account.profilePicture.description")
                            }}
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
                                    <IconAlertTriangle />
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
                                    : t(
                                        "settings.account.profilePicture.upload"
                                      )
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
                                  <IconX />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {{
                                  t("settings.account.profilePicture.remove")
                                }}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="name">{{
                            t("settings.account.preferredName.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{
                              t("settings.account.preferredName.description")
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <Input
                          id="name"
                          v-model="displayName"
                          :label="
                            t('settings.account.preferredName.inputLabel')
                          "
                          :placeholder="
                            t('settings.account.preferredName.placeholder')
                          "
                          class="h-8 w-64 focus:border-inherit focus:ring-0"
                        />
                      </Field>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="email">{{
                            t("settings.account.email.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{ user?.email }}
                            <TooltipProvider v-if="user?.emailVerified">
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <Badge
                                    variant="outline"
                                    class="gap-1 px-1 font-normal"
                                  >
                                    <IconBadgeCheck />
                                    {{ t("settings.account.email.verified") }}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {{ t("settings.account.email.verifiedDesc") }}
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
                            <span>{{
                              t("settings.account.email.verify")
                            }}</span>
                          </Button>
                          <Dialog>
                            <DialogTrigger>
                              <Button variant="outline">
                                {{ t("settings.account.email.change") }}
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>
                                  {{ t("settings.account.email.changeTitle") }}
                                </DialogTitle>
                                <DialogDescription>
                                  {{ t("settings.account.email.changeDesc") }}
                                </DialogDescription>
                              </DialogHeader>
                              <div>
                                <Input
                                  v-model="newEmail"
                                  :label="t('settings.account.email.newLabel')"
                                  :placeholder="
                                    t('settings.account.email.newPlaceholder')
                                  "
                                />
                              </div>
                              <DialogFooter>
                                <Button
                                  :disabled="changingEmail || !newEmail"
                                  @click="changeEmail"
                                >
                                  <Spinner v-if="changingEmail" />
                                  <span>{{
                                    t("settings.account.email.sendVerification")
                                  }}</span>
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="password">{{
                            t("settings.account.password.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{ t("settings.account.password.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Dialog>
                          <DialogTrigger>
                            <Button variant="outline">
                              <span>
                                {{
                                  passwordExists
                                    ? t("settings.account.password.change")
                                    : t("settings.account.password.set")
                                }}
                              </span>
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>
                                {{
                                  passwordExists
                                    ? t("settings.account.password.changeTitle")
                                    : t("settings.account.password.setTitle")
                                }}
                              </DialogTitle>
                              <DialogDescription>
                                {{ t("settings.account.password.changeDesc") }}
                              </DialogDescription>
                            </DialogHeader>
                            <div>
                              <Input
                                v-model="newPassword"
                                :label="t('settings.account.password.newLabel')"
                                :placeholder="
                                  t('settings.account.password.newPlaceholder')
                                "
                              />
                            </div>
                            <DialogFooter>
                              <Button
                                :disabled="changingPassword || !newPassword"
                                @click="changePassword"
                              >
                                <Spinner v-if="changingPassword" />
                                <span>{{
                                  t("settings.account.password.change")
                                }}</span>
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
                          <FieldLabel>
                            {{ t("settings.account.identityProviders.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t(
                                "settings.account.identityProviders.description"
                              )
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline">
                          <span>{{
                            t("settings.account.identityProviders.connect")
                          }}</span>
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
                                    <IconGoogleIcon
                                      v-if="
                                        provider.providerId === 'google.com'
                                      "
                                    />
                                    <IconAsterisk
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
                              <span> {{ t("common.remove") }} </span>
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div v-else class="text-muted-foreground">
                        {{ t("settings.account.identityProviders.noAccounts") }}
                      </div>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="delete-account">
                            {{ t("settings.account.deleteAccount.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t("settings.account.deleteAccount.description")
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <AlertDialog>
                          <AlertDialogTrigger as-child>
                            <Button variant="destructive">
                              <Spinner v-if="deletingAccount" />
                              <span>{{
                                t("settings.account.deleteAccount.title")
                              }}</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {{ t("settings.account.deleteAccount.title") }}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {{
                                  t("settings.account.deleteAccount.confirm")
                                }}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{{
                                t("common.cancel")
                              }}</AlertDialogCancel>
                              <AlertDialogAction
                                :disabled="deletingAccount"
                                variant="destructive"
                                @click="deleteAccount"
                              >
                                <Spinner v-if="deletingAccount" />
                                {{ t("common.delete") }}
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
                          <FieldLabel for="theme">{{
                            t("settings.preferences.theme.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{ t("settings.preferences.theme.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Select id="theme" v-model="store">
                          <SelectTrigger>
                            <SelectValue
                              :placeholder="
                                t('settings.preferences.theme.placeholder')
                              "
                            />
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
                          <FieldLabel for="accent">{{
                            t("settings.preferences.accent.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{ t("settings.preferences.accent.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Select id="accent" v-model="accent">
                          <SelectTrigger>
                            <SelectValue
                              :placeholder="
                                t('settings.preferences.accent.placeholder')
                              "
                            />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem
                              v-for="color in accents"
                              :key="color.id"
                              :value="color.id"
                            >
                              <IconCircleFilled
                                :class="`text-${color.id}-500`"
                              />
                              {{ color.name }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="language">{{
                            t("settings.preferences.language.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{ t("settings.preferences.language.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Select id="language" v-model="locale">
                          <SelectTrigger>
                            <SelectValue
                              :placeholder="
                                t('settings.preferences.language.placeholder')
                              "
                            />
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
                          <FieldLabel for="font">{{
                            t("settings.preferences.font.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{ t("settings.preferences.font.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Select id="font" v-model="font">
                          <SelectTrigger>
                            <SelectValue
                              :placeholder="
                                t('settings.preferences.font.placeholder')
                              "
                            />
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
                          <FieldLabel for="text-size">{{
                            t("settings.preferences.text.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{ t("settings.preferences.text.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Select id="text-size" v-model="size" class="w-40">
                          <SelectTrigger>
                            <SelectValue
                              :placeholder="
                                t('settings.preferences.text.placeholder')
                              "
                            />
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
                          <FieldLabel for="zoom-level">{{
                            t("settings.preferences.zoom.label")
                          }}</FieldLabel>
                          <FieldDescription>
                            {{ t("settings.preferences.zoom.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Select id="zoom-level" v-model="zoom" class="w-40">
                          <SelectTrigger>
                            <SelectValue
                              :placeholder="
                                t('settings.preferences.zoom.placeholder')
                              "
                            />
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
                      <FieldLabel>{{
                        t("settings.notifications.categories.label")
                      }}</FieldLabel>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="communication-notifications">
                            {{
                              t(
                                "settings.notifications.categories.communication.label"
                              )
                            }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t(
                                "settings.notifications.categories.communication.description"
                              )
                            }}
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
                            {{
                              t(
                                "settings.notifications.categories.marketing.label"
                              )
                            }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t(
                                "settings.notifications.categories.marketing.description"
                              )
                            }}
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
                            {{
                              t(
                                "settings.notifications.categories.security.label"
                              )
                            }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t(
                                "settings.notifications.categories.security.description"
                              )
                            }}
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
                      <FieldLabel>{{
                        t("settings.notifications.frequency.label")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{ t("settings.notifications.frequency.description") }}
                      </FieldDescription>
                      <RadioGroup default-value="immediate">
                        <Field orientation="horizontal">
                          <RadioGroupItem
                            id="notify-immediate"
                            value="immediate"
                          />
                          <FieldLabel for="notify-immediate">
                            {{
                              t("settings.notifications.frequency.immediate")
                            }}
                          </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem id="notify-daily" value="daily" />
                          <FieldLabel for="notify-daily">
                            {{ t("settings.notifications.frequency.daily") }}
                          </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem id="notify-weekly" value="weekly" />
                          <FieldLabel for="notify-weekly">
                            {{ t("settings.notifications.frequency.weekly") }}
                          </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem id="notify-none" value="none" />
                          <FieldLabel for="notify-none">
                            {{ t("settings.notifications.frequency.none") }}
                          </FieldLabel>
                        </Field>
                      </RadioGroup>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <FieldLabel>{{
                        t("settings.notifications.channels.label")
                      }}</FieldLabel>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="email-notifications">
                            {{
                              t("settings.notifications.channels.email.label")
                            }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t(
                                "settings.notifications.channels.email.description"
                              )
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <Switch id="email-notifications" :model-value="true" />
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="push-notifications">
                            {{
                              t("settings.notifications.channels.push.label")
                            }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t(
                                "settings.notifications.channels.push.description"
                              )
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <Switch id="push-notifications" :model-value="true" />
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="inapp-notifications">
                            {{
                              t("settings.notifications.channels.inApp.label")
                            }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t(
                                "settings.notifications.channels.inApp.description"
                              )
                            }}
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
                            {{ t("settings.billing.currentPlan.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{ t("settings.billing.currentPlan.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline">
                          {{ t("settings.billing.currentPlan.button") }}
                        </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="payment-method">
                            {{ t("settings.billing.paymentMethod.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t("settings.billing.paymentMethod.description")
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline">
                          {{ t("settings.billing.paymentMethod.button") }}
                        </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="billing-address">
                            {{ t("settings.billing.billingAddress.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t("settings.billing.billingAddress.description")
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline">
                          {{ t("settings.billing.billingAddress.button") }}
                        </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="billing-history">
                            {{ t("settings.billing.billingHistory.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t("settings.billing.billingHistory.description")
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline">
                          {{ t("settings.billing.billingHistory.button") }}
                        </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="upgrade-plan">
                            {{ t("settings.billing.upgradePlan.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{ t("settings.billing.upgradePlan.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <Button variant="outline">
                          {{ t("settings.billing.upgradePlan.button") }}
                        </Button>
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
                        {{ t("settings.plans.subscriptionPlan.label") }}
                      </FieldLabel>
                      <FieldDescription>
                        {{ t("settings.plans.subscriptionPlan.description") }}
                      </FieldDescription>
                      <RadioGroup
                        default-value="personal"
                        class="grid grid-cols-1 gap-2"
                      >
                        <FieldLabel for="personal">
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>{{
                                t(
                                  "settings.plans.subscriptionPlan.personal.title"
                                )
                              }}</FieldTitle>
                              <FieldDescription>
                                {{
                                  t(
                                    "settings.plans.subscriptionPlan.personal.description"
                                  )
                                }}
                              </FieldDescription>
                            </FieldContent>
                            <RadioGroupItem id="personal" value="personal" />
                          </Field>
                        </FieldLabel>
                        <FieldLabel for="professional">
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>{{
                                t(
                                  "settings.plans.subscriptionPlan.professional.title"
                                )
                              }}</FieldTitle>
                              <FieldDescription>
                                {{
                                  t(
                                    "settings.plans.subscriptionPlan.professional.description"
                                  )
                                }}
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
                              <FieldTitle>{{
                                t(
                                  "settings.plans.subscriptionPlan.business.title"
                                )
                              }}</FieldTitle>
                              <FieldDescription>
                                {{
                                  t(
                                    "settings.plans.subscriptionPlan.business.description"
                                  )
                                }}
                              </FieldDescription>
                            </FieldContent>
                            <RadioGroupItem id="business" value="business" />
                          </Field>
                        </FieldLabel>
                        <FieldLabel for="enterprise">
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>{{
                                t(
                                  "settings.plans.subscriptionPlan.enterprise.title"
                                )
                              }}</FieldTitle>
                              <FieldDescription>
                                {{
                                  t(
                                    "settings.plans.subscriptionPlan.enterprise.description"
                                  )
                                }}
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
                      <FieldLabel>{{
                        t("settings.plans.subscriptionTerm.label")
                      }}</FieldLabel>
                      <FieldDescription>
                        {{ t("settings.plans.subscriptionTerm.description") }}
                      </FieldDescription>
                      <RadioGroup default-value="yearly">
                        <Field orientation="horizontal">
                          <RadioGroupItem id="plan-yearly" value="yearly" />
                          <FieldLabel for="plan-yearly">
                            {{ t("settings.plans.subscriptionTerm.yearly") }}
                          </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem id="plan-monthly" value="monthly" />
                          <FieldLabel for="plan-monthly">
                            {{ t("settings.plans.subscriptionTerm.monthly") }}
                          </FieldLabel>
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
                <Button variant="outline"> {{ t("common.cancel") }} </Button>
              </DialogClose>
              <DialogClose as-child>
                <Button> {{ t("common.save") }} </Button>
              </DialogClose>
            </DialogFooter>
          </div>
        </SidebarProvider>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>

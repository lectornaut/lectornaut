<script lang="ts" setup>
import { useKeychain } from "@/composables/useKeychain"
import { useTeamActions } from "@/composables/useTeamActions"
import {
  IconActivity,
  IconAlertTriangle,
  IconAsterisk,
  IconAtSign,
  IconBadgeCheck,
  IconBadgeDollarSign,
  IconBell,
  IconBlocks,
  IconBolt,
  IconBot,
  IconCheck,
  IconCircleFilled,
  IconCircleUserRound,
  IconComponent,
  IconCreditCard,
  IconDatabase,
  IconGoogleIcon,
  IconLock,
  IconLogOut,
  IconLogs,
  IconMoreHorizontal,
  IconPalette,
  IconPencil,
  IconPlus,
  IconSettings,
  IconSwitchHorizontal,
  IconTrash,
  IconUsersRound,
  IconX,
} from "@/data/icons"
import { accents, fonts, languages, sizes, themes } from "@/helpers/defaults"
import { getInitials } from "@/helpers/utilities"
import { logout } from "@/modules/auth"
import { emitter } from "@/modules/mitt"
import { accent, font, size, store } from "@/modules/theme"
import { updateUserData } from "@/queries/updateUserData"
import { checkUsernameAvailability, claimUsername } from "@/queries/username"
import { useAuthStore } from "@/stores/authStore"
import type { IMembership, ITeam } from "@/types"
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernamesMatch,
  validateUsername,
} from "@/utils/firebase-username"
import { DateFormatter } from "@internationalized/date"
import {
  deleteUser,
  sendEmailVerification,
  unlink,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "firebase/auth"
import { collection, doc } from "firebase/firestore"
import { ref as storageRef } from "firebase/storage"
import { toast } from "vue-sonner"
import {
  useCurrentUser,
  useDocument,
  useFirebaseStorage,
  useFirestore,
  useStorageFile,
} from "vuefire"

const db = useFirestore()
const user = useCurrentUser()

const userDocRef = computed(() => {
  if (!user.value?.uid) return null
  return doc(collection(db, "users"), user.value.uid)
})

const { data: userData } = useDocument(userDocRef)

const localUsername = ref(userData.value?.username ?? "")
const isCheckingUsername = ref(false)
const usernameAvailable = ref<boolean | null>(null)
const usernameError = ref<string | null>(null)

// Check if user has a valid username set
const hasUsername = computed(() => {
  const username = userData.value?.username
  return username && username.trim().length >= USERNAME_MIN_LENGTH
})

watch(
  () => userData.value?.username,
  (newVal) => {
    if (newVal) localUsername.value = newVal
  }
)

const checkUsername = async () => {
  // Trim the username on check
  localUsername.value = localUsername.value.trim()

  // Use case-insensitive comparison to check if username changed
  if (usernamesMatch(localUsername.value, userData.value?.username)) {
    usernameAvailable.value = null
    usernameError.value = null
    return
  }

  const validation = validateUsername(localUsername.value)
  if (!validation.valid) {
    usernameAvailable.value = false
    usernameError.value = validation.error
    return
  }

  usernameError.value = null
  isCheckingUsername.value = true
  usernameAvailable.value = await checkUsernameAvailability(localUsername.value)
  if (!usernameAvailable.value) {
    usernameError.value = "Username is already taken"
  }
  isCheckingUsername.value = false
}

const debouncedCheckUsername = useDebounceFn(checkUsername, 500)

const isPublic = computed(() => userData.value?.isPublic ?? false)

// Disable public profile if username is removed
watch(hasUsername, (hasUser) => {
  if (!hasUser && isPublic.value) {
    updateUserData({ isPublic: false }).catch(console.error)
  }
})

const toggleIsPublic = async (value: boolean) => {
  // Only allow enabling public profile if username is set
  if (value && !hasUsername.value) {
    toast.error("Cannot enable public profile", {
      description:
        "Please set a username first before making your profile public.",
    })
    return
  }

  try {
    await updateUserData({ isPublic: value })
    toast.success("Profile visibility updated")
  } catch (error) {
    toast.error("Failed to update profile visibility", {
      description: (error as Error).message,
    })
  }
}

const authStore = useAuthStore()

// Use simplified team actions composable
const {
  currentTeam,
  teamMembers,
  memberships,
  isLoading,
  isOwner,
  getCannotChangeRoleReason,
  getCannotRemoveMemberReason,
  changeRole,
  removeMember,
  switchTeam,
  exitTeam,
  deleteTeam,
  updateTeamPhoto,
  removeTeamPhoto,
  isRoleLoading,
  isMemberLoading,
  isTeamLoading,
  getTeamMemberCount,
} = useTeamActions()

// Team Dialog States - Single dialog with dynamic mode
const isTeamDialogOpen = ref(false)
const teamDialogMode = ref<"create" | "edit" | "invite">("create")
const teamDialogTeam = ref<ITeam | undefined>(undefined)

const openTeamDialog = (mode: "create" | "edit" | "invite", team?: ITeam) => {
  teamDialogMode.value = mode
  teamDialogTeam.value = team
  isTeamDialogOpen.value = true
}

const isDeleteTeamDialogOpen = ref(false)
const teamToDelete = ref<ITeam | null>(null)
const isExitTeamDialogOpen = ref(false)
const teamToExit = ref<ITeam | null>(null)

const startEditingTeam = (team: ITeam) => {
  openTeamDialog("edit", team)
}

const confirmDeleteTeam = (team: ITeam) => {
  teamToDelete.value = team
  isDeleteTeamDialogOpen.value = true
}

const confirmExitTeam = (team: ITeam) => {
  teamToExit.value = team
  isExitTeamDialogOpen.value = true
}

const handleDeleteTeam = async () => {
  if (!teamToDelete.value) return
  try {
    await deleteTeam(teamToDelete.value.id)
    isDeleteTeamDialogOpen.value = false
  } finally {
    teamToDelete.value = null
  }
}

const handleExitTeam = async () => {
  if (!teamToExit.value) return
  try {
    await exitTeam(teamToExit.value.id)
    isExitTeamDialogOpen.value = false
  } finally {
    teamToExit.value = null
  }
}

const openSettings = ref(false)
const activeTab = ref("preferences")

emitter.on("Dialog.Settings.Open", (event) => {
  const selected = event as string
  activeTab.value = selected
  openSettings.value = !openSettings.value
})

const localDisplayName = ref(user.value?.displayName ?? "")

watch(
  () => user.value?.displayName,
  (newVal) => {
    if (newVal) localDisplayName.value = newVal
  }
)

// Track if there are pending changes
const hasPendingChanges = computed(() => {
  const displayNameChanged =
    localDisplayName.value !== (user.value?.displayName ?? "")
  const usernameChanged = !usernamesMatch(
    localUsername.value,
    userData.value?.username ?? ""
  )
  return displayNameChanged || usernameChanged
})

// Unified save function for footer save button
const isSaving = ref(false)
const saveAllChanges = async () => {
  isSaving.value = true
  const errors: string[] = []
  let changesMade = false

  try {
    // Save display name if changed
    if (localDisplayName.value !== (user.value?.displayName ?? "")) {
      changesMade = true
      try {
        await authStore.updateUserProfile({
          displayName: localDisplayName.value,
        })
      } catch (error) {
        errors.push(`Display name: ${(error as Error).message}`)
      }
    }

    // Save username if changed and available
    if (!usernamesMatch(localUsername.value, userData.value?.username ?? "")) {
      if (usernameAvailable.value) {
        changesMade = true
        try {
          await claimUsername(localUsername.value)
        } catch (error) {
          errors.push(`Username: ${(error as Error).message}`)
        }
      } else if (usernameError.value) {
        errors.push(`Username: ${usernameError.value}`)
      }
    }

    if (errors.length > 0) {
      toast.error("Some changes could not be saved", {
        description: errors.join(", "),
      })
    } else {
      toast.success("Settings saved", {
        description: changesMade
          ? "Your changes have been saved successfully."
          : "No changes to save.",
      })
    }
  } finally {
    isSaving.value = false
  }
}

// Discard all unsaved changes
const discardChanges = () => {
  localDisplayName.value = user.value?.displayName ?? ""
  localUsername.value = userData.value?.username ?? ""
  usernameAvailable.value = null
  usernameError.value = null
}

const photoURL = computed({
  get: () => user.value?.photoURL,
  set: (value: string) => {
    authStore.updateUserProfile({ photoURL: value })
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

// Helper function to handle auth errors that require recent login
const handleAuthError = async (
  error: { code?: string; message?: string },
  defaultMessage: string
) => {
  if (error.code === "auth/requires-recent-login") {
    toast.error("Re-authentication required", {
      description:
        "For security reasons, you need to log in again before performing this action.",
      action: {
        label: "Logout",
        onClick: async () => {
          // Remove from keychain to force fresh login (not session restore)
          if (user.value?.uid) {
            useKeychain().removeAccount(user.value.uid)
          }
          // Full logout and redirect to /enter
          await logout()
        },
      },
    })
    return true
  }
  toast.error(defaultMessage, {
    description: error.message,
  })
  return false
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
      handleAuthError(error, "Failed to send verification email")
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
      newPassword.value = ""
    })
    .catch((error) => {
      handleAuthError(error, "Failed to update password")
    })
    .finally(() => {
      changingPassword.value = false
    })
}

const deletingAccount = ref(false)
const deleteAccountInput = ref("")
const isDeleteAccountInputValid = computed(
  () => deleteAccountInput.value.trim().toLowerCase() === "delete my account"
)
const deleteAccount = async () => {
  if (!isDeleteAccountInputValid.value) {
    toast.error("Please type 'delete my account' to confirm.")
    return
  }
  deletingAccount.value = true
  await deleteUser(user.value!)
    .then(() => {
      toast.success("Account deleted", {
        description: "Your account has been successfully deleted.",
      })
    })
    .catch((error) => {
      handleAuthError(error, "Failed to delete account")
    })
    .finally(() => {
      deletingAccount.value = false
      deleteAccountInput.value = ""
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
      handleAuthError(error, "Failed to unlink provider")
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

const teamIdToUpdate = ref<string | null>(null)
const {
  files: teamFiles,
  open: openTeamUpload,
  reset: resetTeamUpload,
} = useFileDialog({
  accept: "image/*",
  multiple: false,
})

const handleTeamAvatarClick = (membership: IMembership) => {
  if (membership.role !== "owner") return
  teamIdToUpdate.value = membership.teamId
  openTeamUpload()
}

watch(teamFiles, async (newFiles) => {
  if (newFiles && newFiles.length > 0 && teamIdToUpdate.value) {
    const file = newFiles.item(0)
    const teamId = teamIdToUpdate.value
    if (file) {
      await updateTeamPhoto(teamId, file)
    }
    resetTeamUpload()
    teamIdToUpdate.value = null
  }
})

const handleRemoveTeamPhoto = async (teamId: string) => {
  await removeTeamPhoto(teamId)
}

const handleRemoveProfilePicture = async () => {
  try {
    // Explicitly pass null to remove the profile picture
    await authStore.updateUserProfile({ photoURL: null })
    toast.success("Profile picture removed")
  } catch (error) {
    console.error("Error removing profile picture:", error)
    toast.error("Failed to remove profile picture", {
      description: (error as Error).message,
    })
  }
}

const { locale, t } = useI18n()

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
        name: t("settings.titles.members"),
        icon: IconUsersRound,
        id: "members",
        description: t("settings.descriptions.members"),
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
        icon: IconBadgeDollarSign,
        id: "plans",
        description: t("settings.descriptions.plans"),
      },
    ],
  },
])

const df = new DateFormatter("en-US", {
  dateStyle: "medium",
})
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
                        <div class="group relative">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger as-child>
                                <Avatar
                                  class="flex size-11 cursor-pointer items-center justify-center rounded-md"
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
                                      class="rounded-md"
                                      :src="user?.photoURL!"
                                      :alt="user?.displayName"
                                      referrerpolicy="no-referrer"
                                    />
                                    <AvatarFallback class="rounded-md">
                                      {{ getInitials(user?.displayName!) }}
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
                                  variant="secondary"
                                  class="border-background absolute -top-2 -right-2 size-6 rounded-full border-2 p-2 opacity-0 transition group-hover:opacity-100"
                                  size="icon-sm"
                                  @click.stop="handleRemoveProfilePicture"
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
                          <FieldLabel for="name">
                            {{ t("settings.account.preferredName.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t("settings.account.preferredName.description")
                            }}
                          </FieldDescription>
                        </FieldContent>
                        <div class="flex">
                          <InputGroup>
                            <InputGroupInput
                              id="name"
                              v-model="localDisplayName"
                              :label="
                                t('settings.account.preferredName.inputLabel')
                              "
                              :placeholder="
                                t('settings.account.preferredName.placeholder')
                              "
                            />
                            <InputGroupAddon align="inline-end">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger as-child>
                                    <IconPencil />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {{
                                      t(
                                        "settings.account.preferredName.editPrompt"
                                      )
                                    }}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                      </Field>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="username">
                            {{ t("settings.account.username.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{ t("settings.account.username.description") }}
                          </FieldDescription>
                        </FieldContent>
                        <div class="flex">
                          <InputGroup>
                            <InputGroupInput
                              id="username"
                              v-model="localUsername"
                              :placeholder="
                                t('settings.account.username.placeholder')
                              "
                              :maxlength="USERNAME_MAX_LENGTH"
                              @input="debouncedCheckUsername"
                            />
                            <InputGroupAddon align="inline-end">
                              <TooltipProvider>
                                <Tooltip v-if="isCheckingUsername">
                                  <TooltipTrigger as-child>
                                    <Spinner class="size-4" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {{
                                      t("settings.account.username.checking")
                                    }}
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip v-else-if="usernameAvailable === true">
                                  <TooltipTrigger as-child>
                                    <IconCheck class="text-green-500" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {{
                                      t("settings.account.username.available")
                                    }}
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip
                                  v-else-if="usernameAvailable === false"
                                >
                                  <TooltipTrigger as-child>
                                    <IconX class="text-red-500" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {{ usernameError }}
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip v-else>
                                  <TooltipTrigger as-child>
                                    <IconAtSign />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {{
                                      t("settings.account.username.checkPrompt")
                                    }}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </InputGroupAddon>
                          </InputGroup>
                        </div>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="is-public">
                            {{ t("settings.account.publicProfile.label") }}
                          </FieldLabel>
                          <FieldDescription>
                            {{
                              t("settings.account.publicProfile.description")
                            }}
                            <span
                              v-if="!hasUsername"
                              class="mt-1 block text-xs text-amber-500"
                            >
                              {{
                                t(
                                  "settings.account.publicProfile.requiresUsername"
                                )
                              }}
                            </span>
                          </FieldDescription>
                        </FieldContent>
                        <TooltipProvider v-if="!hasUsername">
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <span class="inline-block">
                                <Switch
                                  id="is-public"
                                  :model-value="isPublic"
                                  :disabled="!hasUsername"
                                  @update:model-value="toggleIsPublic"
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {{
                                t(
                                  "settings.account.publicProfile.requiresUsername"
                                )
                              }}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <Switch
                          v-else
                          id="is-public"
                          :model-value="isPublic"
                          @update:model-value="toggleIsPublic"
                        />
                      </Field>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel for="email">
                            {{ t("settings.account.email.label") }}
                            <TooltipProvider v-if="user?.emailVerified">
                              <Tooltip>
                                <TooltipTrigger as-child>
                                  <Badge variant="secondary">
                                    <IconBadgeCheck />
                                    {{ t("settings.account.email.verified") }}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {{ t("settings.account.email.verifiedDesc") }}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </FieldLabel>
                          <FieldDescription>
                            {{ user?.email }}
                          </FieldDescription>
                        </FieldContent>
                        <Button
                          v-if="!user?.emailVerified"
                          variant="secondary"
                          :disabled="sendingVerificationEmail"
                          @click="sendVerificationEmail"
                        >
                          <Spinner v-if="sendingVerificationEmail" />
                          {{ t("settings.account.email.verify") }}
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
                            <Avatar class="rounded-md">
                              <AvatarImage
                                class="rounded-md"
                                :src="provider?.photoURL!"
                                :alt="provider?.displayName"
                                referrerpolicy="no-referrer"
                              />
                              <AvatarFallback class="rounded-md">
                                {{ getInitials(provider.displayName!) }}
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
                                <TooltipContent side="right">
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
                            <span class="text-destructive text-xs">
                              {{
                                t("settings.account.deleteAccount.confirmLabel")
                              }}
                            </span>
                            <Input
                              v-model="deleteAccountInput"
                              :placeholder="'delete my account'"
                              :disabled="deletingAccount"
                            />
                            <AlertDialogFooter>
                              <AlertDialogCancel
                                @click="deleteAccountInput = ''"
                                >{{ t("common.cancel") }}</AlertDialogCancel
                              >
                              <AlertDialogAction
                                :disabled="
                                  deletingAccount || !isDeleteAccountInputValid
                                "
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
                      <FieldLabel>
                        {{ t("settings.notifications.categories.label") }}
                      </FieldLabel>
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
                value="members"
              >
                <div class="p-6">
                  <FieldGroup>
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel>Members</FieldLabel>
                          <FieldDescription>
                            Manage your team members and their roles.
                          </FieldDescription>
                        </FieldContent>
                        <Button
                          v-if="isOwner"
                          @click="openTeamDialog('invite')"
                        >
                          <IconPlus />
                          Invite Member
                        </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <div
                            v-if="isLoading"
                            class="flex justify-center py-8"
                          >
                            <Spinner />
                          </div>
                          <div v-else class="rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead class="w-1/4">User</TableHead>
                                  <TableHead class="w-1/4">Role</TableHead>
                                  <TableHead class="w-1/4">Joined</TableHead>
                                  <TableHead
                                    class="w-1/4 text-right"
                                  ></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                <TableRow
                                  v-for="member in teamMembers"
                                  :key="member.userId"
                                >
                                  <TableCell>
                                    <Item size="sm" class="p-0">
                                      <ItemMedia>
                                        <Avatar class="rounded-md">
                                          <AvatarImage
                                            class="rounded-md"
                                            :src="member.user?.photoURL!"
                                            :alt="member.user?.displayName"
                                            referrerpolicy="no-referrer"
                                          />
                                          <AvatarFallback class="rounded-md">
                                            {{
                                              getInitials(
                                                member.user?.displayName!
                                              )
                                            }}
                                          </AvatarFallback>
                                        </Avatar>
                                      </ItemMedia>
                                      <ItemContent class="gap-0.5 truncate">
                                        <ItemTitle class="truncate">
                                          {{ member.user?.displayName }}
                                        </ItemTitle>
                                        <ItemDescription
                                          class="truncate text-xs"
                                        >
                                          {{ member.user?.email }}
                                        </ItemDescription>
                                      </ItemContent>
                                    </Item>
                                  </TableCell>
                                  <TableCell class="capitalize">
                                    <TooltipProvider
                                      v-if="getCannotChangeRoleReason(member)"
                                    >
                                      <Tooltip>
                                        <TooltipTrigger as-child>
                                          <span class="inline-block">
                                            <Select
                                              :model-value="member.role"
                                              disabled
                                            >
                                              <SelectTrigger class="w-32">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="owner">
                                                  Owner
                                                </SelectItem>
                                                <SelectItem value="member">
                                                  Member
                                                </SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          {{
                                            t(
                                              getCannotChangeRoleReason(member)!
                                            )
                                          }}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <Select
                                      v-else
                                      :model-value="member.role"
                                      :disabled="isRoleLoading(member.userId)"
                                      @update:model-value="
                                        changeRole(
                                          member.userId,
                                          $event as 'owner' | 'member'
                                        )
                                      "
                                    >
                                      <SelectTrigger class="w-32">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="owner">
                                          Owner
                                        </SelectItem>
                                        <SelectItem value="member">
                                          Member
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell>
                                    {{ df.format(member.createdAt.toDate()) }}
                                  </TableCell>
                                  <TableCell
                                    class="flex items-center justify-end text-right"
                                  >
                                    <ButtonGroup>
                                      <TooltipProvider
                                        v-if="
                                          getCannotRemoveMemberReason(member)
                                        "
                                      >
                                        <Tooltip>
                                          <TooltipTrigger as-child>
                                            <span class="inline-block">
                                              <Button
                                                variant="outline"
                                                size="icon"
                                                disabled
                                              >
                                                <IconMoreHorizontal />
                                              </Button>
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {{
                                              t(
                                                getCannotRemoveMemberReason(
                                                  member
                                                )!
                                              )
                                            }}
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                      <DropdownMenu v-else>
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger as-child>
                                              <DropdownMenuTrigger as-child>
                                                <Button
                                                  variant="outline"
                                                  size="icon"
                                                  :disabled="
                                                    isMemberLoading(
                                                      member.userId
                                                    )
                                                  "
                                                >
                                                  <Spinner
                                                    v-if="
                                                      isMemberLoading(
                                                        member.userId
                                                      )
                                                    "
                                                  />
                                                  <IconMoreHorizontal v-else />
                                                </Button>
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent align="end">
                                                <AlertDialog>
                                                  <AlertDialogTrigger as-child>
                                                    <DropdownMenuItem
                                                      @select.prevent
                                                    >
                                                      <IconLogOut />
                                                      {{
                                                        member.userId ===
                                                        user?.uid
                                                          ? "Exit"
                                                          : "Remove"
                                                      }}
                                                    </DropdownMenuItem>
                                                  </AlertDialogTrigger>
                                                  <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                      <AlertDialogTitle>
                                                        {{
                                                          member.userId ===
                                                          user?.uid
                                                            ? "Exit Team"
                                                            : "Remove Member"
                                                        }}
                                                      </AlertDialogTitle>
                                                      <AlertDialogDescription>
                                                        {{
                                                          member.userId ===
                                                          user?.uid
                                                            ? "Are you sure you want to leave this team? You will lose access to all team resources."
                                                            : `Are you sure you want to remove ${member.user?.displayName || member.user?.email} from this team?`
                                                        }}
                                                      </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                      <AlertDialogCancel
                                                        >Cancel</AlertDialogCancel
                                                      >
                                                      <AlertDialogAction
                                                        variant="destructive"
                                                        :disabled="
                                                          isMemberLoading(
                                                            member.userId
                                                          )
                                                        "
                                                        @click="
                                                          removeMember(
                                                            member.userId
                                                          )
                                                        "
                                                      >
                                                        <Spinner
                                                          v-if="
                                                            isMemberLoading(
                                                              member.userId
                                                            )
                                                          "
                                                        />
                                                        {{
                                                          member.userId ===
                                                          user?.uid
                                                            ? "Exit"
                                                            : "Remove"
                                                        }}
                                                      </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                  </AlertDialogContent>
                                                </AlertDialog>
                                              </DropdownMenuContent>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              Actions
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </DropdownMenu>
                                    </ButtonGroup>
                                  </TableCell>
                                </TableRow>
                                <TableRow v-if="teamMembers.length === 0">
                                  <TableCell
                                    colspan="4"
                                    class="text-muted-foreground h-24 text-center"
                                  >
                                    No members found.
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        </FieldContent>
                      </Field>
                    </FieldSet>
                  </FieldGroup>
                </div>
              </TabsContent>
              <TabsContent
                class="overflow-auto overscroll-none scroll-smooth"
                value="teams"
              >
                <div class="p-6">
                  <FieldGroup>
                    <FieldSet>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel>Teams</FieldLabel>
                          <FieldDescription>
                            Manage your teams and switch between them.
                          </FieldDescription>
                        </FieldContent>
                        <Button @click="openTeamDialog('create')">
                          <IconPlus />
                          Create Team
                        </Button>
                      </Field>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <div
                            v-if="isLoading"
                            class="flex justify-center py-8"
                          >
                            <Spinner />
                          </div>
                          <div v-else class="rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead class="w-1/4">Team</TableHead>
                                  <TableHead class="w-1/4">Role</TableHead>
                                  <TableHead class="w-1/4">Created</TableHead>
                                  <TableHead
                                    class="w-1/4 text-right"
                                  ></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                <TableRow
                                  v-for="membership in memberships"
                                  :key="membership.teamId"
                                >
                                  <TableCell>
                                    <Item size="sm" class="p-0">
                                      <ItemMedia class="group relative">
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger as-child>
                                              <Avatar
                                                class="flex items-center justify-center rounded-md"
                                                @click="
                                                  handleTeamAvatarClick(
                                                    membership
                                                  )
                                                "
                                              >
                                                <template
                                                  v-if="
                                                    isTeamLoading(
                                                      `photo-${membership.teamId}`
                                                    )
                                                  "
                                                >
                                                  <Spinner />
                                                </template>
                                                <template v-else>
                                                  <AvatarImage
                                                    class="rounded-md"
                                                    :src="
                                                      membership.team?.photoURL!
                                                    "
                                                    :alt="membership.team?.name"
                                                  />
                                                  <AvatarFallback
                                                    class="rounded-md"
                                                  >
                                                    {{
                                                      getInitials(
                                                        membership.team?.name
                                                      )
                                                    }}
                                                  </AvatarFallback>
                                                </template>
                                              </Avatar>
                                            </TooltipTrigger>
                                            <TooltipContent
                                              v-if="membership.role === 'owner'"
                                            >
                                              {{
                                                isTeamLoading(
                                                  `photo-${membership.teamId}`
                                                )
                                                  ? "Uploading..."
                                                  : "Upload team photo"
                                              }}
                                            </TooltipContent>
                                          </Tooltip>
                                          <Tooltip
                                            v-if="
                                              membership.role === 'owner' &&
                                              membership.team?.photoURL
                                            "
                                          >
                                            <TooltipTrigger as-child>
                                              <Button
                                                variant="secondary"
                                                class="border-background absolute -top-2 -right-2 size-6 rounded-full border-2 p-2 opacity-0 transition group-hover:opacity-100"
                                                size="icon-sm"
                                                @click.stop="
                                                  handleRemoveTeamPhoto(
                                                    membership.teamId
                                                  )
                                                "
                                              >
                                                <IconX />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              Remove team photo
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </ItemMedia>
                                      <ItemContent class="gap-0.5 truncate">
                                        <ItemTitle class="truncate">
                                          {{ membership.team?.name }}
                                        </ItemTitle>
                                        <ItemDescription
                                          class="truncate text-xs"
                                        >
                                          {{
                                            t("settings.teams.memberCount", {
                                              count: getTeamMemberCount(
                                                membership.teamId
                                              ),
                                            })
                                          }}
                                        </ItemDescription>
                                      </ItemContent>
                                    </Item>
                                  </TableCell>
                                  <TableCell class="capitalize">
                                    {{ membership.role }}
                                  </TableCell>
                                  <TableCell>
                                    {{
                                      df.format(membership.createdAt.toDate())
                                    }}
                                  </TableCell>
                                  <TableCell
                                    class="flex items-center justify-end text-right"
                                  >
                                    <ButtonGroup>
                                      <ButtonGroup>
                                        <Button
                                          v-if="
                                            currentTeam?.id !==
                                            membership.team?.id
                                          "
                                          variant="outline"
                                          :disabled="
                                            isTeamLoading(membership.team?.id)
                                          "
                                          @click="
                                            switchTeam(membership.team?.id)
                                          "
                                        >
                                          <Spinner
                                            v-if="
                                              isTeamLoading(membership.team?.id)
                                            "
                                          />
                                          <template v-else>
                                            <IconSwitchHorizontal />
                                            Switch
                                          </template>
                                        </Button>
                                        <Button
                                          v-else
                                          variant="outline"
                                          disabled
                                        >
                                          <IconCheck />
                                          Current
                                        </Button>
                                      </ButtonGroup>
                                      <ButtonGroup>
                                        <DropdownMenu>
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger as-child>
                                                <DropdownMenuTrigger as-child>
                                                  <Button
                                                    variant="outline"
                                                    size="icon"
                                                  >
                                                    <IconMoreHorizontal />
                                                  </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent
                                                  align="end"
                                                >
                                                  <DropdownMenuItem
                                                    @click="
                                                      confirmExitTeam(
                                                        membership.team!
                                                      )
                                                    "
                                                  >
                                                    <IconLogOut />
                                                    Exit
                                                  </DropdownMenuItem>
                                                  <DropdownMenuSeparator
                                                    v-if="
                                                      membership.role ===
                                                      'owner'
                                                    "
                                                  />
                                                  <DropdownMenuItem
                                                    v-if="
                                                      membership.role ===
                                                      'owner'
                                                    "
                                                    @click="
                                                      startEditingTeam(
                                                        membership.team!
                                                      )
                                                    "
                                                  >
                                                    <IconPencil />
                                                    Edit
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem
                                                    v-if="
                                                      membership.role ===
                                                      'owner'
                                                    "
                                                    @click="
                                                      confirmDeleteTeam(
                                                        membership.team!
                                                      )
                                                    "
                                                  >
                                                    <IconTrash />
                                                    Delete
                                                  </DropdownMenuItem>
                                                </DropdownMenuContent>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                Actions
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        </DropdownMenu>
                                      </ButtonGroup>
                                    </ButtonGroup>
                                  </TableCell>
                                </TableRow>
                                <TableRow v-if="memberships.length === 0">
                                  <TableCell
                                    colspan="3"
                                    class="text-muted-foreground h-24 text-center"
                                  >
                                    No teams found.
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        </FieldContent>
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
                <Button variant="outline" @click="discardChanges">
                  {{ t("common.cancel") }}
                </Button>
              </DialogClose>
              <Button
                :disabled="isSaving || !hasPendingChanges"
                @click="saveAllChanges"
              >
                <Spinner v-if="isSaving" />
                {{ t("common.save") }}
              </Button>
            </DialogFooter>
          </div>
        </SidebarProvider>
      </Tabs>
      <AlertDialog v-model:open="isDeleteTeamDialogOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Team</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete
              <span class="text-foreground font-medium">{{
                teamToDelete?.name
              }}</span
              >? This action cannot be undone and will permanently delete the
              team and all its data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              :disabled="
                teamToDelete && isTeamLoading(`delete-${teamToDelete.id}`)
              "
              @click.prevent="handleDeleteTeam"
            >
              <Spinner
                v-if="
                  teamToDelete && isTeamLoading(`delete-${teamToDelete.id}`)
                "
              />
              Delete Team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog v-model:open="isExitTeamDialogOpen">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit Team</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to leave
              <span class="text-foreground font-medium">{{
                teamToExit?.name
              }}</span
              >? You will lose access to all team resources and need to be
              re-invited to rejoin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              :disabled="teamToExit && isTeamLoading(`exit-${teamToExit.id}`)"
              @click.prevent="handleExitTeam"
            >
              <Spinner
                v-if="teamToExit && isTeamLoading(`exit-${teamToExit.id}`)"
              />
              Exit Team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TeamDialog
        v-model:open="isTeamDialogOpen"
        :mode="teamDialogMode"
        :team="teamDialogTeam"
      />
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useUsernameAvailability } from "@/composables/useUsernameAvailability"
import {
  IconAlertTriangle,
  IconAtSign,
  IconBadgeCheck,
  IconCheck,
  IconGoogleIcon,
  IconKeyRound,
  IconPencil,
  IconX,
} from "@/data/icons"
import { withToast } from "@/helpers/toast"
import { getInitials } from "@/helpers/utilities"
import { logout } from "@/modules/auth"
import { claimUsername, releaseUsername } from "@/queries/username"
import { updateCurrentUserProfileVisibility } from "@/queries/userSettings"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IMembership } from "@/types/membership"
import {
  createUserMembershipsQuery,
  deleteUserPhotoFile,
  getUserPhotoStorageRef,
} from "@/utils/firebase/firebase-helpers"
import {
  USERNAME_MAX_LENGTH,
  usernamesMatch,
} from "@/utils/firebase/firebase-username"
import {
  deleteUser,
  sendEmailVerification,
  unlink,
  updatePassword,
  verifyBeforeUpdateEmail,
  type UserInfo,
} from "firebase/auth"
import { collection, deleteDoc, doc, getDocs } from "firebase/firestore"
import { toast } from "vue-sonner"
import {
  useCurrentUser,
  useDocument,
  useFirestore,
  useStorageFile,
} from "vuefire"

const { t } = useI18n()

const db = useFirestore()
const user = useCurrentUser()
const authStore = useAuthStore()

const userDocRef = computed(() => {
  if (!user.value?.uid) return null
  return doc(collection(db, "users"), user.value.uid)
})

const { data: userData } = useDocument(userDocRef)

const currentUsername = computed(() => userData.value?.username ?? "")
const currentIsPublic = computed(() => userData.value?.isPublic ?? false)

const optimisticUsername = ref<string | null>(null)
const optimisticIsPublic = ref<boolean | null>(null)
const hiddenProviderIds = ref<Set<string>>(new Set())
const optimisticPhotoPreview = ref<string | null>(null)

const effectiveUsername = computed(
  () => optimisticUsername.value ?? currentUsername.value
)

const isPublic = computed(
  () => optimisticIsPublic.value ?? currentIsPublic.value
)

const linkedProviders = computed(() => {
  const hidden = hiddenProviderIds.value
  return (user.value?.providerData ?? []).filter(
    (provider) => !hidden.has(provider.providerId)
  )
})

// ============================================================================
// Form State
// ============================================================================
const localDisplayName = ref(user.value?.displayName ?? "")
const localUsername = ref(effectiveUsername.value)
const usernameAvailability = useUsernameAvailability({
  getCurrentUsername: () => effectiveUsername.value,
})
const isCheckingUsername = usernameAvailability.isChecking
const usernameAvailable = usernameAvailability.available
const usernameError = usernameAvailability.error

// Sync with external state changes
watch(
  () => user.value?.displayName,
  (val) => {
    localDisplayName.value = val ?? ""
  }
)
watch(effectiveUsername, (val) => {
  localUsername.value = val
  usernameAvailability.reset()
})

watch(currentUsername, (value) => {
  if (
    optimisticUsername.value !== null &&
    usernamesMatch(value, optimisticUsername.value)
  ) {
    optimisticUsername.value = null
  }
})

watch(currentIsPublic, (value) => {
  if (optimisticIsPublic.value !== null && value === optimisticIsPublic.value) {
    optimisticIsPublic.value = null
  }
})
watch(
  () => (user.value?.providerData ?? []).map((provider) => provider.providerId),
  (providerIds) => {
    if (hiddenProviderIds.value.size === 0) return
    const available = new Set(providerIds)
    hiddenProviderIds.value = new Set(
      Array.from(hiddenProviderIds.value).filter((id) => available.has(id))
    )
  }
)

const hasPendingChanges = computed(() => {
  const displayNameChanged =
    localDisplayName.value !== (user.value?.displayName ?? "")
  const usernameChanged = !usernamesMatch(
    localUsername.value,
    effectiveUsername.value
  )
  return displayNameChanged || usernameChanged
})

// ============================================================================
// Save / Discard Actions
// ============================================================================
const isSaving = ref(false)

const saveChanges = async () => {
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
    if (!usernamesMatch(localUsername.value, effectiveUsername.value)) {
      if (usernameAvailable.value) {
        changesMade = true
        const previousOptimisticUsername = optimisticUsername.value
        const nextUsername = localUsername.value.trim()
        optimisticUsername.value = nextUsername
        try {
          await claimUsername(nextUsername)
        } catch (error) {
          optimisticUsername.value = previousOptimisticUsername
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

const discardChanges = () => {
  localDisplayName.value = user.value?.displayName ?? ""
  localUsername.value = effectiveUsername.value
  usernameAvailability.reset()
}

// ============================================================================
// Local state for username checking
// ============================================================================
// Check if user has a valid username set
const hasUsername = computed(() => {
  return usernameAvailability.hasMinimumLength(effectiveUsername.value)
})

const handleUsernameInput = () => {
  usernameAvailability.handleInput(localUsername.value)
}

// Disable public profile if username is removed
watch(hasUsername, (hasUser) => {
  if (!hasUser && isPublic.value) {
    const previousIsPublic = isPublic.value
    optimisticIsPublic.value = false
    updateCurrentUserProfileVisibility(false).catch((error) => {
      optimisticIsPublic.value = previousIsPublic
      console.error(error)
    })
  }
})

const isUpdatingPublicProfile = ref(false)

const toggleIsPublic = async (value: boolean) => {
  // Only allow enabling public profile if username is set
  if (value && !hasUsername.value) {
    toast.error("Cannot enable public profile", {
      description:
        "Please set a username first before making your profile public.",
    })
    return
  }

  const previousIsPublic = isPublic.value
  optimisticIsPublic.value = value
  isUpdatingPublicProfile.value = true

  try {
    await updateCurrentUserProfileVisibility(value)
    toast.success("Profile visibility updated")
  } catch (error) {
    optimisticIsPublic.value = previousIsPublic
    toast.error("Failed to update profile visibility", {
      description: (error as Error).message,
    })
  } finally {
    isUpdatingPublicProfile.value = false
  }
}

const displayPhotoURL = computed(
  () => optimisticPhotoPreview.value ?? user.value?.photoURL ?? null
)

const clearOptimisticPhotoPreview = () => {
  if (optimisticPhotoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(optimisticPhotoPreview.value)
  }
  optimisticPhotoPreview.value = null
}

onBeforeUnmount(() => {
  clearOptimisticPhotoPreview()
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

  try {
    const membershipStore = useMembershipStore()

    // 0. Verification: Ensure we have the latest state relative to memberships
    const membershipsSnapshot = await getDocs(
      createUserMembershipsQuery(user.value!.uid)
    )
    const membershipsToCheck = membershipsSnapshot.docs.map(
      (d) => d.data() as IMembership
    )
    const errors: string[] = []

    // 1. Validate: Check for sole ownership or sole membership errors across all teams
    for (const membership of membershipsToCheck) {
      if (!membership.teamId) continue

      // Fetch latest members to ensure accuracy
      const members = await membershipStore.getMembersForTeam(membership.teamId)
      const memberCount = members.length
      const owners = members.filter((m) => m.role === "owner")
      const teamName = membership.team?.name || "Unknown Team"

      if (memberCount <= 1) {
        errors.push(
          `You are the only member of the team '${teamName}'. Please delete the team first.`
        )
      } else if (membership.role === "owner" && owners.length <= 1) {
        errors.push(
          `You are the sole owner of the team '${teamName}'. Please transfer ownership or delete the team.`
        )
      }
    }

    if (errors.length > 0) {
      // Show the first error to the user
      toast.error("Cannot delete account", {
        description: errors[0],
      })
      // STOP: Do not proceed with any cleanup
      return
    }

    // 2. Cleanup: Remove user from all teams
    for (const membership of membershipsToCheck) {
      await membershipStore.removeMember(membership.teamId, user.value!.uid)
    }

    // 3. Release username
    if (userData.value?.username) {
      await releaseUsername(userData.value.username)
    }

    // 4. Cleanup Storage (Profile Photos)
    await Promise.allSettled([deleteUserPhotoFile(user.value!.uid)])

    // 5. Cleanup Firestore User Document
    if (userDocRef.value) {
      await deleteDoc(userDocRef.value)
    }

    // 6. Delete User Account
    await deleteUser(user.value!)
    toast.success("Account deleted", {
      description: "Your account has been successfully deleted.",
    })
  } catch (error) {
    handleAuthError(
      error as { code?: string; message?: string },
      "Failed to delete account"
    )
  } finally {
    deletingAccount.value = false
    deleteAccountInput.value = ""
  }
}

const unlinkingProviderMap = ref<Record<string, boolean>>({})
const unlinkProvider = async (providerId: string) => {
  const previousHiddenProviderIds = new Set(hiddenProviderIds.value)
  hiddenProviderIds.value = new Set(hiddenProviderIds.value).add(providerId)

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
      hiddenProviderIds.value = previousHiddenProviderIds
      handleAuthError(error, "Failed to unlink provider")
    })
    .finally(() => {
      unlinkingProviderMap.value = {
        ...unlinkingProviderMap.value,
        [providerId]: false,
      }
    })
}

const profilePhotoFileRef = computed(() => {
  if (!user.value?.uid) return null
  return getUserPhotoStorageRef(user.value.uid)
})

const { uploadProgress, uploadError, uploadTask, upload, refresh } =
  useStorageFile(profilePhotoFileRef)

const profilePhotoUpload = usePhotoUpload({
  canUpload: () => !!user.value?.uid,
  onUpload: async (_id, file) => {
    clearOptimisticPhotoPreview()
    optimisticPhotoPreview.value = URL.createObjectURL(file)
    try {
      await withToast(
        async () => {
          const uploadPromise = upload(file)
          if (!uploadPromise) {
            throw new Error("Unable to start profile photo upload.")
          }

          await uploadPromise
          const [nextPhotoURL] = await refresh()

          if (!nextPhotoURL) {
            throw new Error("Unable to resolve uploaded profile picture URL.")
          }

          await authStore.updateUserProfile({ photoURL: nextPhotoURL })
        },
        {
          info: "Uploading profile picture...",
          success: "Profile picture updated",
          error: "Failed to upload profile picture",
        }
      )
      clearOptimisticPhotoPreview()
    } catch (error) {
      clearOptimisticPhotoPreview()
      console.error("Error uploading picture or updating profile:", error)
    }
  },
})

const triggerProfilePhotoUpload = () => {
  if (!user.value?.uid) return
  profilePhotoUpload.triggerUpload(user.value.uid)
}

const handleRemoveProfilePicture = async () => {
  if (!user.value?.uid) return

  try {
    clearOptimisticPhotoPreview()
    await authStore.updateUserProfile({ photoURL: null })
    await deleteUserPhotoFile(user.value.uid)
    toast.success("Profile picture removed")
  } catch (error) {
    console.error("Error removing profile picture:", error)
    toast.error("Failed to remove profile picture", {
      description: (error as Error).message,
    })
  }
}

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
    (provider: UserInfo) => provider.providerId === "password"
  )
})
</script>

<template>
  <div class="flex grow flex-col justify-between">
    <div class="p-6">
      <FieldGroup>
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="profile-picture">
                {{ t("settings.account.profilePicture.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.profilePicture.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Avatar
                      class="flex size-10 cursor-pointer items-center justify-center rounded-md"
                      @click="triggerProfilePhotoUpload"
                    >
                      <template v-if="uploadError">
                        <IconAlertTriangle />
                      </template>
                      <template v-else>
                        <AvatarImage
                          class="rounded"
                          :src="displayPhotoURL || ''"
                          :alt="user?.displayName"
                          referrerpolicy="no-referrer"
                        />
                        <AvatarFallback class="rounded">
                          {{ getInitials(user?.displayName!) }}
                        </AvatarFallback>
                      </template>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      uploadTask
                        ? `${uploadProgress ? (uploadProgress * 100).toFixed(0) : 0}%`
                        : t("settings.account.profilePicture.upload")
                    }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      v-if="displayPhotoURL"
                      variant="secondary"
                      class="ring-background absolute -top-2 -right-2 size-4 rounded opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon-sm"
                      @click.stop="handleRemoveProfilePicture"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("settings.account.profilePicture.remove") }}
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
                {{ t("settings.account.preferredName.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex">
              <InputGroup>
                <InputGroupInput
                  id="name"
                  v-model="localDisplayName"
                  :label="t('settings.account.preferredName.inputLabel')"
                  :placeholder="t('settings.account.preferredName.placeholder')"
                />
                <InputGroupAddon align="inline-end">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <IconPencil />
                      </TooltipTrigger>
                      <TooltipContent>
                        {{ t("settings.account.preferredName.editPrompt") }}
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
                  :placeholder="t('settings.account.username.placeholder')"
                  :maxlength="USERNAME_MAX_LENGTH"
                  @input="handleUsernameInput"
                />
                <InputGroupAddon align="inline-end">
                  <TooltipProvider>
                    <Tooltip v-if="isCheckingUsername">
                      <TooltipTrigger as-child>
                        <Spinner />
                      </TooltipTrigger>
                      <TooltipContent>
                        {{ t("settings.account.username.checking") }}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip v-else-if="usernameAvailable === true">
                      <TooltipTrigger as-child>
                        <IconCheck class="text-green-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {{ t("settings.account.username.available") }}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip v-else-if="usernameAvailable === false">
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
                        {{ t("settings.account.username.checkPrompt") }}
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
                {{ t("settings.account.publicProfile.description") }}
              </FieldDescription>
            </FieldContent>
            <ButtonGroup>
              <ButtonGroup v-if="isUpdatingPublicProfile">
                <InputGroupButton variant="ghost" size="icon-xs" disabled>
                  <Spinner />
                </InputGroupButton>
              </ButtonGroup>
              <ButtonGroup>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <span class="inline-block">
                        <Switch
                          id="is-public"
                          :model-value="isPublic"
                          :disabled="!hasUsername || isUpdatingPublicProfile"
                          @update:model-value="toggleIsPublic"
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{
                        !hasUsername
                          ? t("settings.account.publicProfile.requiresUsername")
                          : isPublic
                            ? t("settings.account.publicProfile.availableAt", {
                                url: `/@${localUsername}`,
                              })
                            : t("settings.account.publicProfile.turnOnToEnable")
                      }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ButtonGroup>
            </ButtonGroup>
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
              <DialogTrigger as-child>
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
                    :placeholder="t('settings.account.email.newPlaceholder')"
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
              <DialogTrigger as-child>
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
                    :placeholder="t('settings.account.password.newPlaceholder')"
                  />
                </div>
                <DialogFooter>
                  <Button
                    :disabled="changingPassword || !newPassword"
                    @click="changePassword"
                  >
                    <Spinner v-if="changingPassword" />
                    <span>{{ t("settings.account.password.change") }}</span>
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
                {{ t("settings.account.identityProviders.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>
          <Field
            v-for="provider in linkedProviders"
            :key="provider.providerId"
            orientation="horizontal"
          >
            <FieldContent>
              <Item size="sm" class="p-0">
                <ItemMedia class="group relative">
                  <Avatar class="rounded">
                    <AvatarImage
                      class="rounded"
                      :src="provider?.photoURL!"
                      :alt="provider?.displayName"
                      referrerpolicy="no-referrer"
                    />
                    <AvatarFallback class="rounded">
                      {{ getInitials(provider.displayName!) }}
                    </AvatarFallback>
                  </Avatar>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="secondary"
                          class="ring-background absolute -right-2 -bottom-2 size-4 rounded ring-2"
                          size="icon-sm"
                        >
                          <IconGoogleIcon
                            v-if="provider.providerId === 'google.com'"
                          />
                          <IconKeyRound
                            v-else-if="provider.providerId === 'password'"
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {{ getComputedProviderName(provider.providerId) }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </ItemMedia>
                <ItemContent class="gap-0.5 truncate">
                  <ItemTitle class="truncate">
                    {{ provider.displayName }}
                  </ItemTitle>
                  <ItemDescription class="truncate text-xs">
                    {{ provider.email }}
                  </ItemDescription>
                </ItemContent>
              </Item>
            </FieldContent>
            <Button
              :disabled="unlinkingProviderMap[provider.providerId]"
              variant="secondary"
              @click="unlinkProvider(provider.providerId)"
            >
              <Spinner v-if="unlinkingProviderMap[provider.providerId]" />
              <span> {{ t("common.remove") }} </span>
            </Button>
          </Field>
          <div
            v-if="linkedProviders.length === 0"
            class="text-muted-foreground"
          >
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
                {{ t("settings.account.deleteAccount.description") }}
              </FieldDescription>
            </FieldContent>
            <AlertDialog>
              <AlertDialogTrigger as-child>
                <Button variant="destructive">
                  <Spinner v-if="deletingAccount" />
                  {{ t("settings.account.deleteAccount.title") }}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {{ t("settings.account.deleteAccount.title") }}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {{ t("settings.account.deleteAccount.confirm") }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <span class="text-destructive text-xs">
                  {{ t("settings.account.deleteAccount.confirmLabel") }}
                </span>
                <Input
                  v-model="deleteAccountInput"
                  :placeholder="'delete my account'"
                  :disabled="deletingAccount"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel @click="deleteAccountInput = ''">{{
                    t("common.cancel")
                  }}</AlertDialogCancel>
                  <AlertDialogAction
                    :disabled="deletingAccount || !isDeleteAccountInputValid"
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

    <!-- Footer with Save/Cancel -->
    <DialogFooter
      v-if="hasPendingChanges"
      class="bg-background/50 sticky bottom-3 z-10 m-3 flex items-center gap-2 rounded-md border p-2 backdrop-blur-lg"
    >
      <p class="text-muted-foreground mr-auto ml-2 text-xs">
        {{ t("settings.unsavedChanges") }}
      </p>
      <Button variant="secondary" :disabled="isSaving" @click="discardChanges">
        {{ t("common.discard") }}
      </Button>
      <Button :disabled="isSaving" @click="saveChanges">
        <Spinner v-if="isSaving" />
        {{ t("common.save") }}
      </Button>
    </DialogFooter>
  </div>
</template>

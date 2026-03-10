<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import {
  IconAlertTriangle,
  IconAtSign,
  IconCheck,
  IconPencil,
  IconX,
} from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { checkUsernameAvailability, claimUsername } from "@/queries/username"
import { updateCurrentUserProfileVisibility } from "@/queries/userSettings"
import { useAuthStore } from "@/stores/authStore"
import {
  deleteUserPhotoFile,
  getUserPhotoStorageRef,
} from "@/utils/firebase/firebase-helpers"
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernamesMatch,
  validateUsername,
} from "@/utils/firebase/firebase-username"
import { collection, doc } from "firebase/firestore"
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
const optimisticPhotoPreview = ref<string | null>(null)

const effectiveUsername = computed(
  () => optimisticUsername.value ?? currentUsername.value
)
const isPublic = computed(
  () => optimisticIsPublic.value ?? currentIsPublic.value
)

const localDisplayName = ref(user.value?.displayName ?? "")
const localUsername = ref(effectiveUsername.value)

watch(
  () => user.value?.displayName,
  (value) => {
    localDisplayName.value = value ?? ""
  }
)

watch(effectiveUsername, (value) => {
  localUsername.value = value
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

const hasPendingChanges = computed(() => {
  const displayNameChanged =
    localDisplayName.value !== (user.value?.displayName ?? "")
  const usernameChanged = !usernamesMatch(
    localUsername.value,
    effectiveUsername.value
  )
  return displayNameChanged || usernameChanged
})

const isSaving = ref(false)
const isCheckingUsername = ref(false)
const usernameAvailable = ref<boolean | null>(null)
const usernameError = ref<string | null>(null)

const hasUsername = computed(() => {
  const username = effectiveUsername.value
  return username.trim().length >= USERNAME_MIN_LENGTH
})

const checkUsername = async () => {
  const usernameInput = localUsername.value.trim()

  if (usernamesMatch(usernameInput, effectiveUsername.value)) {
    usernameAvailable.value = null
    usernameError.value = null
    return
  }

  const validation = validateUsername(usernameInput)
  if (!validation.valid) {
    usernameAvailable.value = false
    usernameError.value = validation.error
    return
  }

  usernameError.value = null
  isCheckingUsername.value = true
  usernameAvailable.value = await checkUsernameAvailability(usernameInput)
  if (!usernameAvailable.value) {
    usernameError.value = "Username is already taken"
  }
  isCheckingUsername.value = false
}

const debouncedCheckUsername = useDebounceFn(checkUsername, 500)

const handleUsernameInput = () => {
  debouncedCheckUsername()
}

const saveAccountDetails = async () => {
  isSaving.value = true
  const errors: string[] = []
  let changesMade = false

  try {
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

    if (!usernamesMatch(localUsername.value, effectiveUsername.value)) {
      const usernameInput = localUsername.value.trim()
      const validation = validateUsername(usernameInput)
      if (!validation.valid) {
        errors.push(`Username: ${validation.error}`)
      } else {
        changesMade = true
        const previousOptimisticUsername = optimisticUsername.value
        optimisticUsername.value = validation.normalized ?? usernameInput
        try {
          const isAvailable = await checkUsernameAvailability(usernameInput)
          if (!isAvailable) throw new Error("Username is already taken")
          await claimUsername(usernameInput)
        } catch (error) {
          optimisticUsername.value = previousOptimisticUsername
          errors.push(`Username: ${(error as Error).message}`)
        }
      }
    }

    if (errors.length > 0) {
      toast.error("Some changes could not be saved", {
        description: errors.join(", "),
      })
    } else {
      toast.success("Account details saved", {
        description: changesMade
          ? "Your onboarding account details are up to date."
          : "No changes to save.",
      })
    }
  } finally {
    isSaving.value = false
  }
}

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

const toggleIsPublic = async (value: boolean) => {
  if (value && !hasUsername.value) {
    toast.error("Cannot enable public profile", {
      description:
        "Please set a username first before making your profile public.",
    })
    return
  }

  const previousIsPublic = isPublic.value
  optimisticIsPublic.value = value

  try {
    await updateCurrentUserProfileVisibility(value)
    toast.success("Profile visibility updated")
  } catch (error) {
    optimisticIsPublic.value = previousIsPublic
    toast.error("Failed to update profile visibility", {
      description: (error as Error).message,
    })
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

const profilePhotoFileRef = computed(() => {
  if (!user.value?.uid) return null
  return getUserPhotoStorageRef(user.value.uid)
})

const { url, uploadProgress, uploadError, uploadTask, upload } =
  useStorageFile(profilePhotoFileRef)

const profilePhotoUpload = usePhotoUpload({
  canUpload: () => !!user.value?.uid,
  onUpload: async (_id, file) => {
    clearOptimisticPhotoPreview()
    optimisticPhotoPreview.value = URL.createObjectURL(file)
    toast.info("Uploading profile picture", {
      description: "Please wait while we upload your profile picture.",
    })
    try {
      await upload(file)
    } catch (error) {
      clearOptimisticPhotoPreview()
      toast.error("Failed to upload profile picture", {
        description: (error as Error).message,
      })
    }
  },
})

const triggerProfilePhotoUpload = () => {
  if (!user.value?.uid) return
  profilePhotoUpload.triggerUpload(user.value.uid)
}

watch(
  () => url.value,
  async (newVal, oldVal) => {
    if (oldVal === undefined) return
    if (!optimisticPhotoPreview.value) return
    if (!newVal || newVal === oldVal) return

    try {
      await authStore.updateUserProfile({ photoURL: newVal })
      clearOptimisticPhotoPreview()
      toast.success("Profile picture updated", {
        description: "Your profile picture has been updated successfully.",
      })
    } catch (error) {
      toast.error("Failed to update profile picture", {
        description: error as string,
      })
    }
  }
)

const handleRemoveProfilePicture = async () => {
  if (!user.value?.uid) return

  try {
    clearOptimisticPhotoPreview()
    await authStore.updateUserProfile({ photoURL: null })
    await deleteUserPhotoFile(user.value.uid)
    toast.success("Profile picture removed")
  } catch (error) {
    toast.error("Failed to remove profile picture", {
      description: (error as Error).message,
    })
  }
}
</script>

<template>
  <div class="p-4">
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
                        {{ getInitials(user?.displayName || "") }}
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
            <FieldLabel for="onboarding-preferred-name">
              {{ t("settings.account.preferredName.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.account.preferredName.description") }}
            </FieldDescription>
          </FieldContent>
          <div class="flex">
            <InputGroup>
              <InputGroupInput
                id="onboarding-preferred-name"
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
            <FieldLabel for="onboarding-username">
              {{ t("settings.account.username.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.account.username.description") }}
            </FieldDescription>
          </FieldContent>
          <div class="flex">
            <InputGroup>
              <InputGroupInput
                id="onboarding-username"
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
            <FieldLabel for="onboarding-is-public">
              {{ t("settings.account.publicProfile.label") }}
            </FieldLabel>
            <FieldDescription>
              {{ t("settings.account.publicProfile.description") }}
            </FieldDescription>
          </FieldContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <span class="inline-block">
                  <Switch
                    id="onboarding-is-public"
                    :model-value="isPublic"
                    :disabled="!hasUsername"
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
        </Field>
      </FieldSet>
    </FieldGroup>

    <div class="mt-4 flex justify-end">
      <Button
        :disabled="isSaving || !hasPendingChanges"
        @click="saveAccountDetails"
      >
        <Spinner v-if="isSaving" />
        {{ t("common.save") }}
      </Button>
    </div>
  </div>
</template>

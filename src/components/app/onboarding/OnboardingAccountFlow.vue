<script lang="ts" setup>
import { useProfilePhoto } from "@/composables/useProfilePhoto"
import { IconAtSign, IconCheck, IconPencil } from "@/data/icons"
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernamesMatch,
  validateUsername,
} from "@/helpers/username"
import { firestore } from "@/modules/firebase"
import { checkUsernameAvailability, claimUsername } from "@/queries/username"
import { updateCurrentUserProfileVisibility } from "@/queries/userSettings"
import { useAuthStore } from "@/stores/authStore"
import { collection, doc } from "firebase/firestore"
import { toast } from "vue-sonner"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { useCurrentUser } from "vuefire"

const { t } = useI18n()

const user = useCurrentUser()
const authStore = useAuthStore()

const userDocRef = computed(() => {
  if (!user.value?.uid) return null
  return doc(collection(firestore, "users"), user.value.uid)
})

const { data: userData } = useDocumentQuery(userDocRef)

const currentUsername = computed(() => userData.value?.username ?? "")
const currentIsPublic = computed(() => userData.value?.isPublic ?? false)

const optimisticUsername = ref<string | null>(null)
const optimisticIsPublic = ref<boolean | null>(null)

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
          if (!isAvailable)
            throw new Error(t("components.teamDialog.errors.usernameTaken"))
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
    toast.success(t("settings.account.publicProfile.visibilityUpdated"))
  } catch (error) {
    optimisticIsPublic.value = previousIsPublic
    toast.error(t("settings.account.publicProfile.visibilityUpdateFailed"), {
      description: (error as Error).message,
    })
  }
}

const { displayPhotoURL, isBusy, uploadProfilePhoto, removeProfilePhoto } =
  useProfilePhoto()
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
          <PhotoUploadAvatar
            class="size-10"
            :src="displayPhotoURL"
            :name="user?.displayName"
            :loading="isBusy"
            @upload="uploadProfilePhoto"
            @remove="removeProfilePhoto"
          />
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
          <div class="flex items-center gap-2">
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
          <div class="flex items-center gap-2">
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

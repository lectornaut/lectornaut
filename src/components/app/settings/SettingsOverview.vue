<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useTeamActions } from "@/composables/useTeamActions"
import { IconAtSign, IconCheck, IconPencil, IconX } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import { checkUsernameAvailability } from "@/queries/username"
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernamesMatch,
  validateUsername,
} from "@/utils/firebase/firebase-username"
import { toast } from "vue-sonner"

const {
  currentTeam,
  canUpdateTeam,
  getCannotUpdateTeamReason,
  loading: teamLoading,
  updateTeam,
  updateTeamPhoto,
  removeTeamPhoto,
} = useTeamActions()

const localTeamName = ref("")
const localTeamUsername = ref("")
const localTeamIsPublic = ref(false)
const isCheckingTeamUsername = ref(false)
const teamUsernameAvailable = ref<boolean | null>(null)
const teamUsernameError = ref<string | null>(null)
const isSaving = ref(false)

const currentTeamName = computed(() => currentTeam.value?.name ?? "")
const currentTeamUsername = computed(() => currentTeam.value?.username ?? "")
const currentTeamIsPublic = computed(() => currentTeam.value?.isPublic ?? false)

watch(
  [currentTeamName, currentTeamUsername, currentTeamIsPublic],
  ([name, username, isPublic]) => {
    localTeamName.value = name ?? ""
    localTeamUsername.value = username ?? ""
    localTeamIsPublic.value = isPublic ?? false
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
  },
  { immediate: true }
)

const hasTeamUsername = computed(() => {
  const usernameInput = localTeamUsername.value.trim()
  return usernameInput.length >= USERNAME_MIN_LENGTH
})

const hasValidTeamUsername = computed(() => {
  const usernameInput = localTeamUsername.value.trim()
  if (!usernameInput) return false
  return validateUsername(usernameInput).valid
})

watch(hasValidTeamUsername, (isValid) => {
  if (!isValid && localTeamIsPublic.value) {
    localTeamIsPublic.value = false
  }
})

const hasPendingChanges = computed(() => {
  const nameChanged = localTeamName.value.trim() !== currentTeamName.value
  const usernameChanged = !usernamesMatch(
    localTeamUsername.value,
    currentTeamUsername.value
  )
  const publicChanged = localTeamIsPublic.value !== currentTeamIsPublic.value
  return nameChanged || usernameChanged || publicChanged
})

const isTeamPhotoLoading = computed(() => {
  if (!currentTeam.value?.id) return false
  return teamLoading.team.isLoading(`photo-${currentTeam.value.id}`)
})

const isUpdatingOverview = computed(() => {
  if (!currentTeam.value?.id) return false
  return teamLoading.team.isLoading(`update-${currentTeam.value.id}`)
})

const canSave = computed(() => {
  const usernameInput = localTeamUsername.value.trim()

  if (usernameInput && !validateUsername(usernameInput).valid) {
    return false
  }

  if (
    teamUsernameAvailable.value === false &&
    !usernamesMatch(usernameInput, currentTeamUsername.value)
  ) {
    return false
  }

  return (
    !!currentTeam.value &&
    canUpdateTeam.value &&
    localTeamName.value.trim().length > 0 &&
    (!localTeamIsPublic.value || hasValidTeamUsername.value) &&
    hasPendingChanges.value
  )
})

const teamPhotoUpload = usePhotoUpload({
  canUpload: () => !!currentTeam.value?.id && canUpdateTeam.value,
  onUpload: (teamId, file) => updateTeamPhoto(teamId, file),
})

const triggerTeamPhotoUpload = () => {
  if (!currentTeam.value?.id || !canUpdateTeam.value) return
  teamPhotoUpload.triggerUpload(currentTeam.value.id)
}

const handleRemoveTeamPhoto = () => {
  if (!currentTeam.value?.id || !canUpdateTeam.value) return
  removeTeamPhoto(currentTeam.value.id)
}

const checkTeamUsername = async () => {
  const usernameInput = localTeamUsername.value.trim()

  if (!usernameInput) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }

  if (usernamesMatch(usernameInput, currentTeamUsername.value)) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }

  const validation = validateUsername(usernameInput)
  if (!validation.valid) {
    teamUsernameAvailable.value = false
    teamUsernameError.value = validation.error
    return
  }

  teamUsernameError.value = null
  isCheckingTeamUsername.value = true
  try {
    teamUsernameAvailable.value = await checkUsernameAvailability(usernameInput)
    if (!teamUsernameAvailable.value) {
      teamUsernameError.value = "Username is already taken"
    }
  } finally {
    isCheckingTeamUsername.value = false
  }
}

const debouncedCheckTeamUsername = useDebounceFn(checkTeamUsername, 500)

const handleTeamUsernameInput = () => {
  if (!localTeamUsername.value.trim()) {
    teamUsernameAvailable.value = null
    teamUsernameError.value = null
    return
  }
  debouncedCheckTeamUsername()
}

const toggleTeamIsPublic = (value: boolean) => {
  if (!canUpdateTeam.value) return

  if (value && !hasValidTeamUsername.value) {
    toast.error("Public team requires a valid username")
    return
  }

  localTeamIsPublic.value = value
}

const saveChanges = async () => {
  if (!canSave.value || !currentTeam.value) return
  isSaving.value = true

  try {
    const trimmedName = localTeamName.value.trim()
    const trimmedUsername = localTeamUsername.value.trim()
    let namePayload: string | undefined = undefined
    let usernamePayload: string | null | undefined = undefined
    let isPublicPayload: boolean | undefined = undefined

    if (trimmedName !== currentTeamName.value) {
      namePayload = trimmedName
    }

    if (!trimmedUsername) {
      if (currentTeamUsername.value) {
        usernamePayload = null
      }
    } else {
      const validation = validateUsername(trimmedUsername)
      if (!validation.valid || !validation.normalized) {
        teamUsernameAvailable.value = false
        teamUsernameError.value = validation.error || null
        toast.error("Invalid username", {
          description: validation.error || undefined,
        })
        return
      }

      if (
        !usernamesMatch(validation.normalized, currentTeamUsername.value) &&
        teamUsernameAvailable.value !== true
      ) {
        const isAvailable = await checkUsernameAvailability(
          validation.normalized
        )
        teamUsernameAvailable.value = isAvailable
        teamUsernameError.value = isAvailable
          ? null
          : "Username is already taken"

        if (!isAvailable) {
          toast.error("Username is already taken")
          return
        }
      }

      if (!usernamesMatch(validation.normalized, currentTeamUsername.value)) {
        usernamePayload = validation.normalized
      }
    }

    if (localTeamIsPublic.value && !trimmedUsername) {
      toast.error("Public team requires a username")
      return
    }

    if (localTeamIsPublic.value !== currentTeamIsPublic.value) {
      isPublicPayload = localTeamIsPublic.value
    }

    if (
      usernamePayload === null &&
      isPublicPayload === undefined &&
      currentTeamIsPublic.value
    ) {
      isPublicPayload = false
    }

    if (
      namePayload === undefined &&
      usernamePayload === undefined &&
      isPublicPayload === undefined
    ) {
      return
    }

    await updateTeam(currentTeam.value.id, {
      name: namePayload,
      username: usernamePayload,
      isPublic: isPublicPayload,
    })
  } finally {
    isSaving.value = false
  }
}

const discardChanges = () => {
  localTeamName.value = currentTeamName.value
  localTeamUsername.value = currentTeamUsername.value
  localTeamIsPublic.value = currentTeamIsPublic.value
  teamUsernameAvailable.value = null
  teamUsernameError.value = null
}
</script>

<template>
  <div class="flex flex-1 flex-col justify-between">
    <div class="p-6">
      <FieldGroup>
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="team-photo">Team Photo</FieldLabel>
              <FieldDescription>
                Upload a photo to represent your team.
              </FieldDescription>
            </FieldContent>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <span class="inline-flex">
                      <Avatar
                        class="flex size-10 items-center justify-center rounded-md"
                        :class="{
                          'cursor-pointer': canUpdateTeam,
                          'cursor-not-allowed opacity-60': !canUpdateTeam,
                        }"
                        @click="triggerTeamPhotoUpload"
                      >
                        <Spinner v-if="isTeamPhotoLoading" />
                        <template v-else>
                          <AvatarImage
                            class="rounded"
                            :src="currentTeam?.photoURL || ''"
                            :alt="currentTeam?.name || 'Team'"
                          />
                          <AvatarFallback class="rounded">
                            {{
                              getInitials(
                                localTeamName || currentTeam?.name || ""
                              )
                            }}
                          </AvatarFallback>
                        </template>
                      </Avatar>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{
                      canUpdateTeam
                        ? isTeamPhotoLoading
                          ? "Uploading..."
                          : "Upload team photo"
                        : getCannotUpdateTeamReason
                    }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip v-if="currentTeam?.photoURL && canUpdateTeam">
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute -top-2 -right-2 size-5 rounded opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon-sm"
                      @click.stop="handleRemoveTeamPhoto"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove team photo</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="team-name">Team Name</FieldLabel>
              <FieldDescription>
                Update the display name of your team.
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <div class="flex">
                    <InputGroup>
                      <InputGroupInput
                        id="team-name"
                        v-model="localTeamName"
                        placeholder="Team name"
                        :disabled="!canUpdateTeam || !currentTeam"
                        @keyup.enter="saveChanges"
                      />
                      <InputGroupAddon align="inline-end">
                        <IconPencil />
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                </TooltipTrigger>
                <TooltipContent v-if="!canUpdateTeam">
                  {{ getCannotUpdateTeamReason }}
                </TooltipContent>
                <TooltipContent v-else>Edit team name</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="team-username">Username</FieldLabel>
              <FieldDescription>
                Set a public handle for your team.
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <div class="flex">
                    <InputGroup>
                      <InputGroupInput
                        id="team-username"
                        v-model="localTeamUsername"
                        placeholder="team-handle"
                        :maxlength="USERNAME_MAX_LENGTH"
                        :disabled="!canUpdateTeam || !currentTeam"
                        @input="handleTeamUsernameInput"
                        @keyup.enter="saveChanges"
                      />
                      <InputGroupAddon align="inline-end">
                        <TooltipProvider>
                          <Tooltip v-if="isCheckingTeamUsername">
                            <TooltipTrigger as-child>
                              <Spinner class="size-4" />
                            </TooltipTrigger>
                            <TooltipContent>
                              Checking availability
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip v-else-if="teamUsernameAvailable === true">
                            <TooltipTrigger as-child>
                              <IconCheck class="text-green-500" />
                            </TooltipTrigger>
                            <TooltipContent
                              >Username is available</TooltipContent
                            >
                          </Tooltip>
                          <Tooltip v-else-if="teamUsernameAvailable === false">
                            <TooltipTrigger as-child>
                              <IconX class="text-red-500" />
                            </TooltipTrigger>
                            <TooltipContent>{{
                              teamUsernameError
                            }}</TooltipContent>
                          </Tooltip>
                          <Tooltip v-else>
                            <TooltipTrigger as-child>
                              <IconAtSign />
                            </TooltipTrigger>
                            <TooltipContent>
                              Use lowercase letters, numbers, and hyphens
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                </TooltipTrigger>
                <TooltipContent v-if="!canUpdateTeam">
                  {{ getCannotUpdateTeamReason }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="team-is-public">Public Team</FieldLabel>
              <FieldDescription>
                Allow anyone with the link to view this team.
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="inline-block">
                    <Switch
                      id="team-is-public"
                      :model-value="localTeamIsPublic"
                      :disabled="
                        !currentTeam || !canUpdateTeam || !hasValidTeamUsername
                      "
                      @update:model-value="toggleTeamIsPublic"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {{
                    !canUpdateTeam
                      ? getCannotUpdateTeamReason
                      : !hasTeamUsername
                        ? "Set a username to enable public access"
                        : localTeamIsPublic
                          ? `Public at /${localTeamUsername.trim()}`
                          : "Turn on to make this team public"
                  }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Field>
        </FieldSet>
      </FieldGroup>
    </div>

    <DialogFooter
      v-if="hasPendingChanges"
      class="bg-background/50 sticky bottom-3 m-3 flex items-center gap-2 rounded-md border p-2 backdrop-blur-lg"
    >
      <p class="text-muted-foreground mr-auto ml-2 text-xs">Unsaved changes</p>
      <Button variant="secondary" :disabled="isSaving" @click="discardChanges">
        Discard
      </Button>
      <Button
        :disabled="!canSave || isSaving || isUpdatingOverview"
        @click="saveChanges"
      >
        <Spinner v-if="isSaving || isUpdatingOverview" />
        Save
      </Button>
    </DialogFooter>
  </div>
</template>

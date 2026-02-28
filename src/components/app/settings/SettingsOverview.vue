<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useTeamActions } from "@/composables/useTeamActions"
import { useUsernameAvailability } from "@/composables/useUsernameAvailability"
import { IconAtSign, IconCheck, IconPencil, IconX } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import {
  USERNAME_MAX_LENGTH,
  usernamesMatch,
} from "@/utils/firebase/firebase-username"
import { toast } from "vue-sonner"

const { t } = useI18n()

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
const localUsername = ref("")
const optimisticTeamIsPublic = ref<boolean | null>(null)
const isSaving = ref(false)

const currentTeamName = computed(() => currentTeam.value?.name ?? "")
const currentUsername = computed(() => currentTeam.value?.username ?? "")
const currentIsPublic = computed(() => currentTeam.value?.isPublic ?? false)
const usernameAvailability = useUsernameAvailability({
  getCurrentUsername: () => currentUsername.value,
})
const isCheckingUsername = usernameAvailability.isChecking
const usernameAvailable = usernameAvailability.available
const usernameError = usernameAvailability.error
const isPublic = computed(
  () => optimisticTeamIsPublic.value ?? currentIsPublic.value
)

watch(
  currentTeamName,
  (name) => {
    localTeamName.value = name ?? ""
  },
  { immediate: true }
)

watch(
  currentUsername,
  (username) => {
    localUsername.value = username ?? ""
    usernameAvailability.reset()
  },
  { immediate: true }
)

watch(currentIsPublic, (value) => {
  if (
    optimisticTeamIsPublic.value !== null &&
    value === optimisticTeamIsPublic.value
  ) {
    optimisticTeamIsPublic.value = null
  }
})

const hasUsername = computed(() => {
  return usernameAvailability.hasMinimumLength(localUsername.value)
})

const hasValidUsername = computed(() => {
  return usernameAvailability.isValidUsername(localUsername.value)
})

const publicPath = computed(() => {
  const usernameInput = localUsername.value.trim()
  if (usernameAvailability.isValidUsername(usernameInput)) {
    return usernameInput
  }
  return currentUsername.value.trim()
})

const hasPendingChanges = computed(() => {
  const nameChanged = localTeamName.value.trim() !== currentTeamName.value
  const usernameChanged = !usernamesMatch(
    localUsername.value,
    currentUsername.value
  )
  return nameChanged || usernameChanged
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
  const usernameInput = localUsername.value.trim()

  if (usernameInput && !usernameAvailability.isValidUsername(usernameInput)) {
    return false
  }

  if (
    usernameAvailable.value === false &&
    !usernamesMatch(usernameInput, currentUsername.value)
  ) {
    return false
  }

  return (
    !!currentTeam.value &&
    canUpdateTeam.value &&
    localTeamName.value.trim().length > 0 &&
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

const handleUsernameInput = () => {
  usernameAvailability.handleInput(localUsername.value)
}

const resolveUsernamePayload = async (
  options: { requireUsername?: boolean } = {}
) => {
  const { requireUsername = false } = options
  const trimmedUsername = localUsername.value.trim()

  if (!trimmedUsername) {
    if (requireUsername) {
      throw new Error("Public team requires a username")
    }
    return currentUsername.value ? null : undefined
  }

  const result = await usernameAvailability.evaluate(trimmedUsername)
  if (result.state === "unchanged") {
    return undefined
  }

  if (result.state === "invalid" || result.state === "taken") {
    throw new Error(result.error || "Invalid username")
  }

  if (result.state === "available" && result.normalized) {
    return result.normalized
  }

  throw new Error("Invalid username")
}

const toggleIsPublic = async (value: boolean) => {
  if (!canUpdateTeam.value || !currentTeam.value) return

  let usernamePayload: string | null | undefined = undefined

  if (value) {
    try {
      usernamePayload = await resolveUsernamePayload({
        requireUsername: true,
      })
    } catch (error) {
      toast.error((error as Error).message)
      return
    }
  }

  if (value === currentIsPublic.value && usernamePayload === undefined) {
    return
  }

  optimisticTeamIsPublic.value = value

  try {
    await updateTeam(currentTeam.value.id, {
      ...(usernamePayload !== undefined ? { username: usernamePayload } : {}),
      isPublic: value,
    })
  } catch {
    optimisticTeamIsPublic.value = null
  }
}

const saveChanges = async () => {
  if (!canSave.value || !currentTeam.value) return
  isSaving.value = true

  try {
    const trimmedName = localTeamName.value.trim()
    let namePayload: string | undefined = undefined
    let usernamePayload: string | null | undefined = undefined
    let isPublicPayload: boolean | undefined = undefined

    if (trimmedName !== currentTeamName.value) {
      namePayload = trimmedName
    }

    try {
      usernamePayload = await resolveUsernamePayload()
    } catch (error) {
      toast.error((error as Error).message)
      return
    }

    if (
      usernamePayload === null &&
      isPublicPayload === undefined &&
      currentIsPublic.value
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
  localUsername.value = currentUsername.value
  usernameAvailability.reset()
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
                      class="ring-background absolute -top-2 -right-2 size-5 rounded opacity-0! ring-2 transition group-hover:enabled:opacity-100!"
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
                        v-model="localUsername"
                        :placeholder="
                          t('settings.account.username.placeholder')
                        "
                        :maxlength="USERNAME_MAX_LENGTH"
                        :disabled="!canUpdateTeam || !currentTeam"
                        @input="handleUsernameInput"
                        @keyup.enter="saveChanges"
                      />
                      <InputGroupAddon align="inline-end">
                        <TooltipProvider>
                          <Tooltip v-if="isCheckingUsername">
                            <TooltipTrigger as-child>
                              <Spinner class="size-4" />
                            </TooltipTrigger>
                            <TooltipContent>
                              Checking availability
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip v-else-if="usernameAvailable === true">
                            <TooltipTrigger as-child>
                              <IconCheck class="text-green-500" />
                            </TooltipTrigger>
                            <TooltipContent
                              >Username is available</TooltipContent
                            >
                          </Tooltip>
                          <Tooltip v-else-if="usernameAvailable === false">
                            <TooltipTrigger as-child>
                              <IconX class="text-red-500" />
                            </TooltipTrigger>
                            <TooltipContent>{{ usernameError }}</TooltipContent>
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
                      :model-value="isPublic"
                      :disabled="
                        !currentTeam ||
                        !canUpdateTeam ||
                        isUpdatingOverview ||
                        (!isPublic && !hasValidUsername)
                      "
                      @update:model-value="toggleIsPublic"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {{
                    !canUpdateTeam
                      ? getCannotUpdateTeamReason
                      : isPublic
                        ? publicPath
                          ? `Public at /${publicPath}`
                          : "Public team is enabled"
                        : !hasUsername
                          ? "Set a username to enable public access"
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

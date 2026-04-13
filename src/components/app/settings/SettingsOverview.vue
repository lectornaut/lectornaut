<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useTeamActions } from "@/composables/useTeamActions"
import { useUsernameAvailability } from "@/composables/useUsernameAvailability"
import { IconAtSign, IconCheck, IconPencil, IconX } from "@/data/icons"
import { USERNAME_MAX_LENGTH, usernamesMatch } from "@/helpers/username"
import { getInitials } from "@/helpers/utilities"
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
  <div class="flex grow flex-col justify-between">
    <div class="p-6">
      <FieldGroup>
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.overview.teamProfile.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.overview.teamProfile.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="team-photo">
                {{ t("settings.overview.teamPhoto.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.overview.teamPhoto.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <span class="inline-flex">
                      <Avatar
                        class="flex size-10 items-center justify-center"
                        :class="{
                          'cursor-pointer': canUpdateTeam,
                          'cursor-not-allowed opacity-60': !canUpdateTeam,
                        }"
                        @click="triggerTeamPhotoUpload"
                      >
                        <Spinner v-if="isTeamPhotoLoading" />
                        <template v-else>
                          <AvatarImage
                            :src="currentTeam?.photoURL || ''"
                            :alt="currentTeam?.name || 'Team'"
                          />
                          <AvatarFallback>
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
                          ? t("settings.overview.teamPhoto.uploading")
                          : t("settings.overview.teamPhoto.upload")
                        : getCannotUpdateTeamReason
                    }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip v-if="currentTeam?.photoURL && canUpdateTeam">
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute -top-2 -right-2 size-4 opacity-0! ring-2 transition group-hover:enabled:opacity-100!"
                      size="icon"
                      @click.stop="handleRemoveTeamPhoto"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{
                    t("settings.overview.teamPhoto.remove")
                  }}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="team-name">
                {{ t("settings.overview.teamName.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.overview.teamName.description") }}
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <div class="flex items-center gap-2">
                    <InputGroup>
                      <InputGroupInput
                        id="team-name"
                        v-model="localTeamName"
                        :placeholder="
                          t('settings.overview.teamName.placeholder')
                        "
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
                <TooltipContent v-else>{{
                  t("settings.overview.teamName.editPrompt")
                }}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Field>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.overview.publicIdentity.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.overview.publicIdentity.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="team-username">
                {{ t("settings.overview.username.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.overview.username.description") }}
              </FieldDescription>
            </FieldContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <div class="flex items-center gap-2">
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
                              <Spinner />
                            </TooltipTrigger>
                            <TooltipContent>
                              {{
                                t(
                                  "settings.overview.username.checkingAvailability"
                                )
                              }}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip v-else-if="usernameAvailable === true">
                            <TooltipTrigger as-child>
                              <IconCheck class="text-green-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              {{ t("settings.overview.username.available") }}
                            </TooltipContent>
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
                              {{ t("settings.overview.username.usernameHint") }}
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
              <FieldLabel for="team-is-public">
                {{ t("settings.overview.publicTeam.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.overview.publicTeam.description") }}
              </FieldDescription>
            </FieldContent>
            <InputGroupButton
              v-if="isUpdatingOverview"
              variant="ghost"
              size="icon-xs"
              disabled
            >
              <Spinner />
            </InputGroupButton>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span>
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
                          ? t("settings.overview.publicTeam.publicAt", {
                              path: publicPath,
                            })
                          : t("settings.overview.publicTeam.enabled")
                        : !hasUsername
                          ? t("settings.overview.publicTeam.requiresUsername")
                          : t("settings.overview.publicTeam.turnOnToEnable")
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
      class="bg-background/50 sticky bottom-3 z-10 m-3 flex items-center gap-2 border p-2 backdrop-blur-lg"
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

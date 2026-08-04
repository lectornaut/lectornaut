<script lang="ts" setup>
import { useDeviceSessions } from "@/composables/useDeviceSessions"
import { useLoadingState } from "@/composables/useLoadingState"
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useUsernameAvailability } from "@/composables/useUsernameAvailability"
import {
  IconAlertTriangle,
  IconAtSign,
  IconBadgeCheck,
  IconCheck,
  IconCircleDot,
  IconGoogleIcon,
  IconKeyRound,
  IconMonitor,
  IconPencil,
  IconSmartphone,
  IconTablet,
  IconX,
} from "@/data/icons"
import { verifyPhoneNumberWithRecaptcha } from "@/helpers/firebase-phone-verification"
import { withToast } from "@/helpers/toast"
import { USERNAME_MAX_LENGTH, usernamesMatch } from "@/helpers/username"
import { getInitials } from "@/helpers/utilities"
import { logout } from "@/modules/auth"
import { auth, firestore } from "@/modules/firebase"
import { emitter } from "@/modules/mitt"
import { claimUsername } from "@/queries/username"
import {
  deleteCurrentUserAccountData,
  updateCurrentUserProfileVisibility,
} from "@/queries/userSettings"
import { parseSafe } from "@/schemas/_utils"
import { membershipSchema } from "@/schemas/membership"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import type { IMembership } from "@/types/membership"
import {
  createUserMembershipsQuery,
  deleteUserPhotoFile,
  getUserPhotoStorageRef,
} from "@/utils/firebase/firebase-helpers"
import { formatTimeAgoIntl } from "@vueuse/core"
import {
  deleteUser,
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  sendEmailVerification,
  TotpMultiFactorGenerator,
  unlink,
  updatePassword,
  verifyBeforeUpdateEmail,
  type MultiFactorInfo,
  type PhoneInfoOptions,
  type TotpSecret,
  type UserInfo,
} from "firebase/auth"
import { collection, doc, getDocs } from "firebase/firestore"
import QRCode from "qrcode"
import { REGEXP_ONLY_DIGITS } from "vue-input-otp"
import { toast } from "vue-sonner"
import { useDocumentQuery } from "@/utils/firebase/firebase-query"
import { useCurrentUser, useStorageFile } from "vuefire"

const { t, locale } = useI18n()

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
      toast.error(t("settings.account.messages.someErrors"), {
        description: errors.join(", "),
      })
    } else {
      toast.success(t("settings.account.messages.settingsSaved"), {
        description: changesMade
          ? t("settings.account.messages.settingsSavedDesc")
          : t("settings.account.messages.noChangesToSave"),
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
    toast.error(t("settings.account.publicProfile.cannotEnable"), {
      description: t("settings.account.publicProfile.cannotEnableDescription"),
    })
    return
  }

  const previousIsPublic = isPublic.value
  optimisticIsPublic.value = value
  isUpdatingPublicProfile.value = true

  try {
    await updateCurrentUserProfileVisibility(value)
    toast.success(t("settings.account.publicProfile.visibilityUpdated"))
  } catch (error) {
    optimisticIsPublic.value = previousIsPublic
    toast.error(t("settings.account.publicProfile.visibilityUpdateFailed"), {
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
      toast.info(t("settings.account.messages.verificationSent"), {
        description: t("settings.account.messages.verificationSentDesc"),
      })
    })
    .catch((error) => {
      toast.error(t("settings.account.messages.verificationFailed"), {
        description: error.message,
      })
    })
    .finally(() => {
      sendingVerificationEmail.value = false
    })
}

// Helper function to handle auth errors that require recent login
const handleAuthError = async (error: unknown, defaultMessage: string) => {
  if (
    error instanceof Error &&
    "code" in error &&
    (error as { code: string }).code === "auth/requires-recent-login"
  ) {
    toast.error(t("settings.account.messages.reauthRequired"), {
      description: t("settings.account.messages.reauthRequiredDesc"),
      action: {
        label: t("settings.account.messages.reauthLogoutAction"),
        onClick: async () => {
          // Full logout and redirect to /enter
          await logout()
        },
      },
    })
    return true
  }
  const description = error instanceof Error ? error.message : undefined
  toast.error(defaultMessage, {
    description,
  })
  return false
}

const newEmail = ref("")
const changingEmail = ref(false)
const changeEmail = async () => {
  changingEmail.value = true

  await verifyBeforeUpdateEmail(user.value!, newEmail.value)
    .then(() => {
      toast.info(t("settings.account.messages.verificationSent"), {
        description: t("settings.account.messages.verificationSentDesc"),
      })
    })
    .catch((error) => {
      handleAuthError(error, t("settings.account.messages.verificationFailed"))
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
      toast.success(t("settings.account.messages.passwordUpdated"), {
        description: t("settings.account.messages.passwordUpdatedDesc"),
      })
      newPassword.value = ""
    })
    .catch((error) => {
      handleAuthError(
        error,
        t("settings.account.messages.passwordUpdateFailed")
      )
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
    toast.error(t("settings.account.deleteAccount.confirmRequired"))
    return
  }
  deletingAccount.value = true

  try {
    const membershipStore = useMembershipStore()

    // 0. Verification: Ensure we have the latest state relative to memberships
    const membershipsSnapshot = await getDocs(
      createUserMembershipsQuery(user.value!.uid)
    )
    const membershipsToCheck = membershipsSnapshot.docs
      .map((d) =>
        parseSafe(membershipSchema, d.data(), `membership:${d.ref.path}`)
      )
      .filter((m): m is IMembership => m !== null)
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
      toast.error(t("settings.account.messages.cannotDelete"), {
        description: errors[0],
      })
      // STOP: Do not proceed with any cleanup
      return
    }

    // 2. Cleanup: Remove user from all teams
    for (const membership of membershipsToCheck) {
      await membershipStore.removeMember(membership.teamId, user.value!.uid)
    }

    // 3. Cleanup Firestore account profile and username claim
    await deleteCurrentUserAccountData()

    // 4. Cleanup Storage (Profile Photos)
    await Promise.allSettled([deleteUserPhotoFile(user.value!.uid)])

    // 5. Delete User Account
    await deleteUser(user.value!)
    toast.success(t("settings.account.messages.accountDeleted"), {
      description: t("settings.account.deleteAccount.deletedDesc"),
    })
  } catch (error) {
    handleAuthError(error, t("settings.account.deleteAccount.failed"))
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
      toast.success(t("settings.account.identityProviders.unlinked"), {
        description: t("settings.account.identityProviders.unlinkedDesc"),
      })
    })
    .catch((error) => {
      hiddenProviderIds.value = previousHiddenProviderIds
      handleAuthError(error, t("settings.account.identityProviders.failed"))
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
            throw new Error(
              t("settings.account.profilePicture.uploadStartFailed")
            )
          }

          await uploadPromise
          const [nextPhotoURL] = await refresh()

          if (!nextPhotoURL) {
            throw new Error(
              t("settings.account.profilePicture.resolveUrlFailed")
            )
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
    toast.success(t("settings.account.profilePicture.removed"))
  } catch (error) {
    console.error("Error removing profile picture:", error)
    toast.error(t("settings.account.profilePicture.removeFailed"), {
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

// ============================================================================
// Multi-Factor Authentication
// ============================================================================
const mfaVersion = ref(0)
const enrolledFactors = computed<MultiFactorInfo[]>(() =>
  mfaVersion.value !== undefined && user.value
    ? multiFactor(user.value).enrolledFactors
    : []
)

const isMfaEnabled = computed(() => enrolledFactors.value.length > 0)

const hasTotpFactor = computed(() =>
  enrolledFactors.value.some(
    (f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID
  )
)

const hasSmsFactor = computed(() =>
  enrolledFactors.value.some(
    (f) => f.factorId === PhoneMultiFactorGenerator.FACTOR_ID
  )
)

const disablingMfa = ref(false)

const disableAllMfa = async () => {
  disablingMfa.value = true
  try {
    const mfa = multiFactor(user.value!)
    for (const factor of [...mfa.enrolledFactors]) {
      await mfa.unenroll(factor)
    }
    await user.value!.reload()
    mfaVersion.value++
    toast.success(t("settings.account.mfa.disabled"))
  } catch (error) {
    handleAuthError(error, t("settings.account.mfa.failedDisable"))
  } finally {
    disablingMfa.value = false
  }
}

const handleMfaToggle = (value: boolean) => {
  if (value) {
    // Can't enable without enrolling a factor — prompt user
    toast.info(t("settings.account.mfa.enrollFirst"))
  }
  // Turning off is handled by the AlertDialog on the switch
}

// TOTP enrollment
const totpDialogOpen = ref(false)
const totpStep = ref<"qr" | "verify">("qr")
const totpSecret = shallowRef<TotpSecret | null>(null)
const totpQrDataUrl = ref("")
const totpSecretKey = ref("")
const totpCode = ref("")
const totpDisplayName = ref("Authenticator app")
const totpLoading = ref(false)

const startTotpEnrollment = async () => {
  totpStep.value = "qr"
  totpCode.value = ""
  totpSecretKey.value = ""
  totpQrDataUrl.value = ""
  totpDisplayName.value = "Authenticator app"
  totpDialogOpen.value = true
  totpLoading.value = true

  try {
    const session = await multiFactor(user.value!).getSession()
    const secret = await TotpMultiFactorGenerator.generateSecret(session)
    totpSecret.value = secret
    totpSecretKey.value = secret.secretKey
    const qrUrl = secret.generateQrCodeUrl(
      user.value!.email ?? "",
      "Lectornaut"
    )
    totpQrDataUrl.value = await QRCode.toDataURL(qrUrl, {
      width: 200,
      margin: 1,
    })
  } catch (error) {
    handleAuthError(error, "Failed to generate authenticator secret")
    totpDialogOpen.value = false
  } finally {
    totpLoading.value = false
  }
}

const verifyTotpEnrollment = async () => {
  if (totpLoading.value) return
  totpLoading.value = true
  try {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
      totpSecret.value!,
      totpCode.value
    )
    await multiFactor(user.value!).enroll(assertion, totpDisplayName.value)
    await user.value!.reload()
    mfaVersion.value++
    toast.success(t("settings.account.mfa.totpEnrolled"))
    totpDialogOpen.value = false
  } catch (error) {
    handleAuthError(error, t("settings.account.mfa.failedTotpEnroll"))
  } finally {
    totpLoading.value = false
  }
}

// SMS enrollment
const smsDialogOpen = ref(false)
const smsStep = ref<"phone" | "verify">("phone")
const smsPhoneNumber = ref("")
const smsVerificationId = ref("")
const smsCode = ref("")
const smsDisplayName = ref("Phone")
const smsLoading = ref(false)
const smsRecaptchaContainerId = "settings-account-sms-recaptcha"
const startSmsEnrollment = () => {
  smsStep.value = "phone"
  smsPhoneNumber.value = ""
  smsCode.value = ""
  smsDisplayName.value = "Phone"
  smsDialogOpen.value = true
}

const sendSmsVerification = async () => {
  const phone = smsPhoneNumber.value.trim()
  if (!phone.startsWith("+") || phone.length < 8) {
    toast.error(t("settings.account.mfa.invalidPhoneNumber"))
    return
  }
  smsLoading.value = true
  try {
    const session = await multiFactor(user.value!).getSession()
    const phoneInfoOptions: PhoneInfoOptions = {
      phoneNumber: phone,
      session,
    }

    smsVerificationId.value = await verifyPhoneNumberWithRecaptcha(
      auth,
      phoneInfoOptions,
      smsRecaptchaContainerId
    )
    smsStep.value = "verify"
  } catch (error) {
    handleAuthError(error, t("settings.account.mfa.failedSmsSend"))
  } finally {
    smsLoading.value = false
  }
}

const verifySmsEnrollment = async () => {
  if (smsLoading.value) return
  smsLoading.value = true
  try {
    const cred = PhoneAuthProvider.credential(
      smsVerificationId.value,
      smsCode.value
    )
    const assertion = PhoneMultiFactorGenerator.assertion(cred)
    await multiFactor(user.value!).enroll(assertion, smsDisplayName.value)
    await user.value!.reload()
    mfaVersion.value++
    toast.success(t("settings.account.mfa.smsEnrolled"))
    smsDialogOpen.value = false
  } catch (error) {
    handleAuthError(error, t("settings.account.mfa.failedSmsEnroll"))
  } finally {
    smsLoading.value = false
  }
}

// Unenroll
const unenrollingFactorUid = ref<string | null>(null)

const getPhoneFactorNumber = (factor: MultiFactorInfo) =>
  (factor as { phoneNumber?: string }).phoneNumber

const getFactorTypeLabel = (factor: MultiFactorInfo) => {
  if (factor.factorId === TotpMultiFactorGenerator.FACTOR_ID) {
    return t("settings.account.mfa.authenticatorApp")
  }
  if (factor.factorId === PhoneMultiFactorGenerator.FACTOR_ID) {
    return t("settings.account.mfa.phone")
  }
  return factor.factorId
}

const getFactorTitle = (factor: MultiFactorInfo) => {
  if (factor.factorId === PhoneMultiFactorGenerator.FACTOR_ID) {
    return getFactorTypeLabel(factor)
  }
  return factor.displayName || getFactorTypeLabel(factor)
}

const getFactorDescription = (factor: MultiFactorInfo) => {
  if (factor.factorId === PhoneMultiFactorGenerator.FACTOR_ID) {
    const phoneNumber = getPhoneFactorNumber(factor)
    const displayName = factor.displayName?.trim()

    if (phoneNumber && displayName) {
      return `${phoneNumber} (${displayName})`
    }

    return phoneNumber || displayName || getFactorTypeLabel(factor)
  }

  return getFactorTypeLabel(factor)
}

const unenrollFactor = async (factor: MultiFactorInfo) => {
  unenrollingFactorUid.value = factor.uid
  try {
    await multiFactor(user.value!).unenroll(factor)
    await user.value!.reload()
    mfaVersion.value++
    toast.success(
      t("settings.account.mfa.factorRemoved", {
        name: getFactorTitle(factor),
      })
    )
  } catch (error) {
    handleAuthError(error, t("settings.account.mfa.failedUnenroll"))
  } finally {
    unenrollingFactorUid.value = null
  }
}

// ============================================================================
// Device Sessions
// ============================================================================
const {
  sessions,
  pending: sessionsPending,
  isCurrentSession,
  revokeAllOtherSessions,
  revokeSingleSession,
} = useDeviceSessions()

const { isLoading: isRevoking, withLoadingResult } = useLoadingState<string>()
const sessionNow = useNow({ interval: 60_000 })
const sessionTimeAgoOptions = computed(() => ({
  locale: locale.value,
  relativeTimeFormatOptions: {
    numeric: "auto" as const,
  },
}))

const sessionRows = computed(() =>
  sessions.value.map((session) => {
    const isCurrent = isCurrentSession(session.id)
    const lastActiveAt = session.lastActiveAt?.toDate?.()

    return {
      ...session,
      id: session.id,
      deviceIcon: getDeviceIcon(session.deviceType),
      isCurrent,
      lastActiveLabel: lastActiveAt
        ? formatTimeAgoIntl(
            lastActiveAt,
            sessionTimeAgoOptions.value,
            sessionNow.value
          )
        : t("settings.account.devices.lastActiveUnknown"),
    }
  })
)

const otherSessionCount = computed(
  () => sessionRows.value.filter((session) => !session.isCurrent).length
)

const handleRevokeAll = async () => {
  const { data: result, error } = await withLoadingResult("revokeAll", () =>
    revokeAllOtherSessions()
  )
  if (error) {
    toast.error(t("settings.account.devices.failedLogoutAll"), {
      description: error.message,
    })
  } else if (result) {
    toast.success(t("settings.account.devices.loggedOutAll"), {
      description: t("settings.account.devices.loggedOutAllDesc", {
        count: result.data.count,
      }),
    })
  }
}

const handleRevokeSession = async (sessionId: string) => {
  const { error } = await withLoadingResult(sessionId, () =>
    revokeSingleSession(sessionId)
  )
  if (error) {
    toast.error(t("settings.account.devices.failedLogoutDevice"), {
      description: error.message,
    })
  } else {
    toast.success(t("settings.account.devices.loggedOutDevice"), {
      description: t("settings.account.devices.loggedOutDeviceDesc"),
    })
  }
}

const getDeviceIcon = (deviceType: string) => {
  switch (deviceType) {
    case "mobile":
      return IconSmartphone
    case "tablet":
      return IconTablet
    default:
      return IconMonitor
  }
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
                {{ t("settings.account.profile.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.profile.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>
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
                    <AppAvatar
                      class="size-10 cursor-pointer"
                      :src="uploadError ? null : displayPhotoURL"
                      :name="user?.displayName"
                      @click="triggerProfilePhotoUpload"
                    >
                      <template #fallback>
                        <IconAlertTriangle v-if="uploadError" />
                        <template v-else>{{
                          getInitials(user?.displayName!)
                        }}</template>
                      </template>
                    </AppAvatar>
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
                      class="ring-background absolute -top-2 -right-2 size-4 opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon"
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
            <div class="flex items-center gap-2">
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
              <FieldLabel>
                {{ t("settings.account.publicIdentity.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.publicIdentity.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel for="username">
                {{ t("settings.account.username.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.username.description") }}
              </FieldDescription>
            </FieldContent>
            <div class="flex items-center gap-2">
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
              <FieldLabel>
                {{ t("settings.account.signIn.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.signIn.description") }}
              </FieldDescription>
            </FieldContent>
          </Field>
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
                    data-dialog-action
                    :disabled="changingEmail || !newEmail"
                    @click="changeEmail"
                  >
                    <Spinner v-if="changingEmail" />
                    <span>{{
                      t("settings.account.email.sendVerification")
                    }}</span>
                    <Kbd>↩</Kbd>
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
                    data-dialog-action
                    :disabled="changingPassword || !newPassword"
                    @click="changePassword"
                  >
                    <Spinner v-if="changingPassword" />
                    <span>{{ t("settings.account.password.change") }}</span>
                    <Kbd>↩</Kbd>
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
          <ItemGroup v-if="linkedProviders.length > 0">
            <Item
              v-for="provider in linkedProviders"
              :key="provider.providerId"
              variant="muted"
              size="xs"
            >
              <ItemMedia class="group relative">
                <AppAvatar
                  :src="provider?.photoURL"
                  :name="provider?.displayName"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        variant="secondary"
                        class="ring-background absolute -right-2 -bottom-2 size-4 ring-2"
                        size="icon"
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
              <ItemContent>
                <ItemTitle>
                  {{ provider.displayName }}
                </ItemTitle>
                <ItemDescription class="text-xs">
                  {{ provider.email }}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <AlertDialog>
                  <AlertDialogTrigger as-child>
                    <Button
                      :disabled="unlinkingProviderMap[provider.providerId]"
                      variant="secondary"
                    >
                      <Spinner
                        v-if="unlinkingProviderMap[provider.providerId]"
                      />
                      <span> {{ t("common.remove") }} </span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {{
                          t(
                            "settings.account.identityProviders.removeConfirmTitle"
                          )
                        }}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {{
                          t(
                            "settings.account.identityProviders.removeConfirmDescription",
                            {
                              name: getComputedProviderName(
                                provider.providerId
                              ),
                            }
                          )
                        }}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {{ t("common.cancel") }}
                        <Kbd>Esc</Kbd>
                      </AlertDialogCancel>
                      <AlertDialogAction
                        :disabled="unlinkingProviderMap[provider.providerId]"
                        @click="unlinkProvider(provider.providerId)"
                      >
                        <Spinner
                          v-if="unlinkingProviderMap[provider.providerId]"
                        />
                        {{ t("common.remove") }}
                        <Kbd>↩</Kbd>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </ItemActions>
            </Item>
          </ItemGroup>
          <Empty
            v-if="linkedProviders.length === 0"
            orientation="horizontal"
            class="border border-dashed"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconKeyRound />
              </EmptyMedia>
              <EmptyTitle>
                {{ t("settings.account.identityProviders.noAccounts") }}
              </EmptyTitle>
              <EmptyDescription>
                {{ t("settings.account.identityProviders.description") }}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </FieldSet>
        <FieldSeparator />
        <!-- Multi-Factor Authentication -->
        <FieldSet>
          <!-- MFA enable/disable switch -->
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.account.mfa.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.mfa.description") }}
              </FieldDescription>
            </FieldContent>
            <ButtonGroup>
              <ButtonGroup v-if="disablingMfa">
                <InputGroupButton variant="ghost" size="icon-xs" disabled>
                  <Spinner />
                </InputGroupButton>
              </ButtonGroup>
              <ButtonGroup>
                <!-- When enabled, wrap switch in AlertDialog for disable confirmation -->
                <AlertDialog v-if="isMfaEnabled">
                  <AlertDialogTrigger as-child>
                    <span class="inline-block">
                      <Switch :model-value="true" :disabled="disablingMfa" />
                    </span>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {{ t("settings.account.mfa.disableConfirmTitle") }}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {{
                          t("settings.account.mfa.disableConfirmDescription")
                        }}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {{ t("common.cancel") }}
                        <Kbd>Esc</Kbd>
                      </AlertDialogCancel>
                      <AlertDialogAction
                        :disabled="disablingMfa"
                        @click="disableAllMfa"
                      >
                        <Spinner v-if="disablingMfa" />
                        {{ t("settings.account.mfa.disable") }}
                        <Kbd>↩</Kbd>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <!-- When disabled, switch prompts to enroll first -->
                <TooltipProvider v-else>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <span class="inline-block">
                        <Switch
                          :model-value="false"
                          @update:model-value="handleMfaToggle"
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ t("settings.account.mfa.enrollFirst") }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </ButtonGroup>
            </ButtonGroup>
          </Field>

          <!-- Enrolled factors -->
          <Field
            v-for="factor in enrolledFactors"
            :key="factor.uid"
            orientation="horizontal"
          >
            <FieldContent>
              <FieldLabel>
                {{ getFactorTitle(factor) }}
              </FieldLabel>
              <FieldDescription>
                {{ getFactorDescription(factor) }}
              </FieldDescription>
            </FieldContent>
            <AlertDialog>
              <AlertDialogTrigger as-child>
                <Button
                  variant="secondary"
                  :disabled="unenrollingFactorUid === factor.uid"
                >
                  <Spinner v-if="unenrollingFactorUid === factor.uid" />
                  {{ t("common.remove") }}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {{ t("settings.account.mfa.removeConfirmTitle") }}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {{
                      t("settings.account.mfa.removeConfirmDescription", {
                        name: getFactorTitle(factor),
                      })
                    }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {{ t("common.cancel") }}
                    <Kbd>Esc</Kbd>
                  </AlertDialogCancel>
                  <AlertDialogAction
                    :disabled="unenrollingFactorUid === factor.uid"
                    @click="unenrollFactor(factor)"
                  >
                    <Spinner v-if="unenrollingFactorUid === factor.uid" />
                    {{ t("common.remove") }}
                    <Kbd>↩</Kbd>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Field>

          <!-- Add authenticator app (only if not already enrolled) -->
          <Field v-if="!hasTotpFactor" orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.account.mfa.addAuthenticator") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.mfa.addAuthenticatorDescription") }}
              </FieldDescription>
            </FieldContent>
            <Button variant="outline" @click="startTotpEnrollment">
              {{ t("common.add") }}
            </Button>
          </Field>

          <!-- Add phone number (only if not already enrolled) -->
          <Field v-if="!hasSmsFactor" orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.account.mfa.addPhone") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.mfa.addPhoneDescription") }}
              </FieldDescription>
            </FieldContent>
            <Button variant="outline" @click="startSmsEnrollment">
              {{ t("common.add") }}
            </Button>
          </Field>
        </FieldSet>
        <!-- TOTP Enrollment Dialog -->
        <Dialog v-model:open="totpDialogOpen">
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {{ t("settings.account.mfa.totpDialogTitle") }}
              </DialogTitle>
              <DialogDescription>
                {{ t("settings.account.mfa.totpDialogDescription") }}
              </DialogDescription>
            </DialogHeader>

            <!-- QR code step -->
            <div
              v-if="totpStep === 'qr'"
              class="flex flex-col items-center gap-4"
            >
              <LoadingState v-if="totpLoading" />
              <img v-else :src="totpQrDataUrl" alt="QR Code" />
              <p class="text-muted-foreground text-center text-sm">
                {{ t("settings.account.mfa.scanQrDescription") }}
              </p>
              <!-- Manual entry fallback -->
              <div
                v-if="totpSecretKey && !totpLoading"
                class="w-full text-center"
              >
                <p class="text-muted-foreground mb-1 text-xs">
                  {{ t("settings.account.mfa.manualEntry") }}
                </p>
                <code class="bg-mutedpx-2 py-1 text-xs break-all select-all">
                  {{ totpSecretKey }}
                </code>
              </div>
            </div>

            <!-- Verify step -->
            <div v-if="totpStep === 'verify'" class="flex flex-col gap-4">
              <Field>
                <FieldLabel>
                  {{ t("settings.account.mfa.enterTotpCode") }}
                </FieldLabel>
                <InputOTP
                  v-model="totpCode"
                  :maxlength="6"
                  :pattern="REGEXP_ONLY_DIGITS"
                  @complete="verifyTotpEnrollment"
                >
                  <InputOTPGroup>
                    <InputOTPSlot :index="0" />
                    <InputOTPSlot :index="1" />
                    <InputOTPSlot :index="2" />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot :index="3" />
                    <InputOTPSlot :index="4" />
                    <InputOTPSlot :index="5" />
                  </InputOTPGroup>
                </InputOTP>
              </Field>
              <Field>
                <FieldLabel>
                  {{ t("settings.account.mfa.displayNamePlaceholder") }}
                </FieldLabel>
                <Input
                  v-model="totpDisplayName"
                  :placeholder="
                    t('settings.account.mfa.displayNamePlaceholder')
                  "
                />
              </Field>
            </div>

            <DialogFooter>
              <Button
                v-if="totpStep === 'qr'"
                data-dialog-action
                :disabled="totpLoading"
                @click="totpStep = 'verify'"
              >
                {{ t("common.next") }}
                <Kbd>↩</Kbd>
              </Button>
              <Button
                v-if="totpStep === 'verify'"
                data-dialog-action
                :disabled="totpCode.length < 6 || totpLoading"
                @click="verifyTotpEnrollment"
              >
                <Spinner v-if="totpLoading" />
                {{ t("settings.account.mfa.verify") }}
                <Kbd>↩</Kbd>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <!-- SMS Enrollment Dialog -->
        <Dialog v-model:open="smsDialogOpen">
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {{ t("settings.account.mfa.smsDialogTitle") }}
              </DialogTitle>
              <DialogDescription>
                {{ t("settings.account.mfa.smsDialogDescription") }}
              </DialogDescription>
            </DialogHeader>

            <!-- Phone number step -->
            <div v-if="smsStep === 'phone'" class="flex flex-col gap-4">
              <Field>
                <FieldLabel>
                  {{ t("settings.account.mfa.phone") }}
                </FieldLabel>
                <Input
                  v-model="smsPhoneNumber"
                  :placeholder="t('settings.account.mfa.phonePlaceholder')"
                  type="tel"
                  @keydown.enter="
                    smsPhoneNumber && !smsLoading && sendSmsVerification()
                  "
                />
              </Field>
              <div :id="smsRecaptchaContainerId" class="hidden" />
            </div>

            <!-- Verify step -->
            <div v-if="smsStep === 'verify'" class="flex flex-col gap-4">
              <Field>
                <FieldLabel>
                  {{
                    t("settings.account.mfa.enterSmsCode", {
                      phone: smsPhoneNumber,
                    })
                  }}
                </FieldLabel>
                <InputOTP
                  v-model="smsCode"
                  :maxlength="6"
                  :pattern="REGEXP_ONLY_DIGITS"
                  @complete="verifySmsEnrollment"
                >
                  <InputOTPGroup>
                    <InputOTPSlot :index="0" />
                    <InputOTPSlot :index="1" />
                    <InputOTPSlot :index="2" />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot :index="3" />
                    <InputOTPSlot :index="4" />
                    <InputOTPSlot :index="5" />
                  </InputOTPGroup>
                </InputOTP>
              </Field>
              <Field>
                <FieldLabel>
                  {{ t("settings.account.mfa.displayNamePlaceholder") }}
                </FieldLabel>
                <Input
                  v-model="smsDisplayName"
                  :placeholder="
                    t('settings.account.mfa.displayNamePlaceholder')
                  "
                />
              </Field>
            </div>

            <DialogFooter>
              <Button
                v-if="smsStep === 'phone'"
                data-dialog-action
                :disabled="!smsPhoneNumber || smsLoading"
                @click="sendSmsVerification"
              >
                <Spinner v-if="smsLoading" />
                {{ t("settings.account.mfa.sendCode") }}
                <Kbd>↩</Kbd>
              </Button>
              <Button
                v-if="smsStep === 'verify'"
                data-dialog-action
                :disabled="smsCode.length < 6 || smsLoading"
                @click="verifySmsEnrollment"
              >
                <Spinner v-if="smsLoading" />
                {{ t("settings.account.mfa.verify") }}
                <Kbd>↩</Kbd>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <FieldSeparator />
        <FieldSet>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>
                {{ t("settings.account.devices.label") }}
              </FieldLabel>
              <FieldDescription>
                {{ t("settings.account.devices.logoutAllDescription") }}
              </FieldDescription>
            </FieldContent>
            <AlertDialog>
              <AlertDialogTrigger as-child>
                <Button
                  variant="outline"
                  :disabled="isRevoking('revokeAll') || otherSessionCount === 0"
                >
                  <Spinner v-if="isRevoking('revokeAll')" />
                  {{ t("settings.account.devices.logoutAllButton") }}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {{ t("settings.account.devices.logoutAllConfirmTitle") }}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {{
                      t(
                        "settings.account.devices.logoutAllConfirmDescription",
                        {
                          count: otherSessionCount,
                        }
                      )
                    }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {{ t("common.cancel") }}
                    <Kbd>Esc</Kbd>
                  </AlertDialogCancel>
                  <AlertDialogAction
                    :disabled="isRevoking('revokeAll')"
                    @click="handleRevokeAll"
                  >
                    <Spinner v-if="isRevoking('revokeAll')" />
                    {{ t("settings.account.devices.logoutAllButton") }}
                    <Kbd>↩</Kbd>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Field>
          <ItemGroup v-if="sessionRows.length > 0">
            <Item
              v-for="session in sessionRows"
              :key="session.id"
              variant="muted"
              size="xs"
            >
              <ItemMedia>
                <Component :is="session.deviceIcon" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {{ session.deviceName }}
                </ItemTitle>
                <ItemDescription class="text-xs">
                  {{ session.ip }}
                  ·
                  {{
                    t("settings.account.devices.lastActive", {
                      time: session.lastActiveLabel,
                    })
                  }}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <div class="flex items-center gap-2">
                  <template v-if="session.isCurrent">
                    <Badge variant="destructive">
                      <IconCircleDot class="-ml-1" />
                      {{ t("settings.account.devices.thisDevice") }}
                    </Badge>
                    <Button
                      variant="secondary"
                      @click="emitter.emit('Dialog.Exit.Open')"
                    >
                      {{ t("settings.account.devices.logoutDevice") }}
                    </Button>
                  </template>
                  <AlertDialog v-else>
                    <AlertDialogTrigger as-child>
                      <Button
                        variant="secondary"
                        :disabled="isRevoking(session.id)"
                      >
                        <Spinner v-if="isRevoking(session.id)" />
                        {{ t("settings.account.devices.logoutDevice") }}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {{
                            t(
                              "settings.account.devices.logoutDeviceConfirmTitle"
                            )
                          }}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {{
                            t(
                              "settings.account.devices.logoutDeviceConfirmDescription",
                              { device: session.deviceName }
                            )
                          }}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {{ t("common.cancel") }}
                          <Kbd>Esc</Kbd>
                        </AlertDialogCancel>
                        <AlertDialogAction
                          :disabled="isRevoking(session.id)"
                          @click="handleRevokeSession(session.id)"
                        >
                          <Spinner v-if="isRevoking(session.id)" />
                          {{ t("settings.account.devices.logoutDevice") }}
                          <Kbd>↩</Kbd>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </ItemActions>
            </Item>
          </ItemGroup>
          <Field v-if="sessionsPending" orientation="horizontal">
            <FieldContent>
              <LoadingState :label="t('common.loading')" />
            </FieldContent>
          </Field>
          <Field v-else-if="sessionRows.length === 0" orientation="horizontal">
            <FieldContent>
              <Empty class="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconMonitor />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{ t("settings.account.devices.noSessions") }}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            </FieldContent>
          </Field>
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
                  <AlertDialogCancel @click="deleteAccountInput = ''">
                    {{ t("common.cancel") }}
                    <Kbd>Esc</Kbd>
                  </AlertDialogCancel>
                  <AlertDialogAction
                    :disabled="deletingAccount || !isDeleteAccountInputValid"
                    @click="deleteAccount"
                  >
                    <Spinner v-if="deletingAccount" />
                    {{ t("common.delete") }}
                    <Kbd>↩</Kbd>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Field>
        </FieldSet>
      </FieldGroup>
    </div>
    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="translate-y-2 opacity-0"
      leave-to-class="translate-y-2 opacity-0"
    >
      <SettingsUnsavedBar
        v-if="hasPendingChanges"
        :saving="isSaving"
        @discard="discardChanges"
        @save="saveChanges"
      />
    </Transition>
  </div>
</template>

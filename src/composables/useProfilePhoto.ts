import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { withToast } from "@/helpers/toast"
import { useAuthStore } from "@/stores/authStore"
import {
  deleteUserPhotoFile,
  getUserPhotoStorageRef,
} from "@/utils/firebase/firebase-helpers"
import { toast } from "vue-sonner"
import { useCurrentUser, useStorageFile } from "vuefire"

/**
 * The signed-in user's profile photo: upload (optimistic preview → Storage →
 * resolve URL → profile), remove, and the URL to display. Shared by Settings →
 * Account and onboarding so both behave identically; pair with
 * `<PhotoUploadAvatar>`.
 */
export function useProfilePhoto() {
  const { t } = useI18n()
  const user = useCurrentUser()
  const authStore = useAuthStore()

  const optimisticPhotoPreview = ref<string | null>(null)
  const displayPhotoURL = computed(
    () => optimisticPhotoPreview.value ?? user.value?.photoURL ?? null
  )

  const clearOptimisticPhotoPreview = () => {
    if (optimisticPhotoPreview.value?.startsWith("blob:")) {
      URL.revokeObjectURL(optimisticPhotoPreview.value)
    }
    optimisticPhotoPreview.value = null
  }

  onBeforeUnmount(clearOptimisticPhotoPreview)

  const profilePhotoFileRef = computed(() =>
    user.value?.uid ? getUserPhotoStorageRef(user.value.uid) : null
  )
  const { upload, refresh } = useStorageFile(profilePhotoFileRef)

  const { triggerUpload, isUploading } = usePhotoUpload({
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
      } catch (error) {
        console.error("Error uploading picture or updating profile:", error)
      } finally {
        clearOptimisticPhotoPreview()
      }
    },
  })

  const uploadProfilePhoto = () => {
    if (user.value?.uid) triggerUpload(user.value.uid)
  }

  const isRemoving = ref(false)
  // Upload OR remove in flight — drives the avatar spinner for both.
  const isBusy = computed(() => isUploading.value || isRemoving.value)

  const removeProfilePhoto = async () => {
    if (!user.value?.uid || isBusy.value) return
    isRemoving.value = true
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
    } finally {
      isRemoving.value = false
    }
  }

  return {
    displayPhotoURL,
    isBusy,
    uploadProfilePhoto,
    removeProfilePhoto,
  }
}

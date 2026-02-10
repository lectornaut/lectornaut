import { validateImageFile } from "@/helpers/imageFile"
import { toast } from "vue-sonner"

interface UsePhotoUploadOptions {
  /** Function to call when photo upload succeeds */
  onUpload: (id: string, file: File) => Promise<void>
  /** Function to check if upload is allowed */
  canUpload?: () => boolean
}

/**
 * Composable for handling photo uploads with file validation.
 * Follows Single Responsibility Principle - handles only photo upload flow.
 */
export function usePhotoUpload(options: UsePhotoUploadOptions) {
  const itemIdToUpdate = ref<string | null>(null)

  const { files, open, reset } = useFileDialog({
    accept: "image/*",
    multiple: false,
  })

  const triggerUpload = (itemId: string) => {
    if (options.canUpload && !options.canUpload()) return
    itemIdToUpdate.value = itemId
    open()
  }

  watch(files, async (newFiles) => {
    if (!newFiles || newFiles.length === 0 || !itemIdToUpdate.value) return

    const file = newFiles.item(0)
    const itemId = itemIdToUpdate.value

    if (!file) return

    const res = validateImageFile(file)
    if (!res.ok) {
      toast.error(res.message)
      reset()
      itemIdToUpdate.value = null
      return
    }

    try {
      await options.onUpload(itemId, file)
    } finally {
      reset()
      itemIdToUpdate.value = null
    }
  })

  return {
    triggerUpload,
  }
}

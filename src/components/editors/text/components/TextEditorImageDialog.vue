<script lang="ts" setup>
import { IconImage, IconLink, IconUpload } from "@/data/icons"

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    open: boolean
    /** Uploads a picked file and resolves to a permanent https URL. Upload
     * affordance is hidden when the host provides no uploader. */
    uploadImage?: ((file: File) => Promise<string>) | null
  }>(),
  {
    uploadImage: null,
  }
)

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (
    e: "insert",
    attrs: {
      src: string
      align?: "left" | "center" | "right"
      width?: string
    }
  ): void
}>()

const imageUrl = ref("")
const error = ref<string | null>(null)
const isUploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// Matches the editor's FileHandler allow-list (SVG stays blocked upstream).
const UPLOAD_ACCEPT = "image/png,image/jpeg,image/gif,image/webp"

const pickFile = () => {
  fileInput.value?.click()
}

const uploadPickedFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  const upload = props.uploadImage
  if (!file || !upload) {
    return
  }

  error.value = null
  isUploading.value = true
  try {
    const src = await upload(file)
    emit("insert", { src, align: "center", width: "100%" })
    closeDialog()
  } catch (uploadError) {
    error.value =
      (uploadError as Error).message ||
      t("components.textEditor.imageUploadFailed")
  } finally {
    isUploading.value = false
  }
}

const validateImageUrl = (rawValue: string): string | null => {
  const trimmed = rawValue.trim()
  if (!trimmed.length) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null
    }

    return parsed.toString()
  } catch {
    return null
  }
}

const resetState = () => {
  imageUrl.value = ""
  error.value = null
  isUploading.value = false
}

const closeDialog = () => {
  emit("update:open", false)
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      resetState()
    }
  }
)

const insertFromUrl = () => {
  const normalized = validateImageUrl(imageUrl.value)
  if (!normalized) {
    error.value = t("components.textEditor.imageDialog.invalidUrl")
    return
  }

  emit("insert", {
    src: normalized,
    align: "center",
    width: "100%",
  })
  closeDialog()
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{
          t("components.textEditor.imageDialog.title")
        }}</DialogTitle>
        <DialogDescription>{{
          t("components.textEditor.imageDialog.description")
        }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div class="space-y-2">
          <Label for="editor-image-url">{{
            t("components.textEditor.imageDialog.urlLabel")
          }}</Label>
          <Input
            id="editor-image-url"
            v-model="imageUrl"
            :placeholder="t('components.textEditor.imageDialog.urlPlaceholder')"
            @keydown.enter.prevent="insertFromUrl"
          />
        </div>

        <div class="flex items-center justify-between gap-2">
          <div v-if="uploadImage" class="flex items-center">
            <input
              ref="fileInput"
              type="file"
              :accept="UPLOAD_ACCEPT"
              class="hidden"
              @change="uploadPickedFile"
            />
            <Button variant="outline" :disabled="isUploading" @click="pickFile">
              <Spinner v-if="isUploading" />
              <IconUpload v-else />
              {{ t("components.textEditor.imageDialog.uploadButton") }}
            </Button>
          </div>
          <div class="ml-auto flex gap-2">
            <Button variant="ghost" @click="closeDialog">
              {{ t("actions.cancel") }}
              <Kbd>Esc</Kbd>
            </Button>
            <Button data-dialog-action @click="insertFromUrl">
              <IconLink />
              <IconImage />
              {{ t("components.textEditor.imageDialog.insertButton") }}
              <Kbd>↩</Kbd>
            </Button>
          </div>
        </div>
      </div>

      <p v-if="error" class="text-destructive text-sm">
        {{ error }}
      </p>
    </DialogContent>
  </Dialog>
</template>

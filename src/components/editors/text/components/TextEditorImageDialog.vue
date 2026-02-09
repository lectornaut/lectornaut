<script lang="ts" setup>
import { IconImage, IconLink } from "@/data/icons"

const props = defineProps<{
  open: boolean
}>()

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
    error.value = "Enter a valid image URL (http/https)."
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
        <DialogTitle>Insert Image</DialogTitle>
        <DialogDescription> Insert an external image URL. </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div class="space-y-2">
          <Label for="editor-image-url">Image URL</Label>
          <Input
            id="editor-image-url"
            v-model="imageUrl"
            placeholder="https://example.com/image.png"
            @keydown.enter.prevent="insertFromUrl"
          />
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="closeDialog">Cancel</Button>
          <Button @click="insertFromUrl">
            <IconLink />
            <IconImage />
            Insert Image
          </Button>
        </div>
      </div>

      <p v-if="error" class="text-destructive text-sm">
        {{ error }}
      </p>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import { IconLink, IconTrash } from "@/data/icons"

const props = withDefaults(
  defineProps<{
    open: boolean
    initialHref?: string | null
  }>(),
  {
    initialHref: null,
  }
)

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "submit", value: string): void
  (e: "remove"): void
}>()

const href = ref("")

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return
    }

    href.value = props.initialHref ?? ""
  }
)

const closeDialog = () => emit("update:open", false)

const submit = () => {
  emit("submit", href.value)
  closeDialog()
}

const remove = () => {
  emit("remove")
  closeDialog()
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Insert Link</DialogTitle>
        <DialogDescription>
          Add a URL for the selected text. Leave empty to remove.
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-2">
        <Label for="editor-link-input">URL</Label>
        <Input
          id="editor-link-input"
          v-model="href"
          placeholder="https://example.com"
          autofocus
          @keydown.enter.prevent="submit"
        />
      </div>
      <DialogFooter class="gap-2 sm:justify-between">
        <Button variant="outline" @click="remove">
          <IconTrash />
          Remove
        </Button>
        <div class="flex gap-2">
          <Button variant="ghost" @click="closeDialog">Cancel</Button>
          <Button @click="submit">
            <IconLink />
            Apply
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

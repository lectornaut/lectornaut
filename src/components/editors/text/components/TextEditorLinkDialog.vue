<script lang="ts" setup>
import { IconLink, IconTrash } from "@/data/icons"

const { t } = useI18n()

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
        <DialogTitle>{{
          t("components.textEditor.linkDialog.title")
        }}</DialogTitle>
        <DialogDescription>
          {{ t("components.textEditor.linkDialog.description") }}
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-2">
        <Label for="editor-link-input">{{
          t("components.textEditor.linkDialog.urlLabel")
        }}</Label>
        <Input
          id="editor-link-input"
          v-model="href"
          :placeholder="t('components.textEditor.linkDialog.urlPlaceholder')"
          autofocus
          @keydown.enter.prevent="submit"
        />
      </div>
      <DialogFooter class="gap-2 sm:justify-between">
        <Button variant="outline" @click="remove">
          <IconTrash />
          {{ t("components.textEditor.linkDialog.remove") }}
        </Button>
        <div class="flex gap-2">
          <Button variant="ghost" @click="closeDialog">{{
            t("actions.cancel")
          }}</Button>
          <Button @click="submit">
            <IconLink />
            {{ t("components.textEditor.linkDialog.apply") }}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

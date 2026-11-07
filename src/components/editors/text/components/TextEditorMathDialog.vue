<script lang="ts" setup>
import { IconTrash } from "@/data/icons"

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    open: boolean
    initialLatex?: string
    /** Editing an existing node (shows Remove) vs inserting a new one. */
    editing?: boolean
  }>(),
  {
    initialLatex: "",
    editing: false,
  }
)

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "submit", value: string): void
  (e: "remove"): void
}>()

const latex = ref("")

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) latex.value = props.initialLatex
  }
)

const closeDialog = () => emit("update:open", false)

const submit = () => {
  emit("submit", latex.value.trim())
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
          t("components.textEditor.mathDialog.title")
        }}</DialogTitle>
        <DialogDescription>
          {{ t("components.textEditor.mathDialog.description") }}
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel for="editor-math-input">{{
          t("components.textEditor.mathDialog.latexLabel")
        }}</FieldLabel>
        <Input
          id="editor-math-input"
          v-model="latex"
          class="font-mono"
          placeholder="e = mc^2"
          autofocus
          @keydown.enter.prevent="submit"
        />
      </Field>
      <DialogFooter class="gap-2 sm:justify-between">
        <Button v-if="editing" variant="outline" @click="remove">
          <IconTrash />
          {{ t("components.textEditor.linkDialog.remove") }}
        </Button>
        <div class="flex gap-2 sm:ml-auto">
          <DialogClose as-child>
            <Button variant="outline">
              {{ t("actions.cancel") }}
              <Kbd>Esc</Kbd>
            </Button>
          </DialogClose>
          <Button data-dialog-action :disabled="!latex.trim()" @click="submit">
            {{ t("components.textEditor.linkDialog.apply") }}
            <Kbd>↩</Kbd>
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

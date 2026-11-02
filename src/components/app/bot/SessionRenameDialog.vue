<script lang="ts" setup>
/**
 * The ONE chat-rename dialog (bottom bar, inspector, history sidebar,
 * Settings → Sessions). Each surface keeps its own backend, which must
 * resolve `true` on success: the dialog closes only then, so a failed rename
 * keeps the typed title.
 */
const props = defineProps<{
  title?: string | null
  onSave: (title: string) => Promise<boolean>
}>()

const open = defineModel<boolean>("open", { default: false })

const { t } = useI18n()
const inputId = useId()
const draft = ref("")
const pending = ref(false)

watch(open, (isOpen) => {
  if (isOpen) draft.value = props.title ?? ""
})

const setOpen = (next: boolean) => {
  if (!next && pending.value) return
  open.value = next
}

const save = async () => {
  const next = draft.value.trim()
  if (pending.value || !next) return
  if (next === (props.title ?? "")) {
    open.value = false
    return
  }
  pending.value = true
  try {
    if (await props.onSave(next)) open.value = false
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="setOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t("ai.renameChat") }}</DialogTitle>
        <DialogDescription>{{ t("ai.renameChatHint") }}</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel :for="inputId">{{ t("ai.chatTitle") }}</FieldLabel>
        <Input
          :id="inputId"
          v-model="draft"
          :placeholder="t('ai.chatTitlePlaceholder')"
          maxlength="120"
          :disabled="pending"
        />
      </Field>
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" :disabled="pending">
            {{ t("actions.cancel") }}
            <Kbd>Esc</Kbd>
          </Button>
        </DialogClose>
        <Button
          data-dialog-action
          :disabled="pending || !draft.trim()"
          @click="save"
        >
          <Spinner v-if="pending" />
          {{ t("actions.save") }}
          <Kbd>↩</Kbd>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

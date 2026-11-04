<script lang="ts" setup>
/**
 * The ONE confirmation dialog. Every "are you sure?" goes through here so
 * pending state, failure, destructive styling and typed confirmation behave
 * the same everywhere.
 *
 * Contract for `onConfirm`: resolve to close; throw or return `false` to stay
 * open. The action surfaces its own error (house `withToast` convention), so
 * this component never toasts. While pending, Cancel, Escape and the proceed
 * button are all locked so the outcome is always seen inside the dialog.
 *
 * Mount it as a SIBLING of any menu that opens it (never inside
 * DropdownMenuContent/ContextMenuContent), or pass a `#trigger` slot for a
 * plain inline button.
 */
const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    actionLabel: string
    cancelLabel?: string
    destructive?: boolean
    /** Typed confirmation: the action unlocks once this text is typed. */
    confirmPhrase?: string
    disabled?: boolean
    onConfirm: () => unknown
  }>(),
  {
    description: undefined,
    cancelLabel: undefined,
    destructive: false,
    confirmPhrase: undefined,
    disabled: false,
  }
)

const open = defineModel<boolean>("open", { default: false })

const { t } = useI18n()
const phraseId = useId()
const pending = ref(false)
const typed = ref("")

watch(open, (isOpen) => {
  if (isOpen) typed.value = ""
})

const phraseMatches = computed(
  () =>
    !props.confirmPhrase || typed.value.trim() === props.confirmPhrase.trim()
)

const setOpen = (next: boolean) => {
  if (!next && pending.value) return
  open.value = next
}

const focusPhrase = (event: Event) => {
  if (!props.confirmPhrase) return
  event.preventDefault()
  document.getElementById(phraseId)?.focus()
}

const proceed = async () => {
  if (pending.value || props.disabled || !phraseMatches.value) return
  pending.value = true
  try {
    if ((await props.onConfirm()) !== false) open.value = false
  } catch (error) {
    console.error("[ConfirmAction] action failed:", error)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <AlertDialog :open="open" @update:open="setOpen">
    <AlertDialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </AlertDialogTrigger>
    <AlertDialogContent @open-auto-focus="focusPhrase">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription>
          <slot name="description">{{ description }}</slot>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Field v-if="confirmPhrase">
        <FieldLabel :for="phraseId">
          <i18n-t keypath="common.typeToConfirm" tag="span">
            <template #phrase>
              <span class="text-foreground font-medium select-all">{{
                confirmPhrase
              }}</span>
            </template>
          </i18n-t>
        </FieldLabel>
        <Input
          :id="phraseId"
          v-model="typed"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :disabled="pending"
        />
      </Field>
      <slot />
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="pending">
          {{ cancelLabel ?? t("actions.cancel") }}
          <Kbd>Esc</Kbd>
        </AlertDialogCancel>
        <Button
          :variant="destructive ? 'destructive' : 'default'"
          data-dialog-action
          :disabled="pending || disabled || !phraseMatches"
          @click="proceed"
        >
          <Spinner v-if="pending" />
          {{ actionLabel }}
          <Kbd>↩</Kbd>
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

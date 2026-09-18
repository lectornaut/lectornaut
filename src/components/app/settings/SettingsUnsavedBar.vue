<script lang="ts" setup>
withDefaults(
  defineProps<{
    /** Save in flight: shows the spinner and disables both actions. */
    saving?: boolean
    /** Extra gate on the save action, OR-ed with `saving`. */
    saveDisabled?: boolean
    /** Overrides the default "Save" label for contextual CTAs (e.g. billing). */
    saveLabel?: string
    /**
     * Why save is disabled right now. Replaces the generic "unsaved changes"
     * line so the blocker is read where the disabled button is.
     */
    saveDisabledReason?: string | null
  }>(),
  {
    saving: false,
    saveDisabled: false,
    saveLabel: undefined,
    saveDisabledReason: null,
  }
)

defineEmits<{
  (e: "discard"): void
  (e: "save"): void
}>()

const { t } = useI18n()
</script>

<template>
  <DialogFooter
    class="bg-popover sticky bottom-3 z-10 m-3 flex items-center gap-2 rounded-4xl border p-2 shadow-xl"
  >
    <p
      class="mr-auto ml-1 text-xs"
      :class="
        saveDisabled && saveDisabledReason
          ? 'text-destructive'
          : 'text-muted-foreground'
      "
      :aria-live="saveDisabled && saveDisabledReason ? 'polite' : undefined"
    >
      {{
        saveDisabled && saveDisabledReason
          ? saveDisabledReason
          : t("settings.unsavedChanges")
      }}
    </p>
    <Button variant="outline" :disabled="saving" @click="$emit('discard')">
      {{ t("common.discard") }}
    </Button>
    <Button :disabled="saving || saveDisabled" @click="$emit('save')">
      <Spinner v-if="saving" />
      {{ saveLabel ?? t("common.save") }}
    </Button>
  </DialogFooter>
</template>

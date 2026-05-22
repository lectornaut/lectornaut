<script lang="ts" setup>
withDefaults(
  defineProps<{
    /** Save in flight: shows the spinner and disables both actions. */
    saving?: boolean
    /** Extra gate on the save action, OR-ed with `saving`. */
    saveDisabled?: boolean
    /** Overrides the default "Save" label for contextual CTAs (e.g. billing). */
    saveLabel?: string
  }>(),
  {
    saving: false,
    saveDisabled: false,
    saveLabel: undefined,
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
    class="bg-background/90 sticky bottom-3 z-10 m-3 flex items-center gap-2 rounded-lg border p-2 shadow-lg backdrop-blur-lg"
  >
    <p class="text-muted-foreground mr-auto ml-2 text-xs">
      {{ t("settings.unsavedChanges") }}
    </p>
    <Button variant="secondary" :disabled="saving" @click="$emit('discard')">
      {{ t("common.discard") }}
    </Button>
    <Button :disabled="saving || saveDisabled" @click="$emit('save')">
      <Spinner v-if="saving" />
      {{ saveLabel ?? t("common.save") }}
    </Button>
  </DialogFooter>
</template>

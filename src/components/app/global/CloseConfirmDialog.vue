<script lang="ts" setup>
import {
  closeRequest,
  finishAppClose,
} from "@/composables/useCloseConfirmation"
import { useAppPreferencesStore } from "@/stores/appPreferencesStore"

/** The desktop close/quit prompt raised by `requestAppClose`. */
const { t } = useI18n()
const preferences = useAppPreferencesStore()
const checkboxId = useId()
const dontAskAgain = ref(false)

// Keep the last request while the dialog animates out.
const shown = ref(closeRequest.value)
watch(closeRequest, (request) => {
  if (!request) return
  shown.value = request
  dontAskAgain.value = false
})

const open = computed({
  get: () => closeRequest.value !== null,
  set: (next) => {
    if (!next) closeRequest.value = null
  },
})

const isQuit = computed(() => shown.value?.kind === "quit")

const proceed = async () => {
  const request = closeRequest.value
  if (!request) return
  if (dontAskAgain.value) preferences.confirmClose = false
  closeRequest.value = null
  await finishAppClose(request.kind)
}
</script>

<template>
  <ConfirmAction
    v-model:open="open"
    :title="t(`components.closeConfirm.${isQuit ? 'quit' : 'close'}Title`)"
    :description="
      t(
        shown?.busy
          ? 'components.closeConfirm.busyDescription'
          : `components.closeConfirm.${isQuit ? 'quit' : 'close'}Description`
      )
    "
    :action-label="
      t(`components.closeConfirm.${isQuit ? 'quit' : 'close'}Action`)
    "
    :destructive="shown?.busy"
    :on-confirm="proceed"
  >
    <!-- Busy prompts show regardless of the pref, so opting out there would
         be a promise the next busy quit breaks. -->
    <Field v-if="!shown?.busy" orientation="horizontal">
      <Checkbox :id="checkboxId" v-model="dontAskAgain" />
      <FieldLabel :for="checkboxId" class="font-normal">
        {{ t("components.closeConfirm.dontAskAgain") }}
      </FieldLabel>
    </Field>
  </ConfirmAction>
</template>

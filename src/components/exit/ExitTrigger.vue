<script lang="ts" setup>
import { logout } from "@/modules/auth"
import { emitter } from "@/modules/mitt"

const { t } = useI18n()

const openExit = ref(false)

const toggleExit = () => {
  openExit.value = !openExit.value
}

emitter.on("Dialog.Exit.Open", toggleExit)
onBeforeUnmount(() => emitter.off("Dialog.Exit.Open", toggleExit))
</script>

<template>
  <ConfirmAction
    v-model:open="openExit"
    :title="t('pages.exit.dialog.title')"
    :description="t('pages.exit.dialog.description')"
    :action-label="t('pages.exit.dialog.logout')"
    :on-confirm="logout"
  />
</template>

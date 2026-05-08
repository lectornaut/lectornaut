<script lang="ts" setup>
import { IconLogOut } from "@/data/icons"
import { emitter } from "@/modules/mitt"

definePage({
  meta: {
    requiresUser: true,
    layout: false,
  },
})

useHead({
  title: "Exit",
})

const { t } = useI18n()
</script>

<template>
  <div class="flex grow flex-col overflow-auto overscroll-none scroll-smooth">
    <PageHeader />
    <div class="flex grow flex-col gap-2 p-2">
      <Button variant="secondary" @click="emitter.emit('Dialog.Exit.Open')">
        <IconLogOut />
        {{ t("actions.logout") }}
      </Button>
    </div>
  </div>
</template>

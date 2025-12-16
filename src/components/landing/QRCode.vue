<script lang="ts" setup>
import { state } from "@/modules/theme"

const { t } = useI18n()
</script>

<template>
  <Dialog>
    <DialogTrigger as-child>
      <div
        class="fixed right-4 bottom-4 z-50 hidden flex-col items-center gap-4 md:flex"
      >
        <span class="text-muted-foreground">
          {{ t("components.landing.qrCode.scan") }}
        </span>
        <div
          class="bg-background/50 group hover:bg-background/75 cursor-pointer rounded-lg border backdrop-blur-lg transition hover:scale-110"
        >
          <img
            :src="`/assets/images/qr-code-${state}.svg`"
            :alt="t('components.landing.qrCode.alt')"
            class="h-28 w-28 opacity-50 transition group-hover:opacity-100"
          />
        </div>
      </div>
    </DialogTrigger>
    <DialogContent class="w-sm max-w-fit">
      <DialogHeader class="items-center">
        <DialogTitle>{{ t("components.landing.qrCode.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("components.landing.qrCode.description") }}
        </DialogDescription>
      </DialogHeader>
      <div class="flex items-center justify-center">
        <img
          :src="`/assets/images/qr-code-${state}.svg`"
          :alt="t('components.landing.qrCode.alt')"
          class="w-full"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { state } from "@/modules/theme"
</script>

<template>
  <Dialog>
    <DialogTrigger
      v-motion-fade
      as-child
      class="fixed bottom-4 right-4 z-50 flex flex-col items-center gap-4"
    >
      <div>
        <span class="text-muted-foreground/50">Scan to get the app</span>
        <img
          :src="`assets/images/qr-code-${state}.svg`"
          alt="QR Code"
          class="h-28 w-28 cursor-pointer rounded-xl border bg-muted/50 p-1 opacity-75 backdrop-blur-xl transition hover:scale-110 hover:opacity-100"
        />
      </div>
    </DialogTrigger>
    <DialogContent class="max-w-fit">
      <DialogHeader class="items-center">
        <DialogTitle>Get the app</DialogTitle>
        <DialogDescription>
          Scan the QR code to download the app
        </DialogDescription>
      </DialogHeader>
      <div class="flex items-center justify-center">
        <img :src="`qr-code-${state}.svg`" alt="QR Code" class="w-full" />
      </div>
    </DialogContent>
  </Dialog>
</template>

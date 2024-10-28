<script setup lang="ts">
import { state } from "@/modules/theme"
</script>

<template>
  <Dialog>
    <DialogTrigger
      as-child
      class="fixed bottom-4 right-4 z-50 flex flex-col items-center gap-4"
    >
      <div>
        <span class="text-muted-foreground">Scan to get the app</span>
        <img
          :src="`qr-code-${state}.svg`"
          alt="QR Code"
          class="h-28 w-28 cursor-pointer rounded-xl border bg-muted/50 p-1 opacity-75 backdrop-blur-xl transition hover:scale-110 hover:opacity-100"
        />
      </div>
    </DialogTrigger>
    <DialogContent class="max-w-fit">
      <DialogHeader class="sr-only">
        <DialogTitle>Get the app</DialogTitle>
        <DialogDescription>
          Scan the QR code to get the app on your device.
        </DialogDescription>
      </DialogHeader>
      <div class="flex items-center justify-center">
        <img :src="`qr-code-${state}.svg`" alt="QR Code" />
      </div>
    </DialogContent>
  </Dialog>
</template>

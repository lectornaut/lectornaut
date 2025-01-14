<script setup lang="ts">
useHead({
  title: "Welcome",
})
</script>

<template>
  <div class="relative h-dvh w-dvw overflow-hidden">
    <video playsinline autoplay muted loop class="h-full w-full object-cover">
      <source
        src="/assets/videos/sky.mp4"
        type="video/mp4"
        poster="/assets/images/sky.png"
      />
    </video>
    <div
      class="fixed top-0 z-10 h-full w-full bg-gradient-to-b from-white/75"
    ></div>
    <img
      src="/assets/images/bg-clear.png"
      class="fixed bottom-0 z-20 h-1/2 w-full overflow-visible object-cover"
    />
    <div
      class="absolute bottom-0 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
    >
      <Button
        variant="ghost"
        class="bg-emerald-950/50 text-white backdrop-blur-xl"
      >
        Start your journey
      </Button>
    </div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "requiresUser": true
  }
}
</route>

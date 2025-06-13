<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div
    class="before:from-background fixed inset-x-0 bottom-0 z-20 flex flex-col items-center justify-center gap-6 p-4 before:absolute before:inset-0 before:bg-linear-to-t before:backdrop-blur-lg before:[mask:linear-gradient(transparent,_black_50%)]"
  >
    <div class="flex gap-2 rounded-full border p-2 shadow-xl backdrop-blur-lg">
      <EnterTrigger>
        <Button size="lg">Enter</Button>
      </EnterTrigger>
      <Faq />
    </div>
    <div class="mb-safe-bottom text-muted-foreground z-10 text-center">
      {{ t("hello") }}, track expenses, set goals, and save money.
    </div>
  </div>
</template>

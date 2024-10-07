<script lang="ts" setup>
const { t } = useI18n()
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center justify-center gap-6 p-4 before:absolute before:inset-0 before:bg-gradient-to-t before:from-background before:backdrop-blur-lg before:[mask:linear-gradient(transparent,_black_50%)]"
  >
    <div
      class="flex gap-3 rounded-3xl border bg-muted/50 p-3 shadow-xl backdrop-blur-lg"
    >
      <EnterTrigger>
        <Button class="rounded-2xl" size="lg">Enter</Button>
      </EnterTrigger>
      <Faq />
    </div>
    <div class="z-10 mb-safe-bottom text-center text-muted-foreground/50">
      {{ t("hello") }}, track expenses, set goals, and save money.
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps({
  email: String,
})
const emit = defineEmits({
  changeEmail: () => true,
})
</script>

<template>
  <div class="flex max-w-sm flex-col items-center gap-4 p-4">
    <div class="flex flex-col items-center gap-4 text-center">
      <span
        class="mb-4 flex place-items-center rounded-2xl border p-3 shadow-lg"
      >
        <icon-lucide-badge-check class="size-8" />
      </span>
      <h1 class="text-lg font-semibold leading-none tracking-tight">
        Email sent
      </h1>
      <p class="text-muted-foreground">
        We sent a verification link to<br />
        {{ email }}. Please check your inbox.
      </p>
    </div>
    <Button variant="link" class="gap-1" @click="emit('changeEmail')">
      <icon-lucide-chevron-left /> Back to all options
    </Button>
  </div>
</template>

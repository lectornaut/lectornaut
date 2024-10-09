<script setup lang="ts">
const message = ref("")
</script>

<template>
  <aside class="no-scrollbar flex grow flex-col overflow-auto">
    <div class="flex grow flex-col gap-2 p-2">
      <div class="flex grow">messages</div>
      <div class="grid gap-2 md:grid-cols-2">
        <Card class="cursor-pointer transition hover:shadow-md">
          <CardHeader class="gap-1 px-4 py-4">
            <CardTitle class="text-xs">What are the</CardTitle>
            <CardDescription> benefits of upgrading? </CardDescription>
          </CardHeader>
        </Card>
        <Card class="cursor-pointer transition hover:shadow-md">
          <CardHeader class="gap-1 px-4 py-4">
            <CardTitle class="text-xs">How do I</CardTitle>
            <CardDescription> upgrade my account? </CardDescription>
          </CardHeader>
        </Card>
        <Card class="cursor-pointer transition hover:shadow-md">
          <CardHeader class="gap-1 px-4 py-4">
            <CardTitle class="text-xs">How do I</CardTitle>
            <CardDescription> cancel my subscription? </CardDescription>
          </CardHeader>
        </Card>
        <Card class="cursor-pointer transition hover:shadow-md">
          <CardHeader class="gap-1 px-4 py-4">
            <CardTitle class="text-xs">How do I</CardTitle>
            <CardDescription> change my password? </CardDescription>
          </CardHeader>
        </Card>
      </div>
      <div class="relative items-center">
        <span
          class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-3"
        >
          <icon-mingcute-ai-fill />
        </span>
        <Input
          v-model="message"
          placeholder="Type your message here."
          class="truncate pl-8 pr-12 focus:border-inherit focus:ring-0"
        />
        <span
          class="absolute inset-y-0 end-0 flex items-center justify-center px-2"
        >
          <Button class="rounded-full" size="xs">
            <icon-lucide-arrow-up />
          </Button>
        </span>
      </div>
    </div>
  </aside>
</template>

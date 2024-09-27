<script setup lang="ts">
const openCommand = ref(false)

const handleOpenCommandChange = () => {
  openCommand.value = !openCommand.value
}

const activeElement = useActiveElement()
const notUsingInput = computed(
  () =>
    activeElement.value?.tagName !== "INPUT" &&
    activeElement.value?.tagName !== "TEXTAREA"
)

const { Meta_K } = useMagicKeys()

whenever(logicAnd(Meta_K, notUsingInput), () => handleOpenCommandChange())
</script>

<template>
  <div class="flex grow">
    <div class="relative items-center">
      <span
        class="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center px-2"
      >
        <icon-lucide-search class="text-muted-foreground" />
      </span>
      <Button
        variant="secondary"
        class="w-72 justify-start bg-muted pl-7 pr-16"
        size="xs"
        @click="openCommand = true"
      >
        Search
      </Button>
      <span
        class="pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center gap-1 px-2"
      >
        <kbd
          class="pointer-events-none inline-flex h-4 min-w-4 items-center justify-center gap-1 rounded border px-1 font-mono text-xs text-muted-foreground"
        >
          <span class="text-sm">⌘</span>
        </kbd>
        <kbd
          class="pointer-events-none inline-flex h-4 min-w-4 items-center justify-center gap-1 rounded border px-1 font-mono text-xs text-muted-foreground"
        >
          <span>K</span>
        </kbd>
      </span>
    </div>
    <CommandDialog :open="openCommand" @update:open="handleOpenCommandChange">
      <DialogHeader class="sr-only">
        <DialogTitle> Search </DialogTitle>
        <DialogDescription> Type a command or search... </DialogDescription>
      </DialogHeader>
      <CommandInput
        placeholder="Type a command or search..."
        class="border-none focus:border-inherit focus:ring-0"
      />
      <Commands />
    </CommandDialog>
  </div>
</template>

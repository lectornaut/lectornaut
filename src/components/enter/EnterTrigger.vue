<script lang="ts" setup>
const { t } = useI18n()
</script>

<template>
  <Dialog>
    <DialogTrigger as-child>
      <slot />
    </DialogTrigger>
    <DialogContent class="w-sm max-w-fit">
      <DialogHeader class="sr-only">
        <DialogTitle>{{ t("enter.title") }}</DialogTitle>
        <DialogDescription>
          {{ t("enter.triggerDescription") }}
        </DialogDescription>
      </DialogHeader>
      <EnterContent />
      <DialogFooter>
        <EnterFooter />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

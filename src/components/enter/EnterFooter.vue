<script lang="ts" setup>
const { t } = useI18n()
</script>

<template>
  <span class="text-muted-foreground/50 mx-auto flex items-center gap-2">
    <Button variant="link" class="text-muted-foreground/50">
      {{ t("enter.footer.terms") }}
    </Button>
    <span>•</span>
    <Button variant="link" class="text-muted-foreground/50">
      {{ t("enter.footer.privacy") }}
    </Button>
  </span>
</template>

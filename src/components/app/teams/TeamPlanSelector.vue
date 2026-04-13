<script lang="ts" setup>
import { IconCreditCard } from "@/data/icons"

const emit = defineEmits<{
  skip: []
}>()

const { t } = useI18n()
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <IconCreditCard />
      </EmptyMedia>
      <EmptyTitle>{{ t("components.teamPlanSelector.title") }}</EmptyTitle>
      <EmptyDescription>
        {{ t("components.teamPlanSelector.description") }}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent
      class="bg-background flex max-w-xs flex-col items-stretch gap-2 border p-2"
    >
      <Button as-child>
        <RouterLink to="/welcome?step=5">
          {{ t("components.teamPlanSelector.choosePlan") }}
        </RouterLink>
      </Button>
      <Button variant="outline" @click="emit('skip')">
        {{ t("components.teamPlanSelector.skipForNow") }}
      </Button>
    </EmptyContent>
  </Empty>
</template>

<script lang="ts" setup>
import {
  IconArrowRightCircle,
  IconCircleMedium,
  IconCircleSmall,
} from "@/data/icons"

const { t } = useI18n()

const steps = computed(() => [
  {
    name: t("components.flow.progress.stepCreateWorkflow"),
    status: "complete",
  },
  { name: t("components.flow.progress.stepAddNode"), status: "complete" },
  { name: t("components.flow.progress.stepRunWorkflow"), status: "current" },
  {
    name: t("components.flow.progress.stepPublishAutomation"),
    status: "upcoming",
  },
])
</script>

<template>
  <SidebarGroup>
    <SidebarGroupContent>
      <Card class="shadow-none">
        <CardHeader class="p-4">
          <CardTitle>
            <span>{{ t("components.flow.progress.myProgress") }}</span>
            <Badge variant="secondary">
              <span> {{ t("components.flow.progress.skip") }} </span>
              <IconArrowRightCircle />
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent class="px-4 pb-4">
          <ol role="list" class="grid gap-3">
            <li v-for="step in steps" :key="step.name">
              <div class="flex items-center gap-3">
                <IconCircleMedium
                  v-if="step.status === 'complete'"
                  class="text-green-500"
                />
                <IconCircleMedium
                  v-else-if="step.status === 'current'"
                  class="text-amber-500"
                />
                <IconCircleSmall v-else class="text-muted-foreground" />
                <span
                  :class="
                    step.status === 'complete'
                      ? 'text-muted-foreground'
                      : 'text-secondary-foreground'
                  "
                >
                  {{ step.name }}
                </span>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    </SidebarGroupContent>
  </SidebarGroup>
</template>

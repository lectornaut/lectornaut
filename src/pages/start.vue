<script lang="ts" setup>
import { IconMessageCircle, IconSparkles } from "@/data/icons"
import { emitter } from "@/modules/mitt"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Welcome",
    breadcrumb: "Welcome",
  },
})

useHead({
  title: "Welcome",
})

const { t } = useI18n()
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconMessageCircle />
          </EmptyMedia>
          <EmptyTitle> {{ t("pages.start.console") }} </EmptyTitle>
          <EmptyDescription>
            {{ t("pages.start.consoleDescription") }}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            @click="emitter.emit('Dialog.AiAsk.Toggle')"
          >
            {{ t("pages.start.askAi") }}
          </Button>
        </EmptyContent>
      </Empty>
    </Sidebar>
  </Teleport>
  <StartBlock />
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconSparkles />
          </EmptyMedia>
          <EmptyTitle> {{ t("pages.start.getInstantAnswers") }} </EmptyTitle>
          <EmptyDescription>
            {{ t("pages.start.getInstantAnswersDescription") }}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            @click="emitter.emit('Dialog.AiAsk.Toggle')"
          >
            {{ t("pages.start.askAi") }}
          </Button>
        </EmptyContent>
      </Empty>
    </Sidebar>
  </Teleport>
</template>

<script lang="ts" setup>
import emitter from "@/modules/mitt"
import IconAiAsk from "~icons/mingcute/ai-fill"
import IconBlock from "~icons/mingcute/layer-fill"

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
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconBlock class="size-6" />
          </EmptyMedia>
          <EmptyTitle> Console </EmptyTitle>
          <EmptyDescription>
            Your console will appear here when you run a project.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            @click="emitter.emit('Dialog.AiAsk.Toggle')"
          >
            Ask AI
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
            <IconAiAsk class="size-6" />
          </EmptyMedia>
          <EmptyTitle> Get Instant Answers </EmptyTitle>
          <EmptyDescription>
            Get instant help and code suggestions from our AI assistant.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            @click="emitter.emit('Dialog.AiAsk.Toggle')"
          >
            Ask AI
          </Button>
        </EmptyContent>
      </Empty>
    </Sidebar>
  </Teleport>
</template>

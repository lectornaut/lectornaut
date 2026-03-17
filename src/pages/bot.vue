<script lang="ts" setup>
definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Bot",
    breadcrumb: "Bot",
  },
})

useHead({
  title: "Bot",
})
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <BotHistorySidebar />
  </Teleport>
  <AiChatShell />
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <Tabs default-value="details" class="h-full min-h-0 gap-0">
        <TabsList class="bg-transparent p-2">
          <TabsTrigger
            value="details"
            class="data-[state=active]:bg-muted rounded-xs p-2! text-xs leading-0 data-[state=active]:shadow-none"
          >
            Details
          </TabsTrigger>
          <TabsTrigger
            value="actions"
            class="data-[state=active]:bg-muted rounded-xs p-2! text-xs leading-0 data-[state=active]:shadow-none"
          >
            Actions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details" class="h-0 min-h-0 flex-1">
          <BotChatDetails />
        </TabsContent>
        <TabsContent value="actions" class="h-0 min-h-0 flex-1">
          <BotChatActions />
        </TabsContent>
      </Tabs>
    </Sidebar>
  </Teleport>
</template>

<script lang="ts" setup>
import { IconAiFill, IconClock } from "@/data/icons"

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

  <div class="m-2 flex grow flex-col overflow-hidden rounded border">
    <div class="flex items-start justify-between gap-3 border-b p-4">
      <div class="space-y-1">
        <div class="flex items-center gap-2 text-sm font-medium">
          <IconAiFill />
          Bot chat
        </div>
        <p class="text-muted-foreground text-xs">
          Chat in the center and use side panels for history, context, and
          follow-up actions.
        </p>
      </div>
      <Badge variant="outline">
        <IconClock />
        Live session
      </Badge>
    </div>
    <AiChatShell />
  </div>

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

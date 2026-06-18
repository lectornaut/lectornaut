<template>
  <Sidebar collapsible="none" class="w-full">
    <Tabs default-value="details" class="p-2">
      <TabsList
        class="no-scrollbar bg-input/50 w-[-webkit-fill-available] shrink-0 justify-start overflow-x-auto border"
      >
        <TabsTrigger
          value="details"
          class="data-[state=active]:border-border! data-[state=active]:bg-background"
        >
          Details
        </TabsTrigger>
        <TabsTrigger
          value="actions"
          class="data-[state=active]:border-border! data-[state=active]:bg-background"
        >
          Actions
        </TabsTrigger>
        <TabsTrigger
          value="attachments"
          class="data-[state=active]:border-border! data-[state=active]:bg-background"
        >
          Attachments
        </TabsTrigger>
      </TabsList>

      <TabsContent value="details" class="size-full h-0 min-h-0 min-w-0 grow">
        <BotChatDetails />
      </TabsContent>

      <TabsContent value="actions" class="size-full h-0 min-h-0 min-w-0 grow">
        <BotChatActions />
      </TabsContent>

      <TabsContent
        value="attachments"
        class="size-full h-0 min-h-0 min-w-0 grow"
      >
        <SessionAttachments />
      </TabsContent>
    </Tabs>
  </Sidebar>
</template>

<template>
  <Sidebar collapsible="none" class="size-full">
    <Tabs default-value="details" class="min-h-0 min-w-0 grow gap-0">
      <TabsList
        class="no-scrollbar m-2 w-[-webkit-fill-available] shrink-0 justify-start overflow-x-auto"
      >
        <TabsTrigger value="details" class="text-xs">Details</TabsTrigger>
        <TabsTrigger value="actions" class="text-xs">Actions</TabsTrigger>
      </TabsList>

      <TabsContent value="details" class="size-full h-0 min-h-0 min-w-0 grow">
        <BotChatDetails />
      </TabsContent>

      <TabsContent value="actions" class="size-full h-0 min-h-0 min-w-0 grow">
        <BotChatActions />
      </TabsContent>
    </Tabs>
  </Sidebar>
</template>

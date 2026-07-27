<script lang="ts" setup>
const { t } = useI18n()
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <Tabs default-value="details" class="min-h-0 min-w-0 grow">
      <TabsList
        class="no-scrollbar bg-input/50 scroll-fade-x m-2 h-9! w-[-webkit-fill-available] shrink-0 justify-start overflow-clip overflow-x-auto p-0"
      >
        <TabsTrigger
          value="details"
          class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
        >
          {{ t("inspector.tabs.details") }}
        </TabsTrigger>
        <TabsTrigger
          value="actions"
          class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
        >
          {{ t("inspector.tabs.actions") }}
        </TabsTrigger>
        <TabsTrigger
          value="attachments"
          class="data-[state=active]:border-border! data-[state=active]:bg-background h-9"
        >
          {{ t("inspector.tabs.attachments") }}
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

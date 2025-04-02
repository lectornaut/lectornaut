<script setup lang="ts">
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"
</script>

<template>
  <Tabs default-value="details">
    <Sidebar collapsible="none" class="shrink-0">
      <SidebarHeader class="border-b border-dashed">
        <div class="flex items-center justify-between gap-2">
          <span class="text-foreground ml-2 text-base font-medium">
            Information
          </span>
          <Button variant="ghost" size="icon">
            <icon-lucide-share-2 />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarHeader>
        <TabsList class="bg-background w-full p-0">
          <TabsTrigger
            class="text-secondary-foreground data-[state=active]:after:bg-primary relative w-full rounded-md py-2.5 data-[state=active]:z-10 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:-bottom-2.5 data-[state=active]:after:h-0.5 data-[state=active]:after:w-full"
            value="details"
          >
            <span class="flex items-center justify-center gap-2">
              <!-- <icon-lucide-workflow /> -->
              Details
            </span>
          </TabsTrigger>
          <TabsTrigger
            class="text-secondary-foreground data-[state=active]:after:bg-primary relative w-full rounded-md py-2.5 data-[state=active]:z-10 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:-bottom-2.5 data-[state=active]:after:h-0.5 data-[state=active]:after:w-full"
            value="activity"
          >
            <span class="flex items-center justify-center gap-2">
              <!-- <icon-lucide-activity /> -->
              Activity
            </span>
          </TabsTrigger>
          <TabsTrigger
            class="text-secondary-foreground data-[state=active]:after:bg-primary relative w-full rounded-md py-2.5 data-[state=active]:z-10 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:-bottom-2.5 data-[state=active]:after:h-0.5 data-[state=active]:after:w-full"
            value="settings"
          >
            <span class="flex items-center justify-center gap-2">
              <!-- <icon-lucide-settings /> -->
              Settings
            </span>
          </TabsTrigger>
        </TabsList>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <OverlayScrollbarsComponent
          defer
          :options="{ scrollbars: { autoHide: 'scroll' } }"
        >
          <TabsContent value="details" class="mt-0">
            <FlowDetails />
          </TabsContent>
          <TabsContent value="activity" class="mt-0">
            <FlowActivity />
          </TabsContent>
          <TabsContent value="settings" class="mt-0">
            <FlowSettings />
          </TabsContent>
        </OverlayScrollbarsComponent>
      </SidebarContent>
    </Sidebar>
  </Tabs>
</template>

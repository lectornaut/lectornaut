<script setup lang="ts">
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"

const source = ref(window.location.href)
const { copy, copied } = useClipboard({ source, legacy: true })

const metadata = [
  {
    id: "details",
    name: "Details",
  },
  {
    id: "activity",
    name: "Activity",
  },
  {
    id: "settings",
    name: "Settings",
  },
]
</script>

<template>
  <Tabs default-value="details" class="bg-card gap-0">
    <SidebarHeader>
      <div class="flex items-center justify-between gap-2">
        <span class="text-foreground ml-2 text-base font-medium">
          Information
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" @click="copy(source)">
                <icon-lucide-copy v-if="!copied" />
                <icon-lucide-check v-else />
              </Button>
            </TooltipTrigger>
            <TooltipContent> Copy URL </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </SidebarHeader>
    <Separator />
    <SidebarHeader>
      <TabsList class="bg-card w-full p-0">
        <TabsTrigger
          v-for="tab in metadata"
          :key="tab.id"
          :value="tab.id"
          class="data-[state=active]:after:bg-primary data-[state=active]:bg-card text-secondary-foreground data-[state=active]:text-foreground relative w-full py-2.5 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:-bottom-2.5 data-[state=active]:after:h-0.5 data-[state=active]:after:w-full"
        >
          <span class="flex items-center justify-center gap-2">
            <span> {{ tab.name }} </span>
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
        <TabsContent value="details">
          <FlowDetails />
        </TabsContent>
        <TabsContent value="activity">
          <FlowActivity />
        </TabsContent>
        <TabsContent value="settings">
          <FlowSettings />
        </TabsContent>
      </OverlayScrollbarsComponent>
    </SidebarContent>
  </Tabs>
</template>

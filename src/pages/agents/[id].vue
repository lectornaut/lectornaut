<script setup lang="ts">
definePage({
  meta: {
    layout: "agents",
    requiresUser: true,
    sidebar: "Agent",
    breadcrumb: (route: { params: { id: string } }) =>
      `Agent ${route?.params.id}`,
  },
})

useHead({
  title: "Agent",
})

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
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="bg-sidebar/50 w-full"> </Sidebar>
  </Teleport>
  <div class="flex grow flex-col overflow-auto overscroll-none">
    <div class="flex grow flex-col gap-2">
      <FlowApp />
    </div>
  </div>
  <Teleport defer to="#right-sidebar">
    <Tabs default-value="details" class="grow gap-0">
      <Sidebar collapsible="none" class="bg-sidebar/50 w-full">
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
          <OverlayScrollbarsWrapper>
            <TabsContent value="details">
              <FlowDetails />
            </TabsContent>
            <TabsContent value="activity">
              <FlowActivity />
            </TabsContent>
            <TabsContent value="settings">
              <FlowSettings />
            </TabsContent>
          </OverlayScrollbarsWrapper>
        </SidebarContent>
      </Sidebar>
    </Tabs>
  </Teleport>
</template>

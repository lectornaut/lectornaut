<script lang="ts" setup>
import { IconCheck, IconCopy } from "@/data/icons"

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

const { t } = useI18n()
const source = ref(window.location.href)
const { copy, copied } = useClipboard({ source, legacy: true })

const metadata = computed(() => [
  {
    id: "details",
    name: t("pages.agents.tabs.details"),
  },
  {
    id: "activity",
    name: t("pages.agents.tabs.activity"),
  },
  {
    id: "settings",
    name: t("pages.agents.tabs.settings"),
  },
])
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
  <div class="flex grow flex-col overflow-auto overscroll-none scroll-smooth">
    <div class="flex grow flex-col gap-2">
      <FlowApp />
    </div>
  </div>
  <Teleport defer to="#right-sidebar">
    <Tabs default-value="details" class="grow gap-0">
      <Sidebar collapsible="none" class="w-full">
        <SidebarHeader>
          <div class="flex items-center justify-between gap-2">
            <span class="text-foreground ml-2 text-base font-medium">
              {{ t("pages.agents.info") }}
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon" @click="copy(source)">
                    <IconCopy v-if="!copied" />
                    <IconCheck v-else />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {{ t("pages.agents.copyUrl") }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </SidebarHeader>
        <Separator />
        <SidebarHeader>
          <TabsList class="w-full bg-transparent">
            <TabsTrigger v-for="tab in metadata" :key="tab.id" :value="tab.id">
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

<script setup lang="ts">
import useDragAndDrop from "@/composables/useDnD"
import { nodes } from "@/data/nodes"

const { onDragStart } = useDragAndDrop()
</script>

<template>
  <Tabs default-value="actions">
    <Sidebar collapsible="none" class="bg-sidebar/50">
      <SidebarHeader>
        <div class="flex items-center justify-between gap-2">
          <span class="text-foreground ml-2 text-base font-medium">
            Widgets
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon">
                  <icon-lucide-settings />
                </Button>
              </TooltipTrigger>
              <TooltipContent> Settings </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </SidebarHeader>
      <Separator />
      <SidebarHeader>
        <TabsList class="w-full bg-transparent">
          <TabsTrigger v-for="tab in nodes" :key="tab.id" :value="tab.id">
            <span class="flex items-center justify-center gap-2">
              <span> {{ tab.name }} </span>
            </span>
          </TabsTrigger>
        </TabsList>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <TabsContent v-for="tab in nodes" :key="tab.id" :value="tab.id">
            <SidebarGroup
              v-for="group in tab.groups"
              :key="group.id"
              :value="group.id"
            >
              <SidebarGroupLabel>{{ group.name }}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <Collapsible
                    v-for="list in group.lists"
                    :key="list.id"
                    :value="list.id"
                    as-child
                    class="group/collapsible"
                  >
                    <SidebarMenuItem class="grid gap-2">
                      <CollapsibleTrigger as-child>
                        <SidebarMenuButton :class="[list.bg, list.color]">
                          <Component :is="list.icon" />
                          <span class="truncate font-medium">
                            {{ list.name }}
                          </span>
                          <icon-lucide-chevron-right
                            class="ml-auto transition group-data-[state=open]/collapsible:rotate-90"
                          />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent
                        class="rounded-md p-2"
                        :class="[list.bg]"
                      >
                        <SidebarMenu>
                          <SidebarMenuItem
                            v-for="node in list.nodes"
                            :key="node.id"
                          >
                            <SidebarMenuButton
                              :draggable="true"
                              class="rounded-md border border-dashed p-2"
                              :class="[list.bg, list.color, list.border]"
                              @dragstart="onDragStart($event, node.id)"
                            >
                              <icon-lucide-grip-horizontal class="opacity-70" />
                              <span>{{ node.name }}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        </SidebarMenu>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </TabsContent>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Tabs>
</template>

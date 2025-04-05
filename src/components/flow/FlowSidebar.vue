<script setup lang="ts">
import useDragAndDrop from "@/composables/useDnD"
import { nodes } from "@/data/nodes"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"

const { onDragStart } = useDragAndDrop()
</script>

<template>
  <Tabs default-value="actions">
    <Sidebar collapsible="none" class="shrink-0">
      <SidebarHeader class="border-b border-dashed">
        <div class="flex items-center justify-between gap-2">
          <span class="text-foreground ml-2 text-base font-medium">
            Widgets</span
          >
          <Button variant="ghost" size="icon">
            <icon-lucide-settings />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarHeader>
        <TabsList class="bg-background w-full p-0">
          <TabsTrigger
            v-for="tab in nodes"
            :key="tab.id"
            :value="tab.id"
            class="text-secondary-foreground data-[state=active]:after:bg-primary relative w-full rounded-md py-2.5 data-[state=active]:z-10 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:-bottom-2.5 data-[state=active]:after:h-0.5 data-[state=active]:after:w-full"
          >
            <span class="flex items-center justify-center gap-2">
              <span class="truncate"> {{ tab.name }} </span>
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
          <TabsContent
            v-for="tab in nodes"
            :key="tab.id"
            :value="tab.id"
            class="mt-0"
          >
            <SidebarGroup
              v-for="group in tab.groups"
              :key="group.id"
              :value="group.id"
            >
              <SidebarGroupLabel>{{ group.name }}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu class="gap-2">
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
                          <component :is="list.icon" />
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
                        <SidebarMenu class="gap-2">
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
                              <span class="truncate">{{ node.name }}</span>
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
        </OverlayScrollbarsComponent>
      </SidebarContent>
    </Sidebar>
  </Tabs>
</template>

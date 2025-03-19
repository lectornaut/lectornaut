<script setup lang="ts">
import type { SidebarProps } from "@/components/ui/sidebar"

const props = defineProps<SidebarProps>()
</script>

<template>
  <Sidebar v-bind="props" class="bg-muted/50">
    <SidebarHeader>
      <Tabs default-value="details">
        <TabsList class="bg-muted/50 w-full p-0">
          <TabsTrigger
            class="text-muted-foreground/50 w-full rounded-md py-2.5"
            value="details"
          >
            Details
          </TabsTrigger>
          <TabsTrigger
            class="text-muted-foreground/50 w-full rounded-md py-2.5"
            value="activity"
          >
            Activity
          </TabsTrigger>
          <TabsTrigger
            class="text-muted-foreground/50 w-full rounded-md py-2.5"
            value="settings"
          >
            Settings
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </SidebarHeader>
    <Separator />
    <SidebarContent> </SidebarContent>
    <SidebarRail />
  </Sidebar>
</template>

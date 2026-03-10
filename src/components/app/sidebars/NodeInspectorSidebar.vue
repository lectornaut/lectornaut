<script lang="ts" setup>
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"

defineProps<{
  teamId: string | null
  workspaceId: string | null
  scope: WorkspaceNodeScope
  node: WorkspaceNode | null
}>()
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <Tabs default-value="details" class="h-full min-h-0 gap-0">
      <TabsList class="bg-transparent p-2">
        <TabsTrigger
          value="details"
          class="data-[state=active]:bg-muted rounded-xs p-2! text-xs leading-0 data-[state=active]:shadow-none"
        >
          Details
        </TabsTrigger>
        <TabsTrigger
          value="attachments"
          class="data-[state=active]:bg-muted rounded-xs p-2! text-xs leading-0 data-[state=active]:shadow-none"
        >
          Attachments
        </TabsTrigger>
        <TabsTrigger
          value="activity"
          class="data-[state=active]:bg-muted rounded-xs p-2! text-xs leading-0 data-[state=active]:shadow-none"
        >
          Activity
        </TabsTrigger>
      </TabsList>

      <TabsContent value="details" class="h-0 min-h-0 flex-1">
        <NodeDetails :node="node" />
      </TabsContent>

      <TabsContent value="attachments" class="h-0 min-h-0 flex-1">
        <NodeAttachments
          :team-id="teamId"
          :workspace-id="workspaceId"
          :scope="scope"
          :node="node"
        />
      </TabsContent>

      <TabsContent value="activity" class="h-0 min-h-0 flex-1">
        <NodeActivityLog
          v-if="teamId && workspaceId && node"
          :team-id="teamId"
          :workspace-id="workspaceId"
          :document-id="node.id"
        />
        <div v-else class="p-4">
          <div class="text-muted-foreground text-xs">
            Select a file or folder to view activity history.
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </Sidebar>
</template>

<script lang="ts" setup>
import type { WorkspaceNode, WorkspaceNodeScope } from "@/types/nodes"

defineProps<{
  teamId: string | null
  workspaceId: string | null
  scope: WorkspaceNodeScope
  node: WorkspaceNode | null
}>()

const { t } = useI18n()
</script>

<template>
  <Sidebar collapsible="none" class="size-full">
    <Tabs default-value="bot" class="min-h-0 min-w-0 grow gap-0">
      <TabsList
        class="no-scrollbar m-2 w-[-webkit-fill-available] shrink-0 justify-start overflow-x-auto"
      >
        <TabsTrigger value="bot" class="text-xs">
          {{ t("ai.bot") }}
        </TabsTrigger>
        <TabsTrigger value="attachments" class="text-xs">
          {{ t("inspector.tabs.attachments") }}
        </TabsTrigger>
        <TabsTrigger value="details" class="text-xs">
          {{ t("inspector.tabs.details") }}
        </TabsTrigger>
        <TabsTrigger value="activity" class="text-xs">
          {{ t("inspector.tabs.activity") }}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="details" class="size-full h-0 min-h-0 min-w-0 grow">
        <NodeDetails
          v-if="teamId && workspaceId && node"
          :team-id="teamId"
          :workspace-id="workspaceId"
          :scope="scope"
          :node="node"
        />
        <div v-else class="text-muted-foreground p-3 text-xs">
          {{ t("inspector.details.empty") }}
        </div>
      </TabsContent>

      <TabsContent
        value="attachments"
        class="size-full h-0 min-h-0 min-w-0 grow"
      >
        <NodeAttachments
          v-if="teamId && workspaceId && node"
          :team-id="teamId"
          :workspace-id="workspaceId"
          :scope="scope"
          :node="node"
        />
        <div v-else class="text-muted-foreground p-3 text-xs">
          {{ t("inspector.attachments.empty") }}
        </div>
      </TabsContent>

      <TabsContent value="activity" class="size-full h-0 min-h-0 min-w-0 grow">
        <NodeActivityLog
          v-if="teamId && workspaceId && node"
          :team-id="teamId"
          :workspace-id="workspaceId"
          :document-id="node.id"
        />
        <div v-else class="text-muted-foreground p-3 text-xs">
          {{ t("inspector.activity.empty") }}
        </div>
      </TabsContent>

      <TabsContent value="bot" class="size-full h-0 min-h-0 min-w-0 grow">
        <NodeBot
          v-if="teamId && workspaceId && node"
          :team-id="teamId"
          :workspace-id="workspaceId"
          :scope="scope"
          :node="node"
        />
        <div v-else class="text-muted-foreground p-3 text-xs">
          {{ t("ai.botEmpty") }}
        </div>
      </TabsContent>
    </Tabs>
  </Sidebar>
</template>

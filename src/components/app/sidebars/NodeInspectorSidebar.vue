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
  <Sidebar collapsible="none" class="w-full">
    <Tabs default-value="bot" class="min-h-0 min-w-0 grow">
      <TabsList
        class="no-scrollbar bg-input/50 mx-2 mt-2 w-[-webkit-fill-available] shrink-0 justify-start overflow-x-auto border"
      >
        <TabsTrigger
          value="bot"
          class="data-[state=active]:border-border! data-[state=active]:bg-background"
        >
          {{ t("ai.bot") }}
        </TabsTrigger>
        <TabsTrigger
          value="attachments"
          class="data-[state=active]:border-border! data-[state=active]:bg-background"
        >
          {{ t("inspector.tabs.attachments") }}
        </TabsTrigger>
        <TabsTrigger
          value="related"
          class="data-[state=active]:border-border! data-[state=active]:bg-background"
        >
          {{ t("inspector.tabs.related") }}
        </TabsTrigger>
        <TabsTrigger
          value="details"
          class="data-[state=active]:border-border! data-[state=active]:bg-background"
        >
          {{ t("inspector.tabs.details") }}
        </TabsTrigger>
        <TabsTrigger
          value="activity"
          class="data-[state=active]:border-border! data-[state=active]:bg-background"
        >
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
        <div v-else class="text-muted-foreground px-2 text-xs">
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
        <div v-else class="text-muted-foreground px-2 text-xs">
          {{ t("inspector.attachments.empty") }}
        </div>
      </TabsContent>

      <TabsContent value="related" class="size-full h-0 min-h-0 min-w-0 grow">
        <NodeRelated
          v-if="teamId && workspaceId && node"
          :team-id="teamId"
          :workspace-id="workspaceId"
          :scope="scope"
          :node="node"
        />
        <div v-else class="text-muted-foreground px-2 text-xs">
          {{ t("inspector.related.empty") }}
        </div>
      </TabsContent>

      <TabsContent value="activity" class="size-full h-0 min-h-0 min-w-0 grow">
        <NodeActivityLog
          v-if="teamId && workspaceId && node"
          :team-id="teamId"
          :workspace-id="workspaceId"
          :document-id="node.id"
        />
        <div v-else class="text-muted-foreground px-2 text-xs">
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
        <div v-else class="text-muted-foreground px-2 text-xs">
          {{ t("ai.botEmpty") }}
        </div>
      </TabsContent>
    </Tabs>
  </Sidebar>
</template>

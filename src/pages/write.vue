<script lang="ts" setup>
import { useCollabPage } from "@/composables/useCollabPage"
import { IconFileText } from "@/data/icons"
import { useNodeBreadcrumb } from "@/helpers/breadcrumber"

definePage({
  // Single component handles `/write` (no file) and `/write/:nodeId` (open file).
  // The optional `:nodeId?` segment makes both addresses match here.
  path: "/write/:nodeId?",
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Write",
    breadcrumb: (route: { params?: { nodeId?: unknown } }) =>
      useNodeBreadcrumb("Write", "write")(route),
  },
})

const nodeScope = "write" as const

const isSerializedEmptyDoc = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const maybeDoc = value as {
    type?: unknown
    content?: Array<{
      type?: unknown
      content?: unknown[]
    }>
  }

  if (maybeDoc.type !== "doc") {
    return false
  }

  const nodes = maybeDoc.content ?? []
  if (!nodes.length) {
    return true
  }

  if (nodes.length !== 1) {
    return false
  }

  const [firstNode] = nodes
  if (firstNode?.type !== "paragraph") {
    return false
  }

  return !firstNode.content?.length
}

const normalizeStoredContent = (raw: string | null | undefined): string => {
  const normalized = raw ?? ""
  const trimmed = normalized.trim()
  if (!trimmed.length) {
    return ""
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (isSerializedEmptyDoc(parsed)) {
      return ""
    }
    return JSON.stringify(parsed)
  } catch {
    return normalized
  }
}

const {
  teamId,
  workspaceId,
  selectedNode,
  selectedFile,
  editorContent,
  isDirty,
  isSaving,
  editorReadOnly,
  collabSession,
  collabRole,
  collabError,
  collabReady,
  collabAwareness,
  saveContent,
} = useCollabPage({
  scope: nodeScope,
  basePath: "/write",
  normalizeContent: normalizeStoredContent,
})

const collabDoc = computed(() => collabSession.value?.ydoc ?? null)

useHead(() => ({
  title: selectedNode.value?.name
    ? `${selectedNode.value.name} · Write`
    : "Write",
}))
</script>

<template>
  <Teleport defer to="#left-sidebar">
    <Sidebar collapsible="none" class="w-full">
      <SidebarContent>
        <OverlayScrollbarsWrapper>
          <FileTree
            v-if="teamId && workspaceId"
            :team-id="teamId"
            :workspace-id="workspaceId"
            :scope="nodeScope"
          />
          <SidebarGroup v-else>
            <SidebarGroupLabel>Documents</SidebarGroupLabel>
            <SidebarGroupContent>
              <div class="text-muted-foreground px-4 py-2 text-xs">
                Select a workspace to view documents.
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>
  <div
    class="scroll-smoothborder m-2 flex grow flex-col overflow-auto overscroll-none"
  >
    <OverlayScrollbarsWrapper v-if="teamId && workspaceId && selectedFile">
      <TextEditor
        :key="`${selectedFile.id}:${collabDoc ? 'collab' : 'local'}:${collabAwareness ? 'aware' : 'noaware'}`"
        v-model="editorContent"
        :read-only="editorReadOnly"
        :collaboration-doc="collabDoc"
        :collaboration-awareness="collabAwareness"
      />
    </OverlayScrollbarsWrapper>
    <Empty v-else>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFileText />
        </EmptyMedia>
        <EmptyTitle>No document selected</EmptyTitle>
        <EmptyDescription>
          Select a workspace to view or edit documents.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>
  <Teleport defer to="#cta-dock">
    <div
      v-if="teamId && workspaceId && selectedFile"
      class="flex items-center gap-2"
    >
      <Badge v-if="collabRole" variant="outline" class="capitalize">
        <IconCloudAlert v-if="isDirty" class="text-muted-foreground" />
        <IconCloudCheck v-else class="text-muted-foreground" />
        {{ collabRole }}
      </Badge>
      <Spinner v-if="!collabReady && !collabError" />
      <CollabPresence v-else :awareness="collabAwareness" />
    </div>
    <Button
      v-if="teamId && workspaceId && selectedFile"
      :disabled="editorReadOnly || !isDirty || isSaving"
      @click="saveContent"
    >
      <Spinner v-if="isSaving" />
      Save
    </Button>
  </Teleport>
  <Teleport defer to="#right-sidebar">
    <NodeInspectorSidebar
      :team-id="teamId"
      :workspace-id="workspaceId"
      :scope="nodeScope"
      :node="selectedNode"
    />
  </Teleport>
</template>

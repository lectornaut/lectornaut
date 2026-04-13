<script lang="ts" setup>
import { useCodeMirrorCollab } from "@/composables/useCodeMirrorCollab"
import { useCollabPage } from "@/composables/useCollabPage"
import { IconFileText } from "@/data/icons"
import type { Extension } from "@codemirror/state"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Code",
    breadcrumb: "Code",
  },
})

const nodeScope = "code" as const
const collabExtensions = shallowRef<Extension[]>([])

const {
  teamId,
  workspaceId,
  selectedNode,
  selectedFile,
  editorContent,
  isDirty,
  isSaving,
  editorReadOnly,
  collabRole,
  collabError,
  collabReady,
  collabAwareness,
  saveContent,
} = useCollabPage({
  scope: nodeScope,
  basePath: "/code",
  onSessionCreated: (session, fileContent) => {
    const cmCollab = useCodeMirrorCollab(session, fileContent)
    collabExtensions.value = cmCollab.extensions
    return cmCollab.getText()
  },
  onSessionDestroyed: () => {
    collabExtensions.value = []
  },
})

useHead(() => ({
  title: selectedNode.value?.name
    ? `${selectedNode.value.name} · Code`
    : "Code",
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
      <CodeEditor
        v-model="editorContent"
        :read-only="editorReadOnly"
        :extensions="collabExtensions"
        :placeholder="
          selectedFile ? 'Start coding...' : 'Select a file to view or edit.'
        "
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

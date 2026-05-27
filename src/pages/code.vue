<script lang="ts" setup>
import { useCodeMirrorCollab } from "@/composables/useCodeMirrorCollab"
import { useCollabPage } from "@/composables/useCollabPage"
import { IconFileText } from "@/data/icons"
import { useNodeBreadcrumb } from "@/helpers/breadcrumber"
import type { Extension } from "@codemirror/state"

const { t } = useI18n()

definePage({
  // Single component handles `/code` (no file) and `/code/:nodeId` (open file).
  // The optional `:nodeId?` segment makes both addresses match here.
  path: "/code/:nodeId?",
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Code",
    breadcrumb: (route: { params?: { nodeId?: unknown } }) =>
      useNodeBreadcrumb("Code", "code")(route),
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
    ? t("pages.code.titleWithFile", { name: selectedNode.value.name })
    : t("pages.code.titleDefault"),
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
            <SidebarGroupLabel>{{
              t("pages.code.documents")
            }}</SidebarGroupLabel>
            <SidebarGroupContent>
              <div class="text-muted-foreground px-4 py-2 text-xs">
                {{ t("pages.code.selectWorkspace") }}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </OverlayScrollbarsWrapper>
      </SidebarContent>
    </Sidebar>
  </Teleport>
  <div
    class="m-2 flex grow flex-col overflow-auto overscroll-none scroll-smooth rounded border"
  >
    <OverlayScrollbarsWrapper v-if="teamId && workspaceId && selectedFile">
      <CodeEditor
        v-model="editorContent"
        :file-name="selectedNode?.name ?? ''"
        :read-only="editorReadOnly"
        :extensions="collabExtensions"
        :placeholder="
          selectedFile
            ? t('pages.code.placeholderStart')
            : t('pages.code.placeholderSelect')
        "
      />
    </OverlayScrollbarsWrapper>
    <Empty v-else>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFileText />
        </EmptyMedia>
        <EmptyTitle>{{ t("pages.code.emptyTitle") }}</EmptyTitle>
        <EmptyDescription>
          {{ t("pages.code.emptyDescription") }}
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
      {{ t("actions.save") }}
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

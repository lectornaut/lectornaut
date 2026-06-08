<script lang="ts" setup>
import { useCollabPage } from "@/composables/useCollabPage"
import { IconFileText } from "@/data/icons"
import { useNodeBreadcrumb } from "@/helpers/breadcrumber"

const { t } = useI18n()

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

// Template ref to the editor — used to flush pending edits before a save.
const editorRef = ref<{ flush?: () => void } | null>(null)

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
  externalEditorContent,
  adoptEditorBaseline,
  saveContent,
} = useCollabPage({
  scope: nodeScope,
  basePath: "/write",
  normalizeContent: normalizeStoredContent,
  flushPendingEdits: () => editorRef.value?.flush?.(),
})

const collabDoc = computed(() => collabSession.value?.ydoc ?? null)

useHead(() => ({
  title: selectedNode.value?.name
    ? t("pages.write.titleWithFile", { name: selectedNode.value.name })
    : t("pages.write.titleDefault"),
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
              t("pages.write.documents")
            }}</SidebarGroupLabel>
            <SidebarGroupContent>
              <div class="text-muted-foreground px-4 py-2 text-xs">
                {{ t("pages.write.selectWorkspace") }}
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
    <!--
      Mount the editor ONCE, only after the collab session resolves (ready or
      errored). Tiptap fixes its Collaboration extension at creation, so the old
      `:key` flipped local→collab and double-mounted the whole editor on every
      open (and risked dropping keystrokes typed into the throwaway local
      instance). Keying on the file id alone remounts only on a real file switch.
    -->
    <OverlayScrollbarsWrapper
      v-if="
        teamId && workspaceId && selectedFile && (collabReady || collabError)
      "
    >
      <TextEditor
        ref="editorRef"
        :key="selectedFile.id"
        v-model="editorContent"
        :read-only="editorReadOnly"
        :collaboration-doc="collabDoc"
        :collaboration-awareness="collabAwareness"
        :external-content="externalEditorContent"
        @baseline="adoptEditorBaseline"
      />
    </OverlayScrollbarsWrapper>
    <LoadingState v-else-if="teamId && workspaceId && selectedFile" />
    <Empty v-else>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFileText />
        </EmptyMedia>
        <EmptyTitle>{{ t("pages.write.emptyTitle") }}</EmptyTitle>
        <EmptyDescription>
          {{ t("pages.write.emptyDescription") }}
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

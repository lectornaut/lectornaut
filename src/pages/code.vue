<script lang="ts" setup>
import { useActiveTabIndicator } from "@/composables/useActiveTabIndicator"
import { IconFileText } from "@/data/icons"
import { showErrorToast, showSuccessToast } from "@/helpers/toast"
import { useAuthStore } from "@/stores/authStore"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import {
  createYjsCollab,
  type YjsCollabSession,
} from "@/utils/collab/yjsBinding"
import { storeToRefs } from "pinia"
import { useRoute, useRouter } from "vue-router"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Code",
    breadcrumb: "Code",
  },
})

const workspaceStore = useWorkspaceStore()
const fileTreeStore = useFileTreeStore()
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const { currentWorkspace } = storeToRefs(workspaceStore)
const { currentUser, userProfile } = storeToRefs(authStore)
const nodeScope = "code" as const

const teamId = computed(() => currentWorkspace.value?.teamId ?? null)
const workspaceId = computed(() => currentWorkspace.value?.id ?? null)
const routeNodeId = computed(() => {
  const raw = route.params.nodeId
  return typeof raw === "string" && raw.length ? raw : null
})
const selectedNodeId = computed(() => {
  if (!teamId.value || !workspaceId.value) return null
  return fileTreeStore.getSelectedNodeId(
    nodeScope,
    teamId.value,
    workspaceId.value
  )
})
const isSyncingSelectionAndRoute = ref(false)

const selectedNode = computed(() => {
  if (!teamId.value || !workspaceId.value) return null
  return fileTreeStore.getSelectedNode(
    nodeScope,
    teamId.value,
    workspaceId.value
  )
})

useHead(() => ({
  title: selectedNode.value?.name
    ? `${selectedNode.value.name} · Code`
    : "Code",
}))

const selectedFile = computed(() => {
  if (!selectedNode.value) return null
  if (selectedNode.value.type !== "file") return null
  if (selectedNode.value.isArchived) return null
  return selectedNode.value
})
const selectedFileId = computed(() => selectedFile.value?.id ?? null)
const tabIndicator = computed(() => {
  if (!selectedFile.value) return null

  if (isSaving.value) {
    return {
      label: t("states.syncing"),
      tone: "info" as const,
      spin: true,
    }
  }

  if (collabError.value) {
    return {
      label: t("states.offline"),
      tone: "danger" as const,
    }
  }

  if (isDirty.value) {
    return {
      label: t("common.unsavedChanges"),
      tone: "warning" as const,
      pulse: true,
    }
  }

  if (collabReady.value) {
    return {
      label: t("states.synced"),
      tone: "success" as const,
    }
  }

  return null
})

const editorContent = ref("")
const isDirty = ref(false)
const isSaving = ref(false)
const collabSession = shallowRef<YjsCollabSession | null>(null)
const collabRole = ref<"editor" | "viewer" | null>(null)
const collabError = ref<string | null>(null)
const collabReady = ref(false)
const collabExtensions = computed(
  () => collabSession.value?.getExtensions() ?? []
)
const collabAwareness = computed(() => collabSession.value?.awareness ?? null)

const editorReadOnly = computed(() => {
  if (!selectedFile.value) return true
  return collabRole.value !== "editor"
})

watch(
  [routeNodeId, teamId, workspaceId],
  async ([nodeIdFromRoute, currentTeamId, currentWorkspaceId]) => {
    if (
      !currentTeamId ||
      !currentWorkspaceId ||
      isSyncingSelectionAndRoute.value
    ) {
      return
    }

    isSyncingSelectionAndRoute.value = true
    try {
      if (!nodeIdFromRoute) {
        fileTreeStore.setSelectedNode(
          nodeScope,
          currentTeamId,
          currentWorkspaceId,
          null
        )
        return
      }

      const node = await fileTreeStore.ensureNodeLoaded(
        nodeScope,
        currentTeamId,
        currentWorkspaceId,
        nodeIdFromRoute
      )

      if (!node || node.isArchived) {
        fileTreeStore.setSelectedNode(
          nodeScope,
          currentTeamId,
          currentWorkspaceId,
          null
        )
        await router.replace("/code")
        return
      }

      fileTreeStore.setSelectedNode(
        nodeScope,
        currentTeamId,
        currentWorkspaceId,
        nodeIdFromRoute
      )
    } finally {
      isSyncingSelectionAndRoute.value = false
    }
  },
  { immediate: true }
)

watch(
  [selectedNodeId, teamId, workspaceId],
  async ([nodeId, currentTeamId, currentWorkspaceId]) => {
    if (
      !currentTeamId ||
      !currentWorkspaceId ||
      isSyncingSelectionAndRoute.value
    ) {
      return
    }

    const targetPath = nodeId ? `/code/${nodeId}` : "/code"
    if (route.path === targetPath) {
      return
    }

    isSyncingSelectionAndRoute.value = true
    try {
      await router.replace(targetPath)
    } finally {
      isSyncingSelectionAndRoute.value = false
    }
  }
)

watch(
  [selectedFileId, teamId, workspaceId, currentUser],
  async (
    [fileId, currentTeamId, currentWorkspaceId, user],
    _oldValue,
    onCleanup
  ) => {
    const file = selectedFile.value
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })

    collabError.value = null
    collabReady.value = false
    collabRole.value = null
    editorContent.value = file?.content ?? ""
    isDirty.value = false

    const previousSession = collabSession.value
    collabSession.value = null

    if (previousSession) {
      await previousSession.destroy().catch((error) => {
        console.error("[collab] Failed to destroy previous session", error)
      })
    }

    if (!fileId || !file || !currentTeamId || !currentWorkspaceId || !user) {
      return
    }

    collabReady.value = false

    try {
      const session = await createYjsCollab({
        contentId: file.id,
        teamId: currentTeamId,
        workspaceId: currentWorkspaceId,
        scope: nodeScope,
        initialContent: file.content ?? "",
        user: {
          uid: user.uid,
          displayName: userProfile.value?.displayName ?? user.displayName,
          photoURL: userProfile.value?.photoURL ?? user.photoURL,
        },
      })

      if (cancelled) {
        await session.destroy()
        return
      }

      collabSession.value = session
      collabRole.value = session.role
      editorContent.value = session.getText()
      collabReady.value = true
    } catch (error) {
      if (cancelled) {
        return
      }

      const message =
        (error as Error).message || "Unable to join collaboration room."
      collabError.value = message
      collabReady.value = false
      showErrorToast("Collaboration unavailable", message)
    }
  },
  { immediate: true }
)

watch(editorContent, (value) => {
  if (!selectedFile.value) {
    isDirty.value = false
    return
  }
  isDirty.value = value !== (selectedFile.value.content ?? "")
})

const saveContent = async () => {
  if (!selectedFile.value || !teamId.value || !workspaceId.value) return
  if (isSaving.value) return
  if (editorReadOnly.value) {
    showErrorToast("Read-only", "You do not have permission to edit this file.")
    return
  }

  isSaving.value = true
  try {
    await fileTreeStore.saveFileContent(
      nodeScope,
      teamId.value,
      workspaceId.value,
      selectedFile.value.id,
      editorContent.value
    )
    isDirty.value = false
    showSuccessToast("Saved")
  } catch (error) {
    showErrorToast("Failed to save", (error as Error).message)
  } finally {
    isSaving.value = false
  }
}

onBeforeUnmount(() => {
  const session = collabSession.value
  collabSession.value = null
  if (!session) return

  void session.destroy().catch((error) => {
    console.error("[collab] Failed to destroy session on unmount", error)
  })
})

useActiveTabIndicator(tabIndicator)
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
    class="m-2 flex grow flex-col overflow-auto overscroll-none scroll-smooth rounded border"
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
      size="sm"
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

<script lang="ts" setup>
import { createYjsCollab, type YjsCollabSession } from "@/collab/yjsBinding"
import { useAuthStore } from "@/stores/authStore"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { showErrorToast, showSuccessToast } from "@/utils/toast-helpers"
import { storeToRefs } from "pinia"
import { useRoute, useRouter } from "vue-router"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Write",
    breadcrumb: "Write",
  },
})

const workspaceStore = useWorkspaceStore()
const fileTreeStore = useFileTreeStore()
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

const { currentWorkspace } = storeToRefs(workspaceStore)
const { currentUser, userProfile } = storeToRefs(authStore)
const nodeScope = "write" as const

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
    ? `${selectedNode.value.name} · Write`
    : "Write",
}))

const selectedFile = computed(() => {
  if (!selectedNode.value) return null
  if (selectedNode.value.type !== "file") return null
  if (selectedNode.value.isArchived) return null
  return selectedNode.value
})

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

const normalizeStoredContent = (value: string | null | undefined): string => {
  const normalized = value ?? ""
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

const editorContent = ref("")
const isDirty = ref(false)
const collabSession = shallowRef<YjsCollabSession | null>(null)
const collabRole = ref<"editor" | "viewer" | null>(null)
const collabError = ref<string | null>(null)
const collabReady = ref(false)
const collabAwareness = computed(() => collabSession.value?.awareness ?? null)
const collabDoc = computed(() => collabSession.value?.ydoc ?? null)

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
        await router.replace("/write")
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

    const targetPath = nodeId ? `/write/${nodeId}` : "/write"
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
  [selectedFile, teamId, workspaceId, currentUser],
  async (
    [file, currentTeamId, currentWorkspaceId, user],
    _oldValue,
    onCleanup
  ) => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })

    collabError.value = null
    collabReady.value = false
    collabRole.value = null
    editorContent.value = normalizeStoredContent(file?.content ?? "")
    isDirty.value = false

    const previousSession = collabSession.value
    collabSession.value = null

    if (previousSession) {
      await previousSession.destroy().catch((error) => {
        console.error("[collab] Failed to destroy previous session", error)
      })
    }

    if (!file || !currentTeamId || !currentWorkspaceId || !user) {
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

  isDirty.value =
    normalizeStoredContent(value) !==
    normalizeStoredContent(selectedFile.value.content ?? "")
})

const saveContent = async () => {
  if (!selectedFile.value || !teamId.value || !workspaceId.value) return
  if (editorReadOnly.value) {
    showErrorToast("Read-only", "You do not have permission to edit this file.")
    return
  }

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
    class="m-2 flex grow flex-col overflow-auto overscroll-none scroll-smooth rounded-2xl border"
  >
    <div
      v-if="teamId && workspaceId && selectedFile"
      class="bg-card flex items-center justify-between border-b p-2"
    >
      <div class="flex min-w-0 items-center gap-2">
        <Badge v-if="collabRole" variant="secondary" class="uppercase">
          {{ collabRole }}
        </Badge>
        <span class="truncate text-sm font-medium">
          {{ selectedFile.name }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Spinner v-if="!collabReady && !collabError" />
        <CollabPresence :awareness="collabAwareness" />
      </div>
    </div>
    <TextEditor
      v-if="teamId && workspaceId && selectedFile"
      :key="`${selectedFile.id}:${collabDoc ? 'collab' : 'local'}:${collabAwareness ? 'aware' : 'noaware'}`"
      v-model="editorContent"
      :read-only="editorReadOnly"
      :collaboration-doc="collabDoc"
      :collaboration-awareness="collabAwareness"
    />
    <div
      v-else
      class="text-muted-foreground flex grow items-center justify-center px-4 text-center"
    >
      Select a workspace to view or edit documents.
    </div>
  </div>
  <Teleport defer to="#cta-dock">
    <Button
      size="sm"
      :disabled="!selectedFile || !isDirty || editorReadOnly"
      @click="saveContent"
    >
      Save
    </Button>
  </Teleport>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>

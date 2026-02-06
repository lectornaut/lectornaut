<script lang="ts" setup>
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { showErrorToast, showSuccessToast } from "@/utils/toast-helpers"
import { storeToRefs } from "pinia"

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Code",
    breadcrumb: "Code",
  },
})

useHead({
  title: "Code",
})

const workspaceStore = useWorkspaceStore()
const fileTreeStore = useFileTreeStore()

const { currentWorkspace } = storeToRefs(workspaceStore)

const teamId = computed(() => currentWorkspace.value?.teamId ?? null)
const workspaceId = computed(() => currentWorkspace.value?.id ?? null)

const selectedNode = computed(() => {
  if (!teamId.value || !workspaceId.value) return null
  return fileTreeStore.getSelectedNode(teamId.value, workspaceId.value)
})

const selectedFile = computed(() => {
  if (!selectedNode.value) return null
  if (selectedNode.value.type !== "file") return null
  if (selectedNode.value.isDeleted) return null
  return selectedNode.value
})

const editorContent = ref("")
const isDirty = ref(false)

watch(
  selectedFile,
  (file) => {
    editorContent.value = file?.content ?? ""
    isDirty.value = false
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
  try {
    await fileTreeStore.saveFileContent(
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
  <div class="flex grow flex-col overflow-auto overscroll-none scroll-smooth">
    <CodeEditor
      v-if="teamId && workspaceId && selectedFile"
      v-model="editorContent"
      :read-only="!selectedFile"
      :placeholder="
        selectedFile ? 'Start coding...' : 'Select a file to view or edit.'
      "
    />
    <div
      v-else
      class="text-muted-foreground flex grow items-center justify-center px-4 text-center"
    >
      Select a workspace to view or edit documents.
    </div>
    <Teleport defer to="#cta-dock">
      <Button :disabled="!selectedFile || !isDirty" @click="saveContent">
        Save
      </Button>
    </Teleport>
  </div>
  <Teleport defer to="#right-sidebar">
    <Sidebar collapsible="none" class="w-full"></Sidebar>
  </Teleport>
</template>

<script lang="ts" setup>
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"

const workspaceStore = useWorkspaceStore()
const fileTreeStore = useFileTreeStore()
const { currentWorkspace } = storeToRefs(workspaceStore)

definePage({
  meta: {
    requiresUser: true,
    layout: "app",
    sidebar: "Code",
    breadcrumb: (route: { params: { nodeId?: string } }) => {
      const nodeId = route.params?.nodeId
      const teamId = currentWorkspace.value?.teamId
      const workspaceId = currentWorkspace.value?.id

      if (!nodeId || !teamId || !workspaceId) return "Code"

      const node = fileTreeStore.getNode(teamId, workspaceId, nodeId)
      return node?.name || "Code"
    },
  },
})
</script>

<template>
  <Code />
</template>

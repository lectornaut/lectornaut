<script lang="ts" setup>
import {
  IconCalendar,
  IconClock,
  IconFolder,
  IconHash,
  IconInfo,
  IconUserRound,
} from "@/data/icons"
import { useAuthStore } from "@/stores/authStore"
import { useMembershipStore } from "@/stores/membershipStore"
import { ROOT_PARENT_ID, type WorkspaceNode } from "@/types/nodes"
import { storeToRefs } from "pinia"
import { toRef } from "vue"

const props = defineProps<{
  node: WorkspaceNode | null
}>()

const node = toRef(props, "node")
const authStore = useAuthStore()
const membershipStore = useMembershipStore()

const { currentUser, userProfile } = storeToRefs(authStore)
const { teamMembers } = storeToRefs(membershipStore)

const formatTimestamp = (
  value:
    | {
        toDate?: () => Date
      }
    | null
    | undefined
) => {
  const timestamp = value?.toDate?.()
  return timestamp
    ? useDateFormat(timestamp, "MMM D, YYYY · h:mm A").value
    : "—"
}

const formatActor = (userId: string | null | undefined) => {
  if (!userId) return "Unknown"
  if (userId === "local") return "Local"

  if (currentUser.value?.uid === userId) {
    return (
      userProfile.value?.displayName ||
      currentUser.value.displayName ||
      currentUser.value.email ||
      "You"
    )
  }

  const member = teamMembers.value.find((entry) => entry.userId === userId)
  if (!member) return userId

  return member.user?.displayName || member.user?.email || member.userId
}

const nodeTypeLabel = computed(() => {
  if (!node.value) return "—"
  return node.value.type === "file" ? "File" : "Folder"
})

const nodeParentLabel = computed(() => {
  if (!node.value) return "—"
  return node.value.parentId === ROOT_PARENT_ID ? "Root" : node.value.parentId
})

const nodeStatusLabel = computed(() => {
  if (!node.value) return "—"
  return node.value.isArchived ? "Archived" : "Active"
})
</script>

<template>
  <Sidebar collapsible="none" class="w-full">
    <SidebarContent>
      <OverlayScrollbarsWrapper>
        <SidebarGroup>
          <SidebarGroupContent>
            <div v-if="!node" class="text-muted-foreground p-2 text-xs">
              Select a file or folder to view its details.
            </div>

            <div v-else class="space-y-3 p-2">
              <dl class="space-y-4">
                <div class="flex items-start justify-between gap-2">
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconUserRound />
                    Author
                  </dt>
                  <dd class="text-right break-all">
                    {{ formatActor(node.createdBy) }}
                  </dd>
                </div>

                <div class="flex items-start justify-between gap-2">
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconUserRound />
                    Updated by
                  </dt>
                  <dd class="text-right break-all">
                    {{ formatActor(node.updatedBy) }}
                  </dd>
                </div>

                <div class="flex items-start justify-between gap-2">
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconCalendar />
                    Created
                  </dt>
                  <dd class="text-right">
                    {{ formatTimestamp(node.createdAt) }}
                  </dd>
                </div>

                <div class="flex items-start justify-between gap-2">
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconClock />
                    Updated
                  </dt>
                  <dd class="text-right">
                    {{ formatTimestamp(node.updatedAt) }}
                  </dd>
                </div>

                <div class="flex items-start justify-between gap-2">
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconInfo />
                    Type
                  </dt>
                  <dd class="text-right">
                    {{ nodeTypeLabel }}
                  </dd>
                </div>

                <div class="flex items-start justify-between gap-2">
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconInfo />
                    Status
                  </dt>
                  <dd class="text-right">
                    {{ nodeStatusLabel }}
                  </dd>
                </div>

                <div class="flex items-start justify-between gap-2">
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconFolder />
                    Parent
                  </dt>
                  <dd class="text-right break-all">
                    {{ nodeParentLabel }}
                  </dd>
                </div>

                <div
                  v-if="node.isArchived"
                  class="flex items-start justify-between gap-2"
                >
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconCalendar />
                    Archived
                  </dt>
                  <dd class="text-right">
                    {{ formatTimestamp(node.archivedAt) }}
                  </dd>
                </div>

                <div
                  v-if="node.isArchived"
                  class="flex items-start justify-between gap-2"
                >
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconUserRound />
                    Archived by
                  </dt>
                  <dd class="text-right break-all">
                    {{ formatActor(node.archivedBy) }}
                  </dd>
                </div>

                <div class="flex items-start justify-between gap-2">
                  <dt class="text-muted-foreground flex items-center gap-2">
                    <IconHash />
                    Node ID
                  </dt>
                  <dd class="text-right break-all">{{ node.id }}</dd>
                </div>
              </dl>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </OverlayScrollbarsWrapper>
    </SidebarContent>
  </Sidebar>
</template>

<script lang="ts" setup>
import {
  IconArrowLeft,
  IconArrowRight,
  IconHome,
  IconRefreshCcw,
} from "@/data/icons"
import { useRouteBreadcrumbs } from "@/helpers/breadcrumber"
import { useFileTreeStore } from "@/stores/fileTreeStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { storeToRefs } from "pinia"

const breadcrumbs = useRouteBreadcrumbs()
const router = useRouter()
const route = useRoute()
const workspaceStore = useWorkspaceStore()
const fileTreeStore = useFileTreeStore()
const { currentWorkspace } = storeToRefs(workspaceStore)

const selectedCodeNodeName = computed(() => {
  if (!route.path.startsWith("/code/")) return null

  const nodeId = route.params.nodeId
  if (typeof nodeId !== "string" || !nodeId.length) return null

  const teamId = currentWorkspace.value?.teamId
  const workspaceId = currentWorkspace.value?.id
  if (!teamId || !workspaceId) return null

  return fileTreeStore.getNode(teamId, workspaceId, nodeId)?.name ?? null
})

const displayBreadcrumbs = computed(() => {
  const items = breadcrumbs.value
  if (!selectedCodeNodeName.value || !items.length) return items

  const lastIndex = items.length - 1
  return items.map((item, index) =>
    index === lastIndex
      ? {
          ...item,
          breadcrumb: selectedCodeNodeName.value,
        }
      : item
  )
})
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage as-child>
              <BreadcrumbLink as-child>
                <Button variant="outline" size="icon-sm" as-child>
                  <RouterLink to="/start">
                    <IconHome />
                  </RouterLink>
                </Button>
              </BreadcrumbLink>
            </BreadcrumbPage>
          </BreadcrumbItem>
          <BreadcrumbSeparator class="text-muted-foreground/50" />
          <template v-for="(item, index) in displayBreadcrumbs" :key="index">
            <BreadcrumbItem>
              <BreadcrumbPage v-if="item.isCurrent">
                {{ item.breadcrumb }}
              </BreadcrumbPage>
              <template v-else>
                <BreadcrumbPage as-child>
                  <BreadcrumbLink as-child>
                    <RouterLink :to="item.route">
                      {{ item.breadcrumb }}
                    </RouterLink>
                  </BreadcrumbLink>
                </BreadcrumbPage>
                <BreadcrumbSeparator class="text-muted-foreground/50" />
              </template>
            </BreadcrumbItem>
          </template>
        </BreadcrumbList>
      </Breadcrumb>
    </ContextMenuTrigger>
    <ContextMenuContent align="start" side="bottom">
      <ContextMenuItem @click="router.go(0)">
        <IconRefreshCcw /> Refresh
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @click="router.go(-1)">
        <IconArrowLeft /> Go back
      </ContextMenuItem>
      <ContextMenuItem @click="router.go(1)">
        <IconArrowRight /> Go forward
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>

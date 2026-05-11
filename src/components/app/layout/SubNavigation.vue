<script lang="ts" setup>
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import {
  IconArrowLeft,
  IconArrowRight,
  IconHome,
  IconRefreshCcw,
} from "@/data/icons"
import { useRouteBreadcrumbs } from "@/helpers/breadcrumber"
import { useFileTreeStore } from "@/stores/fileTreeStore"

const { t } = useI18n()
const breadcrumbs = useRouteBreadcrumbs()
const router = useRouter()
const route = useRoute()
const { currentWorkspace } = useWorkspaceActions()
const fileTreeStore = useFileTreeStore()

const selectedRouteNodeName = computed(() => {
  let scope: "code" | "write" | null = null
  if (route.path.startsWith("/code/")) {
    scope = "code"
  } else if (route.path.startsWith("/write/")) {
    scope = "write"
  }
  if (!scope) return null

  const nodeId = (route.params as { nodeId?: string }).nodeId
  if (typeof nodeId !== "string" || !nodeId.length) return null

  const teamId = currentWorkspace.value?.teamId
  const workspaceId = currentWorkspace.value?.id
  if (!teamId || !workspaceId) return null

  return fileTreeStore.getNode(scope, teamId, workspaceId, nodeId)?.name ?? null
})

const displayBreadcrumbs = computed(() => {
  const items = breadcrumbs.value
  if (!selectedRouteNodeName.value || !items.length) return items

  const lastIndex = items.length - 1
  return items.map((item, index) =>
    index === lastIndex
      ? {
          ...item,
          breadcrumb: selectedRouteNodeName.value,
        }
      : item
  )
})

// Pages teleport custom toggle buttons into these docks. When a dock is
// empty, we render a generic <SubNavigationSidebarToggle/> as a fallback.
// Tracking emptiness via MutationObserver keeps the fallback in sync as
// pages mount/unmount their teleported content.
const leftActionDock = ref<HTMLElement | null>(null)
const rightActionDock = ref<HTMLElement | null>(null)
const leftActionEmpty = ref(true)
const rightActionEmpty = ref(true)

const refreshLeftEmpty = () => {
  leftActionEmpty.value = !leftActionDock.value?.firstElementChild
}
const refreshRightEmpty = () => {
  rightActionEmpty.value = !rightActionDock.value?.firstElementChild
}

useMutationObserver(leftActionDock, refreshLeftEmpty, { childList: true })
useMutationObserver(rightActionDock, refreshRightEmpty, { childList: true })

onMounted(() => {
  void nextTick(() => {
    refreshLeftEmpty()
    refreshRightEmpty()
  })
})
</script>

<template>
  <div
    class="bg-sidebar shadow-muted-foreground/5 mx-2 flex flex-1 items-center gap-2 overflow-clip rounded-b-xl border-x border-b p-2 shadow-xs"
  >
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <Breadcrumb>
          <BreadcrumbList>
            <TooltipProvider>
              <ButtonGroup>
                <SubNavigationSidebarToggle
                  v-if="leftActionEmpty"
                  side="left"
                />
                <div
                  id="sub-nav-left-action"
                  ref="leftActionDock"
                  class="contents"
                />
                <Tooltip>
                  <TooltipTrigger as-child>
                    <!-- <BreadcrumbItem>
                      <BreadcrumbPage as-child>
                        <BreadcrumbLink as-child> -->
                    <Button variant="outline" size="icon" as-child>
                      <RouterLink to="/new">
                        <IconHome />
                      </RouterLink>
                    </Button>
                    <!-- </BreadcrumbLink>
                      </BreadcrumbPage>
                    </BreadcrumbItem> -->
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("components.subNavigation.tooltips.home") }}
                  </TooltipContent>
                </Tooltip>
              </ButtonGroup>
            </TooltipProvider>
            <BreadcrumbSeparator class="text-muted-foreground/50" />
            <template
              v-for="item in displayBreadcrumbs"
              :key="String(item.route)"
            >
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
      <ContextMenuContent class="w-50">
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
    <div class="ms-auto flex items-center gap-2">
      <div
        id="cta-dock"
        class="flex shrink-0 items-center justify-end gap-2 empty:hidden"
      />
      <div id="sub-nav-right-action" ref="rightActionDock" class="contents" />
      <SubNavigationSidebarToggle v-if="rightActionEmpty" side="right" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
  IconArrowLeft,
  IconArrowRight,
  IconHome,
  IconRefreshCcw,
} from "@/data/icons"
import { useRouteBreadcrumbs } from "@/helpers/breadcrumber"

const breadcrumbs = useRouteBreadcrumbs()
const router = useRouter()
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
          <template v-for="(item, index) in breadcrumbs" :key="index">
            <BreadcrumbItem>
              <BreadcrumbPage
                v-if="index === breadcrumbs.length - 1"
                class="text-muted-foreground"
              >
                {{ item.breadcrumb }}
              </BreadcrumbPage>
              <template v-else>
                <BreadcrumbPage as-child>
                  <BreadcrumbLink as-child>
                    <Button variant="ghost" size="sm" as-child>
                      <RouterLink :to="item.route">
                        {{ item.breadcrumb }}
                      </RouterLink>
                    </Button>
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

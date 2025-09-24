<script setup lang="ts">
import { useRouteBreadcrumbs } from "@/helpers/breadcrumber"

const breadcrumbs = useRouteBreadcrumbs()
const router = useRouter()
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div class="bg-background flex items-center justify-between gap-2 p-2">
        <div class="flex gap-2">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage as-child>
                  <BreadcrumbLink as-child>
                    <Button variant="ghost" as-child>
                      <RouterLink to="/home">
                        <icon-lucide-home />
                      </RouterLink>
                    </Button>
                  </BreadcrumbLink>
                </BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <template v-for="(item, index) in breadcrumbs" :key="index">
                <BreadcrumbItem>
                  <BreadcrumbPage as-child>
                    <BreadcrumbLink as-child>
                      <Button variant="ghost" as-child>
                        <RouterLink :to="item.route">
                          {{ item.breadcrumb }}
                        </RouterLink>
                      </Button>
                    </BreadcrumbLink>
                  </BreadcrumbPage>
                  <BreadcrumbSeparator
                    v-if="index != Object.keys(breadcrumbs).length - 1"
                  />
                </BreadcrumbItem>
              </template>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div class="flex gap-2"></div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent align="start" side="bottom">
      <ContextMenuItem @click="router.go(0)">
        <icon-lucide-refresh-ccw /> Refresh
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @click="router.go(-1)">
        <icon-lucide-arrow-left /> Go back
      </ContextMenuItem>
      <ContextMenuItem @click="router.go(1)">
        <icon-lucide-arrow-right /> Go forward
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>

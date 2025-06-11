<script setup lang="ts">
import { useRouteBreadcrumbs } from "@/helpers/breadcrumber"

const breadcrumbs = useRouteBreadcrumbs()
</script>

<template>
  <div class="flex items-center justify-between gap-2 p-2">
    <Breadcrumb>
      <BreadcrumbList>
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
    <div class="flex gap-2">
      <!-- <Button variant="outline">
        <icon-lucide-play />
        Run
      </Button>
      <Button>
        <icon-lucide-check-check />
        Publish
      </Button> -->
    </div>
  </div>
</template>

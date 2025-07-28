<script setup lang="ts">
import { useRouteBreadcrumbs } from "@/helpers/breadcrumber"

const breadcrumbs = useRouteBreadcrumbs()
</script>

<template>
  <div class="bg-background flex items-center justify-between gap-2 p-2">
    <div class="flex gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon">
              <icon-lucide-arrow-left />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Go back </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon">
              <icon-lucide-arrow-right />
            </Button>
          </TooltipTrigger>
          <TooltipContent> Go forward </TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
    </div>
    <div class="flex gap-2"></div>
  </div>
</template>

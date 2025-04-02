<script setup lang="ts">
import { links } from "@/data/data"
import { OverlayScrollbarsComponent } from "overlayscrollbars-vue"
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-auto overscroll-none">
    <OverlayScrollbarsComponent
      defer
      :options="{ scrollbars: { autoHide: 'scroll' } }"
    >
      <nav class="flex flex-col gap-2 p-2">
        <TooltipProvider>
          <template v-for="(link, index) of links" :key="`1-${index}`">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  class="text-muted-foreground grow justify-start gap-3 truncate font-normal"
                  as-child
                >
                  <RouterLink :to="link.to">
                    <Component :is="link.icon" />
                    <span class="truncate">
                      {{ link.title }}
                    </span>
                  </RouterLink>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" class="flex items-center gap-2">
                {{ link.title }}
                <span class="text-muted-foreground">
                  {{ link.label }}
                </span>
              </TooltipContent>
            </Tooltip>
          </template>
        </TooltipProvider>
      </nav>
    </OverlayScrollbarsComponent>
  </div>
</template>

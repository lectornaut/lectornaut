<script setup lang="ts">
import { links } from "@/data/data"

defineProps<{
  leftSidebarVisibility: boolean
}>()
</script>

<template>
  <nav class="flex flex-col gap-2 p-2">
    <TooltipProvider>
      <template v-for="(link, index) of links" :key="`1-${index}`">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              :size="leftSidebarVisibility ? 'default' : 'icon'"
              class="text-muted-foreground grow gap-3 truncate font-normal"
              :class="{ 'justify-start': leftSidebarVisibility }"
              as-child
            >
              <RouterLink :to="link.to">
                <Component :is="link.icon" />
                <span v-if="leftSidebarVisibility" class="truncate">
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
</template>

<style lang="scss" scoped>
.router-link-exact-active,
.router-link-active {
  @apply bg-primary;
  @apply text-primary-foreground;
  @apply hover:bg-primary/90;
}
</style>

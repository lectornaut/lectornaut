<script setup lang="ts">
import { links } from "@/data/data"
</script>

<template>
  <nav class="flex flex-col p-2">
    <TooltipProvider>
      <template v-for="(link, index) of links" :key="`1-${index}`">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              class="grow justify-start gap-3 truncate font-normal text-muted-foreground"
              size="sm"
              as-child
            >
              <RouterLink :to="link.to">
                <Component :is="link.icon" />
                <span class="truncate">{{ link.title }}</span>
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

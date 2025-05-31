<script setup lang="ts">
import Avatar from "vue-boring-avatars"
</script>

<template>
  <div id="tour-team-members" class="flex flex-col space-y-2">
    <TooltipProvider>
      <Tooltip v-for="index in 3" :key="index" as-child>
        <TooltipTrigger
          class="group hover:bg-sidebar-accent flex aspect-square items-center justify-center rounded-md transition"
        >
          <Avatar
            :name="`Agent ${index}`"
            :size="16"
            variant="beam"
            :title="false"
            :square="true"
            :colors="[
              'var(--chart-5)',
              'var(--chart-4)',
              'var(--chart-3)',
              'var(--chart-1)',
              'var(--chart-1)',
            ]"
            class="rounded-full p-0 grayscale transition group-hover:grayscale-0"
          />
        </TooltipTrigger>
        <TooltipContent side="right"> Agent {{ index }} </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>

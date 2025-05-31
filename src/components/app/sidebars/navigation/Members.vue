<script setup lang="ts">
import Avatar from "vue-boring-avatars"
</script>

<template>
  <div id="tour-team-members" class="flex flex-col space-y-2">
    <TooltipProvider>
      <Tooltip v-for="index in 3" :key="index" as-child>
        <TooltipTrigger
          class="group hover:bg-sidebar-accent relative flex aspect-square items-center justify-center rounded-md transition"
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
            class="group-hover:ring-primary ring-secondary ring-offset-sidebar rounded-full p-0 ring-2 ring-offset-2 grayscale transition group-hover:grayscale-0"
          />
          <span
            class="ring-sidebar ring-offset-sidebar absolute top-1 right-1 block size-2 rounded-full bg-green-500 ring-2"
          ></span>
        </TooltipTrigger>
        <TooltipContent side="right"> Agent {{ index }} </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>

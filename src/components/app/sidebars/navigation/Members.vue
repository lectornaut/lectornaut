<script setup lang="ts">
import Avatar from "vue-boring-avatars"
</script>

<template>
  <div id="tour-team-members" class="flex flex-col gap-2">
    <TooltipProvider>
      <Tooltip v-for="index in 3" :key="index" as-child>
        <TooltipTrigger
          class="group relative flex aspect-square items-center justify-center rounded-md transition"
        >
          <Avatar
            :name="`Agent ${index}`"
            :size="14"
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
            class="group-hover:ring-primary group-hover:ring-offset-sidebar rounded-full p-0 grayscale transition group-hover:ring-2 group-hover:ring-offset-2 group-hover:grayscale-0"
          />
          <span
            class="ring-sidebar ring-offset-sidebar absolute right-1.5 bottom-1.5 block size-1.5 rounded-full bg-green-500 ring-2"
          ></span>
        </TooltipTrigger>
        <TooltipContent side="right"> Agent {{ index }} </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>

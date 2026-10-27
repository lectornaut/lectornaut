<script setup lang="ts">
import type { AcceptableValue } from "reka-ui"

// A SelectItem that, given a `reason`, renders disabled and explains why on
// hover. Disabled items are `pointer-events: none`, so the tooltip hangs off a
// wrapper instead. With no reason it's a plain SelectItem.
defineProps<{
  value: AcceptableValue
  reason?: string | null
}>()
</script>

<template>
  <TooltipProvider v-if="reason">
    <Tooltip>
      <TooltipTrigger as-child>
        <div>
          <SelectItem :value="value" disabled>
            <slot />
          </SelectItem>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        {{ reason }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <SelectItem v-else :value="value">
    <slot />
  </SelectItem>
</template>

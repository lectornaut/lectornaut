<script setup lang="ts">
import { cn } from "@/lib/utils"
import { reactiveOmit } from "@vueuse/core"
import type { SwitchRootEmits, SwitchRootProps } from "reka-ui"
import { SwitchRoot, SwitchThumb, useForwardPropsEmits } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = withDefaults(
  defineProps<
    SwitchRootProps & {
      class?: HTMLAttributes["class"]
      size?: "sm" | "default"
    }
  >(),
  {
    size: "default",
  }
)

const emits = defineEmits<SwitchRootEmits>()

const delegatedProps = reactiveOmit(props, "class", "size")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SwitchRoot
    v-slot="slotProps"
    data-slot="switch"
    :data-size="size"
    v-bind="forwarded"
    :class="
      cn(
        'data-checked:bg-primary data-unchecked:bg-input/90 data-checked:border-primary focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 peer group/switch relative inline-flex shrink-0 items-center rounded-full border-2 transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 aria-invalid:ring-3 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-unchecked:border-transparent data-[size=default]:h-5 data-[size=default]:w-11 data-[size=sm]:h-4 data-[size=sm]:w-7',
        props.class
      )
    "
  >
    <SwitchThumb
      data-slot="switch-thumb"
      class="bg-background dark:data-unchecked:bg-foreground dark:data-checked:bg-primary-foreground pointer-events-none block rounded-full shadow-sm ring-0 transition-transform not-dark:bg-clip-padding group-data-[size=default]/switch:h-4 group-data-[size=default]/switch:w-6 group-data-[size=sm]/switch:h-3 group-data-[size=sm]/switch:w-4 data-checked:translate-x-[calc(100%-8px)] data-unchecked:translate-x-0"
    >
      <slot name="thumb" v-bind="slotProps" />
    </SwitchThumb>
  </SwitchRoot>
</template>

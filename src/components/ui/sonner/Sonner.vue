<script lang="ts" setup>
import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
  OctagonXIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/vue"
import type { ToasterProps } from "vue-sonner"
import { reactiveOmit } from "@vueuse/core"
import { Toaster as Sonner } from "vue-sonner"
import { cn } from "@/lib/utils"

const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, "class", "toastOptions")
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'hsl(var(--popover) / 0.9)',
      '--gray3': 'var(--border)',
      '--gray4': 'var(--border)',
      '--gray5': 'var(--border)',
      '--gray12': 'var(--popover-foreground)',
    }"
    :toast-options="
      props.toastOptions ?? {
        classes: {
          toast: 'rounded-2xl',
        },
      }
    "
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <HugeiconsIcon
        :stroke-width="2"
        :icon="CheckmarkCircle02Icon"
        class="size-4"
      />
    </template>
    <template #info-icon>
      <HugeiconsIcon
        :stroke-width="2"
        :icon="InformationCircleIcon"
        class="size-4"
      />
    </template>
    <template #warning-icon>
      <HugeiconsIcon :stroke-width="2" :icon="Alert02Icon" class="size-4" />
    </template>
    <template #error-icon>
      <HugeiconsIcon :stroke-width="2" :icon="OctagonXIcon" class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <HugeiconsIcon
          :stroke-width="2"
          :icon="Loading03Icon"
          class="size-4 animate-spin"
        />
      </div>
    </template>
    <template #close-icon>
      <HugeiconsIcon :stroke-width="2" :icon="Cancel01Icon" class="size-4" />
    </template>
  </Sonner>
</template>

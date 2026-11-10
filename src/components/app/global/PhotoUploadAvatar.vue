<script setup lang="ts">
import { IconX } from "@/data/icons"

// The ONE photo-upload control (user / team / workspace / group, settings rows,
// tables and dialogs). Callers own the data flow via `usePhotoUpload`; this owns
// the UI: click-or-Enter to upload, a hover/focus-revealed remove badge, the
// upload spinner, and the "why can't I" tooltip. Size comes from `class`
// (forwarded to AppAvatar), e.g. `class="size-16"`.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  src?: string | null
  name?: string | null
  /** Upload OR remove in flight: spinner, blocks both actions. */
  loading?: boolean
  /** Blocks upload + remove; the tooltip shows `disabledReason` instead. */
  disabled?: boolean
  disabledReason?: string | null
}>()

const emit = defineEmits<{ upload: []; remove: [] }>()

const { t } = useI18n()

// Precedence: busy > locked > idle.
const tooltip = computed(() => {
  if (props.loading) return t("components.photoUpload.busy")
  if (props.disabled) {
    return props.disabledReason || t("components.photoUpload.upload")
  }
  return t("components.photoUpload.upload")
})

const onUpload = () => {
  if (props.disabled || props.loading) return
  emit("upload")
}
</script>

<template>
  <div class="group/photo relative inline-flex shrink-0">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <!-- aria-disabled (not disabled) so the reason tooltip still opens. -->
          <button
            type="button"
            class="focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-3"
            :class="
              loading
                ? 'cursor-progress'
                : disabled
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer'
            "
            :aria-disabled="disabled || loading"
            :aria-label="tooltip"
            @click="onUpload"
          >
            <AppAvatar
              v-bind="$attrs"
              :src="src"
              :name="name"
              :loading="loading"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ tooltip }}</TooltipContent>
      </Tooltip>
      <Tooltip v-if="src && !disabled && !loading">
        <TooltipTrigger as-child>
          <!-- Centered on the circle's 45° point (r·(1 − 1/√2) ≈ 14.645% in
             from the box corner), so it sits on the rim at any avatar size.
             Inverted ink + a background-coloured ring cuts it out of the
             photo; `after:` widens the 16px badge to a 24px hit area. -->
          <button
            type="button"
            class="bg-foreground text-background ring-background hover:bg-destructive focus-visible:bg-destructive hover:text-destructive-foreground focus-visible:text-destructive-foreground absolute top-[calc(14.645%-0.5rem)] right-[calc(14.645%-0.5rem)] flex size-4 scale-75 items-center justify-center rounded-full opacity-0 ring-2 transition-[opacity,scale,background-color,color] duration-150 ease-out outline-none group-focus-within/photo:scale-100 group-focus-within/photo:opacity-100 group-hover/photo:scale-100 group-hover/photo:opacity-100 after:absolute after:-inset-1 active:scale-90"
            :aria-label="t('components.photoUpload.remove')"
            @click.stop="emit('remove')"
          >
            <IconX class="size-2.5 [&_path]:stroke-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{
          t("components.photoUpload.remove")
        }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>

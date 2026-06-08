<script setup lang="ts">
import type { AvatarVariants } from "@/components/ui/avatar"
import { computed } from "vue"
import BoringAvatar from "vue-boring-avatars"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Spinner } from "@/components/ui/spinner"
import { getInitials } from "@/helpers/utilities"

type BoringVariant = "bauhaus" | "beam" | "marble" | "pixel" | "ring" | "sunset"

// Shared palette for generative avatars — every call site used these chart vars.
const DEFAULT_AVATAR_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
]

// Global avatar wrapper. Two modes behind one API:
//   • Photo + initials (default): pass `src` and `name`.
//   • Generative (vue-boring-avatars): pass `variant` (the `name` is the seed).
// ONE `class` prop drives everything: size AND shape. The image, the initials
// fallback and the generative blob all `size-full` + `rounded-[inherit]`, so
// they automatically follow whatever size/rounding you put on the root — no
// per-part class props needed (e.g. `class="size-16 rounded-md"` makes the
// photo square too). Initials auto-scale to the box via a container query.
// The root IS the shadcn <Avatar>, so `class` / `:class` / `@click` / `:style`
// fall through and merge via cn(). Override the fallback (icon, +N, mixed) via
// #fallback; show an upload spinner with `loading`.
const props = withDefaults(
  defineProps<{
    /** Photo URL. When falsy, only the fallback renders (no empty <img>). */
    src?: string | null
    /** Display name: initials + default alt (photo mode), or the seed (generative mode). */
    name?: string | null
    /** Alt text override (defaults to `name`). */
    alt?: string
    /** shadcn size variant (sm | default | lg). `size-*` utility classes still work. */
    size?: AvatarVariants["size"]
    /** Image referrerpolicy. Defaults to "no-referrer" (privacy for external photos). */
    referrerpolicy?: string
    /** When true, a centered <Spinner> replaces the avatar content (upload in flight). */
    loading?: boolean
    /** Render a generative vue-boring-avatars blob instead of photo + initials. */
    variant?: BoringVariant
    /** Generative palette (defaults to the chart-* CSS vars). */
    colors?: string[]
  }>(),
  {
    referrerpolicy: "no-referrer",
  }
)

const initials = computed(() => getInitials(props.name ?? ""))
const palette = computed(() => props.colors ?? DEFAULT_AVATAR_COLORS)
</script>

<template>
  <Spinner v-if="loading" />
  <BoringAvatar
    v-else-if="variant"
    :name="name ?? ''"
    :variant="variant"
    :colors="palette"
  />
  <Avatar v-else :size="size">
    <AvatarImage
      v-if="src"
      :src="src"
      :alt="alt ?? name ?? undefined"
      :referrerpolicy="referrerpolicy"
      class="rounded-[inherit]"
    />
    <AvatarFallback class="rounded-[inherit] font-medium">
      <slot name="fallback">{{ initials }}</slot>
    </AvatarFallback>
  </Avatar>
</template>

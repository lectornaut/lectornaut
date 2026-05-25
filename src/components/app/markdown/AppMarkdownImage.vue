<script lang="ts" setup>
/**
 * AppMarkdownImage — `image` override for the chat surface. Wraps the
 * library's built-in `ImageNode` with our app-wide defaults (native lazy
 * loading + placeholder) and adds a self-contained, Medium-style
 * click-to-zoom (no third-party zoom library).
 *
 * Registered against the `chat` customId. LLM-supplied URLs are the main
 * use case — frequently broken (the model hallucinates paths) — so deferred
 * load + placeholder matter more than for hand-authored content.
 *
 * Zoom mechanics (FLIP via the Web Animations API):
 *   • On click we measure the thumbnail's viewport rect (First), mount a
 *     full-screen overlay (Teleported to <body> so it escapes the chat's
 *     stacking context), and size a copy of the image to its final centred
 *     dimensions (Last) — rendered at full size so it stays crisp.
 *   • We apply an "inverted" transform so that copy initially overlaps the
 *     thumbnail, then animate the transform to identity, so it grows
 *     smoothly. (Animating a thumbnail-sized element *up* would GPU-upscale
 *     a small bitmap and look blurry.)
 *   • Close reverses the transform, then unmounts and reveals the original.
 *
 * Close is sequenced off the Web Animations API rather than a CSS
 * `transitionend`: a transition can silently fail to start (a transform
 * applied without a transition boundary on a freshly-rendered image), and
 * gating close on an event that never fires would leave the zoom stuck open.
 * `Animation.finished` always settles (resolve on finish, reject on cancel),
 * and `settle()` bounds even that with a timeout — so close can't deadlock.
 *
 * We reach the rendered <img> through ImageNode's root (`$el`): it renders
 * the img conditionally (placeholder → img on load), so there's no compile-
 * time handle, and `$el.querySelector("img")` avoids an extra wrapper
 * element that would change attribute fall-through / the measured node box.
 */
import { state as resolvedTheme } from "@/modules/theme"
import { ImageNode, type ImageNodeProps } from "markstream-vue"
import { type ComponentPublicInstance } from "vue"

const props = defineProps<ImageNodeProps>()

const imageNode = ref<ComponentPublicInstance | null>(null)
const zoomImg = ref<HTMLImageElement | null>(null)

const isOpen = ref(false) // overlay mounted
const isActive = ref(false) // backdrop faded in (drives the CSS fade)
const zoomSrc = ref("")
const zoomAlt = ref("")

const DURATION = 300
const EASING = "cubic-bezier(0.2, 0, 0.2, 1)"
const MARGIN = 40 // breathing room between the zoomed image and the viewport

// Dim toward the surface colour so the zoomed image reads as a modal over
// the app rather than a hard white/black card.
const backdropColor = computed(() =>
  resolvedTheme.value === "dark"
    ? "rgba(9, 9, 11, 0.92)"
    : "rgba(255, 255, 255, 0.92)"
)

let original: HTMLImageElement | null = null
let invertedTransform = ""
let busy = false // guards against re-entrancy mid-animation

// Wait for an animation, but NEVER hang on it. `Animation.finished` doesn't
// resolve while the tab is hidden (WAAPI pauses), and a hung wait would keep
// `busy` true and block close. Racing a timeout guarantees the state machine
// always advances; in a visible tab `finished` wins first, so timing stays exact.
const settle = (anim: Animation) =>
  new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    anim.finished.then(finish, finish)
    setTimeout(finish, DURATION + 80)
  })

const renderedImg = () => {
  const root = imageNode.value?.$el as HTMLElement | undefined
  return root?.querySelector<HTMLImageElement>("img") ?? null
}

// Largest box at the image's natural aspect ratio that fits the viewport
// (minus MARGIN), never upscaled past the source resolution, centred.
const computeTarget = (img: HTMLImageElement) => {
  const availW = Math.max(0, window.innerWidth - MARGIN * 2)
  const availH = Math.max(0, window.innerHeight - MARGIN * 2)
  const ratio = img.naturalWidth / img.naturalHeight
  let width = Math.min(availW, img.naturalWidth)
  let height = width / ratio
  if (height > availH) {
    height = Math.min(availH, img.naturalHeight)
    width = height * ratio
  }
  return {
    width,
    height,
    left: (window.innerWidth - width) / 2,
    top: (window.innerHeight - height) / 2,
  }
}

const reset = () => {
  if (original) original.style.visibility = ""
  original = null
  isOpen.value = false
  isActive.value = false
}

const open = async () => {
  const img = renderedImg()
  // Only zoom a loaded image — naturalWidth 0 means broken/not-yet-loaded,
  // and the FLIP maths would divide by zero.
  if (busy || isOpen.value || !img || !img.naturalWidth) return
  original = img
  zoomSrc.value = img.currentSrc || img.src
  zoomAlt.value = img.alt

  const first = img.getBoundingClientRect()
  isOpen.value = true
  await nextTick()
  const el = zoomImg.value
  if (!el) return reset()

  const target = computeTarget(img)
  el.style.left = `${target.left}px`
  el.style.top = `${target.top}px`
  el.style.width = `${target.width}px`
  el.style.height = `${target.height}px`
  // Map the (final-size) copy back onto the thumbnail, origin top-left.
  invertedTransform =
    `translate(${first.left - target.left}px, ${first.top - target.top}px)` +
    ` scale(${first.width / target.width}, ${first.height / target.height})`
  // Apply before the first paint so it never flashes at full size.
  el.style.transform = invertedTransform

  img.style.visibility = "hidden"
  isActive.value = true

  busy = true
  const anim = el.animate(
    [{ transform: invertedTransform }, { transform: "none" }],
    { duration: DURATION, easing: EASING, fill: "forwards" }
  )
  await settle(anim)
  el.style.transform = "none" // bake the end state, then drop the fill
  anim.cancel()
  busy = false
}

const close = async () => {
  if (busy || !isOpen.value) return
  const el = zoomImg.value
  if (!el) return reset()

  isActive.value = false
  busy = true
  const anim = el.animate(
    [{ transform: "none" }, { transform: invertedTransform }],
    { duration: DURATION, easing: EASING, fill: "forwards" }
  )
  await settle(anim)
  busy = false
  reset()
}

const openZoom = () => void open()
const dismiss = () => void close()
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") void close()
}

// Listeners only live while the overlay is open. Scroll is captured so the
// chat's inner scroll container (not just the window) dismisses the zoom.
watch(isOpen, (value) => {
  if (value) {
    window.addEventListener("keydown", onKeydown)
    window.addEventListener("scroll", dismiss, true)
    window.addEventListener("resize", dismiss)
  } else {
    window.removeEventListener("keydown", onKeydown)
    window.removeEventListener("scroll", dismiss, true)
    window.removeEventListener("resize", dismiss)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
  window.removeEventListener("scroll", dismiss, true)
  window.removeEventListener("resize", dismiss)
  if (original) original.style.visibility = ""
})
</script>

<template>
  <!--
    Forward every prop markstream passes a custom renderer (node, lazy,
    usePlaceholder, fallbackSrc) via v-bind, then pin our app-wide defaults
    on top. `ref` lets us reach the rendered <img> for the FLIP source rect;
    `@click` opens the zoom.
  -->
  <ImageNode
    ref="imageNode"
    v-bind="props"
    :lazy="true"
    :use-placeholder="true"
    class="cursor-zoom-in overflow-clip rounded object-contain"
    @click="openZoom"
  />
  <Teleport to="body">
    <!--
      z-[9999] clears app chrome (capped at z-50) but stays below the
      toaster / guided-tour tier (~1e9) so they can still surface over a zoom.
    -->
    <div
      v-if="isOpen"
      class="fixed inset-0 z-9999 cursor-zoom-out"
      role="dialog"
      aria-modal="true"
      @click="dismiss"
    >
      <div
        class="absolute inset-0 transition-opacity duration-300 ease-[cubic-bezier(0.2,0,0.2,1)]"
        :class="isActive ? 'opacity-100' : 'opacity-0'"
        :style="{ background: backdropColor }"
      />
      <img
        ref="zoomImg"
        :src="zoomSrc"
        :alt="zoomAlt"
        draggable="false"
        class="fixed m-0 max-w-none origin-top-left cursor-zoom-out overflow-clip rounded object-contain will-change-transform"
      />
    </div>
  </Teleport>
</template>

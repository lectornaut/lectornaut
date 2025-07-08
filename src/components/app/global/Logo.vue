<script setup lang="ts">
const isBlinking = ref(false)
const isHovering = ref(false)

const BLINK_MIN_DELAY = 2000
const BLINK_RANDOM_DELAY = 5000
const BLINK_DURATION = 200

let blinkTimeout: ReturnType<typeof setTimeout>
let blinkDurationTimeout: ReturnType<typeof setTimeout>

function startBlinking() {
  const delay = Math.random() * BLINK_RANDOM_DELAY + BLINK_MIN_DELAY
  blinkTimeout = setTimeout(() => {
    isBlinking.value = true
    blinkDurationTimeout = setTimeout(() => {
      isBlinking.value = false
      startBlinking()
    }, BLINK_DURATION)
  }, delay)
}

function clearBlinking() {
  clearTimeout(blinkTimeout)
  clearTimeout(blinkDurationTimeout)
}

onMounted(() => {
  startBlinking()
})

onBeforeUnmount(() => {
  clearBlinking()
})
</script>

<template>
  <svg
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Logo"
    @mouseenter="isHovering = true"
    @mouseleave="isHovering = false"
  >
    <path
      v-if="isBlinking || isHovering"
      fill="currentColor"
      fill-rule="evenodd"
      d="M16.075 0C7.211 0 0 7.186 0 16.05v14.335C0 31.277.723 32 1.615 32H16.1c8.837 0 16-7.163 16-16S24.912 0 16.075 0Zm8.727 16.05c1.895 0 3.431 1.816 3.431-.08 0 0-1.536-.97-3.431-.97s-3.431.97-3.431.97c0 1.896 1.536.08 3.431.08Zm-10.184 0c1.895 0 3.431 1.816 3.431-.079 0 0-1.654-.971-3.549-.971s-3.313.971-3.313.971c0 1.895 1.536.08 3.431.08Z"
      clip-rule="evenodd"
    />
    <path
      v-else
      fill="currentColor"
      fill-rule="evenodd"
      d="M16.075 0C7.211 0 0 7.186 0 16.05v14.335C0 31.277.723 32 1.615 32H16.1c8.837 0 16-7.163 16-16S24.912 0 16.075 0Zm8.727 19.402a3.431 3.431 0 1 0 0-6.862 3.431 3.431 0 0 0 0 6.862Zm-10.184 0a3.431 3.431 0 1 0 0-6.862 3.431 3.431 0 0 0 0 6.862Z"
      clip-rule="evenodd"
    />
  </svg>
</template>

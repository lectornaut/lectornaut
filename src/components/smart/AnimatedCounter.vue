<script setup>
import { ref, watch, onMounted } from "vue"

const props = defineProps({
  value: {
    type: Number,
    default: 0,
  },
  speed: {
    type: Number,
    default: 4,
  },
})

const displayNumber = ref(0) // Start from 0 to animate from 0 to the value
let interval = null

const animateValue = (newVal) => {
  clearInterval(interval)

  if (newVal === displayNumber.value) {
    return
  }

  interval = setInterval(() => {
    // Compute the change per frame, respecting decimal precision
    const change = (newVal - displayNumber.value) / props.speed
    displayNumber.value += change

    // Stop the animation when the value is close enough to the target value
    if (Math.abs(displayNumber.value - newVal) < 0.01) {
      displayNumber.value = newVal
      clearInterval(interval)
    }
  }, 20)
}

watch(
  () => props.value,
  (newVal) => {
    animateValue(newVal)
  }
)

onMounted(() => {
  animateValue(props.value)
})
</script>

<template>
  <div class="inline tabular-nums">
    {{ displayNumber.toFixed(2) }}
  </div>
</template>

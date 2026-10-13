<script lang="ts" setup>
import AppLayout from "@/layouts/app.vue"
import { useRoute } from "vue-router"

const route = useRoute()
const isStandalone = computed(() => route.query.popout === "1")
</script>

<template>
  <RouterView v-if="isStandalone" />
  <AppLayout v-else />
</template>

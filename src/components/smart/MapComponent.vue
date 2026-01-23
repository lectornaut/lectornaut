<script setup lang="ts">
import { state } from "@/modules/theme"
import { VControlNavigation, VMap } from "@geoql/v-maplibre"

const mapStyle = computed(() =>
  state.value === "dark"
    ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
)

const mapOptions = computed(() => ({
  container: "map",
  style: mapStyle.value,
  center: [-74.006, 40.7128] as [number, number],
  zoom: 9,
}))
</script>

<template>
  <div class="m-2 flex grow flex-col overflow-clip rounded-lg border">
    <VMap :key="mapStyle" :options="mapOptions">
      <VControlNavigation position="bottom-right" />
    </VMap>
  </div>
</template>

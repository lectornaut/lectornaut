<script lang="ts" setup>
import { useI18n } from "vue-i18n"

const { t } = useI18n()
</script>

<template>
  <div class="flex size-full grow flex-col items-center px-8 py-4">
    <svg
      preserveAspectRatio="xMinYMin"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 132 16"
    >
      <text
        xmlns="http://www.w3.org/2000/svg"
        x="50%"
        y="50%"
        fill="transparent"
        dominant-baseline="middle"
        text-anchor="middle"
        text-rendering="geometricPrecision"
        stroke-width="0"
        class="font-display fill-current leading-tight tracking-tight"
      >
        {{ t("landing.hero.line1") }}
      </text>
    </svg>
    <svg
      preserveAspectRatio="xMinYMin"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 132 16"
    >
      <text
        xmlns="http://www.w3.org/2000/svg"
        x="50%"
        y="50%"
        fill="transparent"
        dominant-baseline="middle"
        text-anchor="middle"
        text-rendering="geometricPrecision"
        stroke-width="0"
        class="font-display fill-current leading-tight tracking-tight"
      >
        <tspan alignment-baseline="middle" class="italic">
          {{ t("landing.hero.line2.part1") }}
        </tspan>
        {{ t("landing.hero.line2.part2") }}
      </text>
    </svg>
  </div>
</template>

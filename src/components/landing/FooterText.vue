<template>
  <div class="flex size-full grow flex-col items-center px-8 py-4">
    <svg
      preserveAspectRatio="xMinYMin"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 70 16"
    >
      <defs>
        <linearGradient id="text-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="var(--background)" />
          <stop offset="100%" stop-color="currentColor" />
        </linearGradient>
      </defs>
      <text
        xmlns="http://www.w3.org/2000/svg"
        x="50%"
        y="50%"
        fill="url(#text-gradient)"
        dominant-baseline="middle"
        text-anchor="middle"
        text-rendering="geometricPrecision"
        stroke-width="0"
        class="font-display leading-tight tracking-tight"
      >
        Lectornaut
      </text>
    </svg>
  </div>
</template>

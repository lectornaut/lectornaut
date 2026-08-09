<script setup lang="ts">
/** The stage the geometry is tuned on; --orb-k scales it to `size`. */
const STAGE = 28

/** Default rendered size — 20×20 indicator box. */
const SIZE = 20

type LensVariant = "B5"
type OrbVariant = LensVariant

const ORB_TASKS: Record<OrbVariant, string> = {
  B5: "Routing",
}

const props = withDefaults(
  defineProps<{
    variant?: OrbVariant
    /** Rendered edge length in px. The 28px geometry scales to fit. */
    size?: number
    /** Accessible label, and the status text when `pill` is set. */
    label?: string
    /** Wraps the orb and its label in a status pill. */
    pill?: boolean
  }>(),
  { variant: "B5", size: SIZE, label: undefined, pill: false }
)

const text = computed(() => props.label ?? ORB_TASKS[props.variant] + "…")
</script>

<template>
  <span class="root" :data-pill="pill ? '' : null">
    <!-- In pill form the visible label already carries the meaning, so the
         glyph steps out of the accessibility tree. -->
    <span
      class="glyph"
      :role="pill ? undefined : 'img'"
      :aria-label="pill ? undefined : text"
      :aria-hidden="pill ? 'true' : undefined"
      :style="{
        width: size + 'px',
        height: size + 'px',
        '--orb-k': size / STAGE,
      }"
    >
      <span class="lens" :data-variant="variant">
        <span class="shape shape-a" />
        <span class="shape shape-b" />
        <span class="shape shape-c" />
      </span>
    </span>
    <span v-if="pill" class="pill-label">{{ text }}</span>
  </span>
</template>

<style scoped>
.root {
  display: inline-flex;
  align-items: center;
}

/* The inline pill form — same component, wrapped. */
.root[data-pill] {
  gap: 7px;
  height: 30px;
  padding: 0 11px 0 5px;
  border-radius: 999px;
  background: #ffffff;
  /* A hairline ring rather than a border, so it can't affect layout, plus
     a tight contact shadow and a wider ambient one. */
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.08),
    0 1px 2px rgba(0, 0, 0, 0.05),
    0 2px 4px rgba(0, 0, 0, 0.02);
}

.pill-label {
  font-family: "Inter", system-ui, sans-serif;
  font-size: 11.5px;
  font-weight: 425;
  line-height: 1;
  color: #a1a1a1;
  white-space: nowrap;
}

.glyph {
  position: relative;
  display: block;
  flex: none;
  width: 20px;
  height: 20px;
  overflow: hidden;
  contain: strict;
}

/* The app themes by class (`@custom-variant dark` in styles/index.css), not
   by OS preference — a `prefers-color-scheme` query here would ignore the
   in-app toggle. The bare glyph needs no override at all: its shapes paint
   with `currentColor`, so it inherits whatever the host row sets. */
:where(.dark, [data-theme="dark"]) .root[data-pill] {
  background: #1a1a1a;
  box-shadow:
    0 0 0 0.5px rgba(255, 255, 255, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 2px 4px rgba(0, 0, 0, 0.3);
}

:where(.dark, [data-theme="dark"]) .pill-label {
  color: #a3a3a3;
}

/* --- Lens: three circles at depth, blur reads as distance --------- */

.lens {
  position: absolute;
  left: 0;
  top: 0;
  width: 28px;
  height: 28px;
  transform-origin: 0 0;
  transform: scale(var(--orb-k, 1));
}

.shape {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--orb-d, 7px);
  height: var(--orb-d, 7px);
  /* Pulled back by its own half-size, so --orb-d is the only knob a variant
     has to touch to resize the cast and it stays centred on the stage. */
  margin: calc(var(--orb-d, 7px) / -2) 0 0 calc(var(--orb-d, 7px) / -2);
  border-radius: 50%;
  background: currentColor;
}

/* handoff — the cast crosses the focal plane one after another, always left
   to right, like work being passed on. The shorthand curve is only a
   fallback; every segment below sets its own. */
.lens[data-variant="B5"] .shape {
  animation: orb-handoff 2.8s linear infinite both;
}

/* Half a cycle apart, so one is always at the focal plane while the other is
   invisible at an end and the loop point cannot be seen. */
.lens[data-variant="B5"] .shape-a {
  animation-delay: 0s;
}

.lens[data-variant="B5"] .shape-c {
  animation-delay: -1.4s;
}

/* The third holds the centre and breathes — a soft depth cue behind the
   traffic rather than another traveller. */
.lens[data-variant="B5"] .shape-b {
  animation-name: orb-breathe;
  animation-duration: 3.6s;
}

/* Enters small from the left, reaches standard size at the focal plane, then
   shrinks and fades out to the right. At the dwell (centre) the circle is
   exactly 1× — no pulsing, no bounce, just a clean handoff. */
@keyframes orb-handoff {
  0% {
    opacity: 0;
    filter: blur(2.4px);
    transform: translateX(-11px) scale(0.55);
    animation-timing-function: cubic-bezier(0.33, 1, 0.68, 1);
  }
  22% {
    opacity: 1;
    filter: blur(0);
    transform: translateX(-1px) scale(1);
    animation-timing-function: linear;
  }
  37% {
    opacity: 1;
    filter: blur(0);
    transform: translateX(0) scale(1);
    animation-timing-function: linear;
  }
  52% {
    opacity: 1;
    filter: blur(0);
    transform: translateX(1px) scale(1);
    animation-timing-function: cubic-bezier(0.33, 1, 0.68, 1);
  }
  70% {
    opacity: 0;
    filter: blur(2.4px);
    transform: translateX(11px) scale(0.55);
  }
  100% {
    opacity: 0;
    filter: blur(2.4px);
    transform: translateX(11px) scale(0.55);
  }
}

@keyframes orb-breathe {
  0%,
  100% {
    opacity: 0.16;
    filter: blur(2.4px);
    transform: scale(1.2);
  }
  50% {
    opacity: 0.32;
    filter: blur(1.6px);
    transform: scale(0.98);
  }
}

/* Without animation the three stacked circles collapse into one static
   centred dot — a fine motionless stand-in. */
@media (prefers-reduced-motion: reduce) {
  .shape {
    animation: none;
  }
}
</style>

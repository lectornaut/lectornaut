// Single source of truth for the theme's color *families* — the palette names
// behind the base/accent pickers, the synthetic picker sentinels, and the
// neutral "anchor" both theme renderers measure against.
//
// Kept dependency-free ON PURPOSE. Four very different consumers import from
// here, and none of them should re-declare a family list again:
//   - the build-time CSS generator (`src/plugins/theme/themeGenerator.ts`),
//     which runs inside the Vite config before the `@/` alias exists, so it
//     imports this file by relative path;
//   - the runtime token math (`src/utils/theme/tokens.ts`);
//   - the settings Zod schema (`src/schemas/settings.ts`), which deliberately
//     avoids `@/helpers/defaults` because of its `@/data/icons` graph — this
//     leaf has no such cost;
//   - the icon-decorated UI lists (`src/helpers/defaults.ts`).
//
// Adding a palette = one edit, here.

export const BASE_FAMILIES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "taupe",
  "mauve",
  "mist",
  "olive",
] as const

export const ACCENT_FAMILIES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const

export type BaseFamily = (typeof BASE_FAMILIES)[number]
export type AccentFamily = (typeof ACCENT_FAMILIES)[number]

// Synthetic picker options that are NOT palette families:
//   - `accent`/`base` cross-reference the other axis' resolved color
//   - `custom` is a user-picked hex
// They appear on the picker enums but never reach `paletteVar`.
export const BASE_SENTINELS = ["accent", "custom"] as const
export const ACCENT_SENTINELS = ["base", "custom"] as const

// The full id sets backing the picker enums (families + sentinels), in display
// order. These feed both the `z.enum` schema and the `BaseId`/`AccentId` types.
export const BASE_IDS = [...BASE_FAMILIES, ...BASE_SENTINELS] as const
export const ACCENT_IDS = [...ACCENT_FAMILIES, ...ACCENT_SENTINELS] as const

export type BaseId = (typeof BASE_IDS)[number]
export type AccentId = (typeof ACCENT_IDS)[number]

// The neutral anchor: the default base family AND the palette whose light/dark
// extremes act as the "surface" every theme blends toward and picks contrast
// against. One fact, read by both renderers and the default-color seeds.
export const ANCHOR_FAMILY = "neutral" satisfies BaseFamily
export const LIGHT_SURFACE_SHADE = 50
export const DARK_SURFACE_SHADE = 950

// `var(--color-<family>-<shade>)` — a Tailwind palette CSS variable. Pure
// string builder, safe to call from build-time and runtime alike.
export function paletteVar(family: string, shade: number): string {
  return `var(--color-${family}-${shade})`
}

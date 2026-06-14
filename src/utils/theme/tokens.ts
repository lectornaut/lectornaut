// Shared shape + math behind both theme renderers (the build-time preset CSS
// generator and the runtime custom-color applier). Everything that used to be
// duplicated between `src/plugins/theme/themeGenerator.ts` and
// `src/utils/theme/customTheme.ts` — the token shape, the contrast picker, the
// neutral surfaces — lives here exactly once.
//
// Imports stay relative so the build-time generator can pull this in from
// inside the Vite config (where the `@/` alias isn't wired yet).

import colors from "tailwindcss/colors"
import { getContrastRatio, parseCssColor, rgbToHex } from "./color"
import {
  ANCHOR_FAMILY,
  DARK_SURFACE_SHADE,
  LIGHT_SURFACE_SHADE,
  paletteVar,
} from "./families"

// ── Palette readers ─────────────────────────────────────────────────────────

// Raw palette value (an oklch string in Tailwind v4) straight from the JS
// colors object. Throws loudly at generation time if a family/shade is absent.
export function paletteColor(family: string, shade: number): string {
  const palette = (colors as Record<string, Record<number, string>>)[family]
  const value = palette?.[shade]

  if (typeof value !== "string") {
    throw new Error(`Missing Tailwind color for ${family}-${shade}`)
  }

  return value
}

// Same value normalized to a `#rrggbb` hex — the form the custom-color picker
// and `normalizeHexColor` expect.
export function paletteHex(family: string, shade: number): string {
  return rgbToHex(parseCssColor(paletteColor(family, shade)))
}

// ── Neutral surfaces (the one anchor both renderers share) ──────────────────

export const LIGHT_SURFACE_VAR = paletteVar(ANCHOR_FAMILY, LIGHT_SURFACE_SHADE)
export const DARK_SURFACE_VAR = paletteVar(ANCHOR_FAMILY, DARK_SURFACE_SHADE)
export const LIGHT_SURFACE_COLOR = paletteColor(
  ANCHOR_FAMILY,
  LIGHT_SURFACE_SHADE
)
export const DARK_SURFACE_COLOR = paletteColor(
  ANCHOR_FAMILY,
  DARK_SURFACE_SHADE
)

// The single contrast picker. Returns whichever surface var reads better
// against `color`. `bias` (> 1) nudges toward the light surface — the custom
// path passes it so mid-tone accents don't get an overly dark foreground; the
// preset path leaves it at 1, its shades being pre-tuned.
export function pickContrastVar(color: string, bias = 1): string {
  return getContrastRatio(color, LIGHT_SURFACE_COLOR) * bias >=
    getContrastRatio(color, DARK_SURFACE_COLOR)
    ? LIGHT_SURFACE_VAR
    : DARK_SURFACE_VAR
}

// ── Base token graph ────────────────────────────────────────────────────────
//
// The 21 base tokens, in CSS emission order. A `source` token carries a real
// value; an `alias` token mirrors a source (the build-time renderer emits
// `var(--<of>)`, the runtime renderer copies the resolved value). This ordered
// list is the ONE definition of the base token shape: both renderers and the
// runtime clear-list derive from it, so they can't drift. The order is
// load-bearing — `theme.css` is generated from it and diffed in review.

export const BASE_SOURCE_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "secondary",
  "muted",
  "muted-foreground",
] as const

export type BaseSourceToken = (typeof BASE_SOURCE_TOKENS)[number]

type BaseTokenEntry =
  | { token: BaseSourceToken; kind: "source" }
  | { token: string; kind: "alias"; of: BaseSourceToken }

export const BASE_TOKEN_GRAPH: readonly BaseTokenEntry[] = [
  { token: "background", kind: "source" },
  { token: "foreground", kind: "source" },
  { token: "card", kind: "source" },
  { token: "card-foreground", kind: "source" },
  { token: "popover", kind: "alias", of: "background" },
  { token: "popover-foreground", kind: "alias", of: "foreground" },
  { token: "secondary", kind: "source" },
  { token: "secondary-foreground", kind: "alias", of: "foreground" },
  { token: "muted", kind: "source" },
  { token: "muted-foreground", kind: "source" },
  { token: "accent", kind: "alias", of: "muted" },
  { token: "accent-foreground", kind: "alias", of: "card-foreground" },
  { token: "border", kind: "alias", of: "muted" },
  { token: "input", kind: "alias", of: "muted" },
  { token: "sidebar", kind: "alias", of: "card" },
  { token: "sidebar-foreground", kind: "alias", of: "card-foreground" },
  { token: "sidebar-primary", kind: "alias", of: "foreground" },
  { token: "sidebar-primary-foreground", kind: "alias", of: "card" },
  { token: "sidebar-accent", kind: "alias", of: "muted" },
  { token: "sidebar-accent-foreground", kind: "alias", of: "card-foreground" },
  { token: "sidebar-border", kind: "alias", of: "muted" },
]

export const BASE_TOKEN_NAMES = BASE_TOKEN_GRAPH.map(
  (entry) => `--${entry.token}`
)

// The 11 accent tokens, in emission order. Accents don't form a clean
// source/alias graph (presets pick discrete shades, custom blends derived
// steps), so this is just the shared name list for the runtime clear-list.
export const ACCENT_TOKEN_NAMES = [
  "--primary",
  "--primary-foreground",
  "--destructive",
  "--destructive-foreground",
  "--ring",
  "--sidebar-ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
] as const

// Expand the base graph into a full token record. `source(token)` supplies the
// value for source tokens; `alias(target)` supplies the value an alias takes —
// a `var(--target)` reference at build time, or the resolved source value at
// runtime.
export function buildBaseTokens(
  source: (token: BaseSourceToken) => string,
  alias: (target: BaseSourceToken) => string
): Record<string, string> {
  const tokens: Record<string, string> = {}

  for (const entry of BASE_TOKEN_GRAPH) {
    tokens[`--${entry.token}`] =
      entry.kind === "source" ? source(entry.token) : alias(entry.of)
  }

  return tokens
}

import { mix } from "@/utils/theme/color"
import {
  ACCENT_TOKEN_NAMES,
  BASE_TOKEN_NAMES,
  buildBaseTokens,
  DARK_SURFACE_COLOR,
  LIGHT_SURFACE_COLOR,
  pickContrastVar,
  type BaseSourceToken,
} from "@/utils/theme/tokens"

export type ResolvedThemeMode = "light" | "dark"

// The runtime clear-list: every custom token the applier sets (and therefore
// must remove when a custom theme is switched off). Derived from the shared
// token shape so it can't drift from what the builders below actually emit.
export const CUSTOM_BASE_TOKEN_NAMES = BASE_TOKEN_NAMES
export const CUSTOM_ACCENT_TOKEN_NAMES = ACCENT_TOKEN_NAMES

// How far to blend the user's color toward the mode surface to derive the accent base
const ACCENT_BLEND = { light: 0.6, dark: 0.4 } as const

// Single step distance from primary for destructive (toward surface) and ring (away from surface)
const ACCENT_STEP = 0.18

// Chart spread: progressive steps away from surface (chart-1 = primary, no offset)
const CHART_SPREAD = [0.18, 0.3, 0.45, 0.6] as const

// Bias toward light foreground so mid-tone accents don't get an overly dark foreground
const LIGHT_FG_BIAS = 2

export function normalizeHexColor(value: unknown, fallback: string): string {
  const normalizedFallback = String(fallback).toLowerCase()

  if (typeof value !== "string") return normalizedFallback
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return normalizedFallback

  return value.toLowerCase()
}

export function buildCustomAccentTokens(
  color: string,
  mode: ResolvedThemeMode
): Record<string, string> {
  const surfaceTarget =
    mode === "light" ? LIGHT_SURFACE_COLOR : DARK_SURFACE_COLOR
  const contrastTarget =
    mode === "light" ? DARK_SURFACE_COLOR : LIGHT_SURFACE_COLOR

  const primary = mix(color, surfaceTarget, ACCENT_BLEND[mode])
  const destructive = mix(primary, surfaceTarget, ACCENT_STEP)
  const ring = mix(primary, contrastTarget, ACCENT_STEP)

  return {
    "--primary": primary,
    "--primary-foreground": pickContrastVar(primary, LIGHT_FG_BIAS),
    "--destructive": destructive,
    "--destructive-foreground": pickContrastVar(destructive, LIGHT_FG_BIAS),
    "--ring": ring,
    "--sidebar-ring": ring,
    "--chart-1": primary,
    "--chart-2": mix(primary, contrastTarget, CHART_SPREAD[0]),
    "--chart-3": mix(primary, contrastTarget, CHART_SPREAD[1]),
    "--chart-4": mix(primary, contrastTarget, CHART_SPREAD[2]),
    "--chart-5": mix(primary, contrastTarget, CHART_SPREAD[3]),
  }
}

// Per-source-token blend recipe: how far to mix the user's color toward the
// mode "surface" (the same-mode neutral extreme) or its "contrast" (the
// opposite extreme). Mirrors the preset shade ramp — notably `secondary` sits
// a step between `card` and `muted` rather than collapsing onto `card`.
type SourceBlend = { toward: "surface" | "contrast"; ratio: number }

const CUSTOM_SOURCE_BLENDS = {
  light: {
    background: { toward: "surface", ratio: 0.94 },
    foreground: { toward: "contrast", ratio: 0.84 },
    card: { toward: "surface", ratio: 0.88 },
    "card-foreground": { toward: "contrast", ratio: 0.84 },
    secondary: { toward: "surface", ratio: 0.83 },
    muted: { toward: "surface", ratio: 0.78 },
    "muted-foreground": { toward: "contrast", ratio: 0.45 },
  },
  dark: {
    background: { toward: "surface", ratio: 0.9 },
    foreground: { toward: "contrast", ratio: 0.88 },
    card: { toward: "surface", ratio: 0.82 },
    "card-foreground": { toward: "contrast", ratio: 0.78 },
    secondary: { toward: "surface", ratio: 0.77 },
    muted: { toward: "surface", ratio: 0.72 },
    "muted-foreground": { toward: "contrast", ratio: 0.44 },
  },
} satisfies Record<ResolvedThemeMode, Record<BaseSourceToken, SourceBlend>>

export function buildCustomBaseTokens(
  color: string,
  mode: ResolvedThemeMode
): Record<string, string> {
  const surfaceTarget =
    mode === "light" ? LIGHT_SURFACE_COLOR : DARK_SURFACE_COLOR
  const contrastTarget =
    mode === "light" ? DARK_SURFACE_COLOR : LIGHT_SURFACE_COLOR
  const blends = CUSTOM_SOURCE_BLENDS[mode]

  // Resolve every source token to a concrete hex, then let the shared graph
  // place the sources and copy each alias from the source it mirrors.
  const sources = {} as Record<BaseSourceToken, string>
  for (const token of Object.keys(blends) as BaseSourceToken[]) {
    const { toward, ratio } = blends[token]
    sources[token] = mix(
      color,
      toward === "surface" ? surfaceTarget : contrastTarget,
      ratio
    )
  }

  return buildBaseTokens(
    (token) => sources[token],
    (target) => sources[target]
  )
}

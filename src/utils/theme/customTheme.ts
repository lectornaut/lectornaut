import { getContrastRatio, mix } from "@/utils/theme/color"
import colors from "tailwindcss/colors"

export type ResolvedThemeMode = "light" | "dark"

export const CUSTOM_BASE_TOKEN_NAMES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--border",
  "--input",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
] as const

export const CUSTOM_ACCENT_TOKEN_NAMES = [
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

export type CustomBaseTokenName = (typeof CUSTOM_BASE_TOKEN_NAMES)[number]
export type CustomAccentTokenName = (typeof CUSTOM_ACCENT_TOKEN_NAMES)[number]

export type CustomBaseTokens = Record<CustomBaseTokenName, string>
export type CustomAccentTokens = Record<CustomAccentTokenName, string>

const neutralPalette = colors.neutral as Record<number, string>
const LIGHT_SURFACE = neutralPalette[50]
const DARK_SURFACE = neutralPalette[950]
const LIGHT_CONTRAST_CSS_VALUE = "var(--color-neutral-50)"
const DARK_CONTRAST_CSS_VALUE = "var(--color-neutral-950)"

// How far to blend the user's color toward the mode surface to derive the accent base
const ACCENT_BLEND = { light: 0.6, dark: 0.4 } as const

// Single step distance from primary for destructive (toward surface) and ring (away from surface)
const ACCENT_STEP = 0.18

// Chart spread: progressive steps away from surface (chart-1 = primary, no offset)
const CHART_SPREAD = [0.18, 0.3, 0.45, 0.6] as const

export function normalizeHexColor(value: unknown, fallback: string): string {
  const normalizedFallback = String(fallback).toLowerCase()

  if (typeof value !== "string") return normalizedFallback
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return normalizedFallback

  return value.toLowerCase()
}

// Bias toward light foreground so mid-tone accents don't get an overly dark foreground
const LIGHT_FG_BIAS = 2

function pickContrast(color: string): string {
  return getContrastRatio(color, LIGHT_SURFACE) * LIGHT_FG_BIAS >=
    getContrastRatio(color, DARK_SURFACE)
    ? LIGHT_CONTRAST_CSS_VALUE
    : DARK_CONTRAST_CSS_VALUE
}

export function buildCustomAccentTokens(
  color: string,
  mode: ResolvedThemeMode
): CustomAccentTokens {
  const surfaceTarget = mode === "light" ? LIGHT_SURFACE : DARK_SURFACE
  const contrastTarget = mode === "light" ? DARK_SURFACE : LIGHT_SURFACE

  const primary = mix(color, surfaceTarget, ACCENT_BLEND[mode])
  const destructive = mix(primary, surfaceTarget, ACCENT_STEP)
  const ring = mix(primary, contrastTarget, ACCENT_STEP)

  return {
    "--primary": primary,
    "--primary-foreground": pickContrast(primary),
    "--destructive": destructive,
    "--destructive-foreground": pickContrast(destructive),
    "--ring": ring,
    "--sidebar-ring": ring,
    "--chart-1": primary,
    "--chart-2": mix(primary, contrastTarget, CHART_SPREAD[0]),
    "--chart-3": mix(primary, contrastTarget, CHART_SPREAD[1]),
    "--chart-4": mix(primary, contrastTarget, CHART_SPREAD[2]),
    "--chart-5": mix(primary, contrastTarget, CHART_SPREAD[3]),
  }
}

export function buildCustomBaseTokens(
  color: string,
  mode: ResolvedThemeMode
): CustomBaseTokens {
  if (mode === "light") {
    const background = mix(color, LIGHT_SURFACE, 0.94)
    const card = mix(color, LIGHT_SURFACE, 0.88)
    const muted = mix(color, LIGHT_SURFACE, 0.78)
    const foreground = mix(color, DARK_SURFACE, 0.84)
    const cardForeground = foreground

    return {
      "--background": background,
      "--foreground": foreground,
      "--card": card,
      "--card-foreground": cardForeground,
      "--popover": background,
      "--popover-foreground": foreground,
      "--secondary": card,
      "--secondary-foreground": foreground,
      "--muted": muted,
      "--muted-foreground": mix(color, DARK_SURFACE, 0.45),
      "--accent": muted,
      "--accent-foreground": cardForeground,
      "--border": muted,
      "--input": muted,
      "--sidebar": card,
      "--sidebar-foreground": cardForeground,
      "--sidebar-primary": foreground,
      "--sidebar-primary-foreground": card,
      "--sidebar-accent": muted,
      "--sidebar-accent-foreground": cardForeground,
      "--sidebar-border": muted,
    }
  }

  const background = mix(color, DARK_SURFACE, 0.9)
  const card = mix(color, DARK_SURFACE, 0.82)
  const muted = mix(color, DARK_SURFACE, 0.72)
  const foreground = mix(color, LIGHT_SURFACE, 0.88)
  const cardForeground = mix(color, LIGHT_SURFACE, 0.78)

  return {
    "--background": background,
    "--foreground": foreground,
    "--card": card,
    "--card-foreground": cardForeground,
    "--popover": background,
    "--popover-foreground": foreground,
    "--secondary": card,
    "--secondary-foreground": foreground,
    "--muted": muted,
    "--muted-foreground": mix(color, LIGHT_SURFACE, 0.44),
    "--accent": muted,
    "--accent-foreground": cardForeground,
    "--border": muted,
    "--input": muted,
    "--sidebar": card,
    "--sidebar-foreground": cardForeground,
    "--sidebar-primary": foreground,
    "--sidebar-primary-foreground": card,
    "--sidebar-accent": muted,
    "--sidebar-accent-foreground": cardForeground,
    "--sidebar-border": muted,
  }
}

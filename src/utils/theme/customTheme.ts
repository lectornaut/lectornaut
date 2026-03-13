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

const DARK_CONTRAST_COLOR = "#111827"
const WHITE = "#ffffff"
const DARK_SURFACE = "#020617"
const LIGHT_SURFACE = "#f8fafc"

interface Rgb {
  r: number
  g: number
  b: number
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  const normalizedFallback = String(fallback).toLowerCase()

  if (typeof value !== "string") return normalizedFallback
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return normalizedFallback

  return value.toLowerCase()
}

export function mix(hexA: string, hexB: string, ratio: number): string {
  const weight = Math.min(1, Math.max(0, ratio))
  const colorA = hexToRgb(hexA)
  const colorB = hexToRgb(hexB)

  return rgbToHex({
    r: Math.round(colorA.r * (1 - weight) + colorB.r * weight),
    g: Math.round(colorA.g * (1 - weight) + colorB.g * weight),
    b: Math.round(colorA.b * (1 - weight) + colorB.b * weight),
  })
}

export function pickContrast(hex: string): string {
  const contrastWithWhite = getContrastRatio(hex, WHITE)
  const contrastWithDark = getContrastRatio(hex, DARK_CONTRAST_COLOR)

  return contrastWithWhite >= contrastWithDark ? WHITE : DARK_CONTRAST_COLOR
}

export function buildCustomAccentTokens(
  color: string,
  mode: ResolvedThemeMode
): CustomAccentTokens {
  const primaryForeground = pickContrast(color)
  const ring =
    mode === "light" ? mix(color, WHITE, 0.35) : mix(color, WHITE, 0.25)

  return {
    "--primary": color,
    "--primary-foreground": primaryForeground,
    "--destructive": color,
    "--destructive-foreground": primaryForeground,
    "--ring": ring,
    "--sidebar-ring": ring,
    "--chart-1": color,
    "--chart-2": mix(color, WHITE, 0.15),
    "--chart-3": mix(color, WHITE, 0.3),
    "--chart-4": mix(color, WHITE, 0.45),
    "--chart-5": mix(color, WHITE, 0.6),
  }
}

export function buildCustomBaseTokens(
  color: string,
  mode: ResolvedThemeMode
): CustomBaseTokens {
  if (mode === "light") {
    const background = mix(color, WHITE, 0.94)
    const card = mix(color, WHITE, 0.88)
    const muted = mix(color, WHITE, 0.78)
    const foreground = mix(color, DARK_CONTRAST_COLOR, 0.84)
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
      "--muted-foreground": mix(color, DARK_CONTRAST_COLOR, 0.45),
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
  const muted = mix(color, DARK_SURFACE, 0.72)
  const foreground = mix(color, LIGHT_SURFACE, 0.88)
  const cardForeground = mix(color, LIGHT_SURFACE, 0.78)

  return {
    "--background": background,
    "--foreground": foreground,
    "--card": background,
    "--card-foreground": cardForeground,
    "--popover": background,
    "--popover-foreground": foreground,
    "--secondary": mix(color, DARK_SURFACE, 0.82),
    "--secondary-foreground": foreground,
    "--muted": muted,
    "--muted-foreground": mix(color, LIGHT_SURFACE, 0.44),
    "--accent": muted,
    "--accent-foreground": cardForeground,
    "--border": muted,
    "--input": muted,
    "--sidebar": background,
    "--sidebar-foreground": cardForeground,
    "--sidebar-primary": foreground,
    "--sidebar-primary-foreground": background,
    "--sidebar-accent": muted,
    "--sidebar-accent-foreground": cardForeground,
    "--sidebar-border": muted,
  }
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex, "#000000")
  const value = Number.parseInt(normalized.slice(1), 16)

  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`
}

function toHexChannel(value: number): string {
  return Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")
}

function getContrastRatio(hexA: string, hexB: string): number {
  const luminanceA = getRelativeLuminance(hexA)
  const luminanceB = getRelativeLuminance(hexB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + 0.05) / (darker + 0.05)
}

function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)

  return (
    0.2126 * channelToLinear(r / 255) +
    0.7152 * channelToLinear(g / 255) +
    0.0722 * channelToLinear(b / 255)
  )
}

function channelToLinear(channel: number): number {
  if (channel <= 0.04045) return channel / 12.92
  return ((channel + 0.055) / 1.055) ** 2.4
}

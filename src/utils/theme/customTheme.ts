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
const LIGHT_CONTRAST_COLOR = LIGHT_SURFACE
const DARK_CONTRAST_COLOR = DARK_SURFACE
const LIGHT_CONTRAST_CSS_VALUE = "var(--color-neutral-50)"
const DARK_CONTRAST_CSS_VALUE = "var(--color-neutral-950)"
const LIGHT_MODE_ACCENT_RATIO = 0.24
const DARK_MODE_ACCENT_RATIO = 0.42
const ACCENT_TONE_RING_RATIO = 0.18
const ACCENT_TONE_CHART_RATIOS = [0.18, 0.3, 0.45, 0.6] as const

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

export function mix(colorA: string, colorB: string, ratio: number): string {
  const weight = Math.min(1, Math.max(0, ratio))
  const parsedColorA = parseCssColor(colorA)
  const parsedColorB = parseCssColor(colorB)

  return rgbToHex({
    r: Math.round(parsedColorA.r * (1 - weight) + parsedColorB.r * weight),
    g: Math.round(parsedColorA.g * (1 - weight) + parsedColorB.g * weight),
    b: Math.round(parsedColorA.b * (1 - weight) + parsedColorB.b * weight),
  })
}

export function pickContrast(color: string): string {
  const contrastWithLight = getContrastRatio(color, LIGHT_CONTRAST_COLOR)
  const contrastWithDark = getContrastRatio(color, DARK_CONTRAST_COLOR)

  return contrastWithLight >= contrastWithDark
    ? LIGHT_CONTRAST_CSS_VALUE
    : DARK_CONTRAST_CSS_VALUE
}

export function buildCustomAccentTokens(
  color: string,
  mode: ResolvedThemeMode
): CustomAccentTokens {
  const accentColor =
    mode === "light"
      ? mix(color, LIGHT_SURFACE, LIGHT_MODE_ACCENT_RATIO)
      : mix(color, DARK_SURFACE, DARK_MODE_ACCENT_RATIO)
  const primaryForeground = pickContrast(accentColor)
  const toneTarget = mode === "light" ? LIGHT_SURFACE : DARK_SURFACE
  const ring = mix(accentColor, toneTarget, ACCENT_TONE_RING_RATIO)

  return {
    "--primary": accentColor,
    "--primary-foreground": primaryForeground,
    "--destructive": accentColor,
    "--destructive-foreground": primaryForeground,
    "--ring": ring,
    "--sidebar-ring": ring,
    "--chart-1": accentColor,
    "--chart-2": mix(accentColor, toneTarget, ACCENT_TONE_CHART_RATIOS[0]),
    "--chart-3": mix(accentColor, toneTarget, ACCENT_TONE_CHART_RATIOS[1]),
    "--chart-4": mix(accentColor, toneTarget, ACCENT_TONE_CHART_RATIOS[2]),
    "--chart-5": mix(accentColor, toneTarget, ACCENT_TONE_CHART_RATIOS[3]),
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

function parseCssColor(value: string): Rgb {
  if (value.startsWith("#")) {
    return hexToRgb(value)
  }

  if (value.startsWith("oklch(")) {
    return oklchToRgb(value)
  }

  throw new Error(`Unsupported color format: ${value}`)
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

function oklchToRgb(value: string): Rgb {
  const match =
    /^oklch\(([\d.]+)%\s+([\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*[\d.]+)?\)$/.exec(
      value
    )

  if (!match) {
    throw new Error(`Invalid OKLCH color: ${value}`)
  }

  const lightness = Number.parseFloat(match[1]) / 100
  const chroma = Number.parseFloat(match[2])
  const hueRadians = (Number.parseFloat(match[3]) * Math.PI) / 180
  const a = chroma * Math.cos(hueRadians)
  const b = chroma * Math.sin(hueRadians)

  const l = lightness + 0.3963377774 * a + 0.2158037573 * b
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b
  const s = lightness - 0.0894841775 * a - 1.291485548 * b
  const lCube = l ** 3
  const mCube = m ** 3
  const sCube = s ** 3

  return {
    r: linearChannelToRgb(
      +4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube
    ),
    g: linearChannelToRgb(
      -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube
    ),
    b: linearChannelToRgb(
      -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube
    ),
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`
}

function toHexChannel(value: number): string {
  return Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")
}

function linearChannelToRgb(value: number): number {
  const clipped = Math.min(1, Math.max(0, value))
  const gammaCorrected =
    clipped <= 0.0031308
      ? 12.92 * clipped
      : 1.055 * clipped ** (1 / 2.4) - 0.055

  return Math.round(gammaCorrected * 255)
}

function getContrastRatio(colorA: string, colorB: string): number {
  const luminanceA = getRelativeLuminance(colorA)
  const luminanceB = getRelativeLuminance(colorB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + 0.05) / (darker + 0.05)
}

function getRelativeLuminance(color: string): number {
  const { r, g, b } = parseCssColor(color)

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

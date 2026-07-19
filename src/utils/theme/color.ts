export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseCssColor(value: string): Rgb {
  if (value.startsWith("#")) {
    return hexToRgb(value)
  }

  if (value.startsWith("oklch(")) {
    return oklchToRgb(value)
  }

  throw new Error(`Unsupported color format: ${value}`)
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex)
  const value = Number.parseInt(normalized.slice(1), 16)

  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`
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

export function getContrastRatio(colorA: string, colorB: string): number {
  const luminanceA = getRelativeLuminance(colorA)
  const luminanceB = getRelativeLuminance(colorB)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + 0.05) / (darker + 0.05)
}

export function getRelativeLuminance(color: string): number {
  const { r, g, b } = parseCssColor(color)

  return (
    0.2126 * channelToLinear(r / 255) +
    0.7152 * channelToLinear(g / 255) +
    0.0722 * channelToLinear(b / 255)
  )
}

function normalizeHex(value: string): string {
  const normalized = value.toLowerCase()

  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
  }

  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized
  }

  throw new Error(`Invalid hex color: ${value}`)
}

function oklchToRgb(value: string): Rgb {
  // CSS Color 4 `none` (e.g. Tailwind's achromatic `oklch(87% 0 none)`)
  // computes as 0 in color math.
  const match =
    /^oklch\(([\d.]+)%\s+([\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*[\d.]+)?\)$/.exec(
      value.replaceAll("none", "0")
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

function channelToLinear(value: number): number {
  if (value <= 0.04045) return value / 12.92
  return ((value + 0.055) / 1.055) ** 2.4
}

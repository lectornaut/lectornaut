/**
 * Shared translation of a Shiki token's color + font-style bitmask into an
 * inline CSS string. Used by BOTH editable code surfaces — the Tiptap
 * code-block decorations and the CodeMirror highlight plugin — so a token
 * renders identically whichever editor it lands in.
 */

// Shiki's FontStyle bitmask (the enum is a const-enum, erased at runtime).
export const FONT_STYLE_ITALIC = 1
export const FONT_STYLE_BOLD = 2
export const FONT_STYLE_UNDERLINE = 4

/** Build the inline `style` string for one Shiki token (empty when no color). */
export const tokenStyleToCss = (
  color: string | undefined,
  fontStyle: number
): string => {
  let style = color ? `color: ${color};` : ""
  if (fontStyle & FONT_STYLE_ITALIC) style += "font-style: italic;"
  if (fontStyle & FONT_STYLE_BOLD) style += "font-weight: 600;"
  if (fontStyle & FONT_STYLE_UNDERLINE) style += "text-decoration: underline;"
  return style
}

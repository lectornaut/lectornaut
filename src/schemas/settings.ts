import { z } from "zod"

/**
 * Settings doc schemas — mirror `src/types/settings.ts`.
 *
 * Theme-related literal unions (`ThemeId`, `BaseId`, `AccentId`, `FontId`,
 * `SizeId`, `LanguageId`) are declared in `src/helpers/defaults.ts` as
 * derivations from `as const` arrays. We deliberately DO NOT import them
 * here because `defaults.ts` pulls in the entire `@/data/icons` graph, and
 * making `src/schemas` depend on that is a heavy transitive cost.
 *
 * The literal values below are copied verbatim. Keep in sync with the
 * arrays in `src/helpers/defaults.ts`. A drift check could be added as a
 * build step later if this becomes a recurring issue.
 */

const themeModeSchema = z.enum(["auto", "light", "dark"])

const accentIdSchema = z.enum([
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
  "base",
  "custom",
])

const baseIdSchema = z.enum([
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "taupe",
  "mauve",
  "mist",
  "olive",
  "accent",
  "custom",
])

const fontIdSchema = z.enum(["sans", "serif", "mono"])

const sizeIdSchema = z.enum(["xs", "sm", "base", "lg", "xl"])

const languageIdSchema = z.enum(["en-US", "ja-JP"])

const editorThemeIdSchema = z.enum([
  "default",
  "ayu",
  "catppuccin",
  "everforest",
  "github",
  "gruvbox",
  "kanagawa",
  "material",
  "min",
  "night-owl",
  "one",
  "rose-pine",
  "slack",
  "solarized",
  "vitesse",
])

const editorFontSizeIdSchema = z.enum(["xs", "sm", "base", "lg", "xl"])

export const settingsThemeDocSchema = z.object({
  mode: themeModeSchema.optional(),
  base: baseIdSchema.optional(),
  accent: accentIdSchema.optional(),
  customBaseColor: z.string().optional(),
  customAccentColor: z.string().optional(),
  font: fontIdSchema.optional(),
  size: sizeIdSchema.optional(),
  language: languageIdSchema.optional(),
  editorTheme: editorThemeIdSchema.optional(),
  editorFontSize: editorFontSizeIdSchema.optional(),
})

/**
 * Map of shortcut-id → key-binding overrides, persisted in localStorage by
 * `src/modules/hotkeys.ts`. PR 5 will swap the unvalidated `JSON.parse` there
 * for a `parseSafe` call against this schema.
 */
export const shortcutOverridesSchema = z.record(z.string(), z.string())

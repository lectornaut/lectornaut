import { ACCENT_IDS, BASE_IDS } from "@/utils/theme/families"
import { z } from "zod"

/**
 * Settings doc schemas — mirror `src/types/settings.ts`.
 *
 * The base/accent family id lists come straight from `@/utils/theme/families`
 * — the single module that declares the palette set — so the picker, the CSS
 * generator, and this schema can't drift. That leaf is dependency-free (no
 * `@/data/icons` graph), which is why importing it here is cheap, unlike
 * importing `@/helpers/defaults`.
 *
 * The remaining small literal unions (`ThemeId`, `FontId`, `SizeId`,
 * `LanguageId`, editor theme/size) are still inlined below; keep those in
 * sync with `src/helpers/defaults.ts`.
 */

const themeModeSchema = z.enum(["auto", "light", "dark"])

const accentIdSchema = z.enum(ACCENT_IDS)

const baseIdSchema = z.enum(BASE_IDS)

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
  translucentSidebar: z.boolean().optional(),
  reducedMotion: z.boolean().optional(),
})

/**
 * Map of shortcut-id → key-binding override. Persisted in localStorage and
 * synced to Firestore by the settings store, then read reactively by
 * `useGlobalHotkeys` to (re)register the global hotkeys.
 */
export const shortcutOverridesSchema = z.record(z.string(), z.string())

/**
 * The `users/{uid}/settings/shortcuts` doc. Written as a FULL replace
 * (`merge: false`) by `shortcutsStore` so override deletions (per-row reset /
 * reset-all) propagate — a set+merge deep-merges the map and can never remove
 * keys. The server enforces the same contract in
 * functions/src/syncSettlement.ts (`validateUserShortcutsPayload`).
 */
export const settingsShortcutsDocSchema = z.object({
  overrides: shortcutOverridesSchema,
})

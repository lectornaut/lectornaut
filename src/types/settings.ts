import type { ThemeId } from "@/helpers/defaults"
import type { settingsThemeDocSchema } from "@/schemas/settings"
import type { z } from "zod"

/**
 * Settings doc type aliases — re-exported from `src/schemas/settings.ts`.
 *
 * `ThemeMode` is kept as an alias for `ThemeId` from `src/helpers/defaults`
 * because several call sites import `ThemeMode` directly. The underlying
 * literal union is the same in both places — see the "keep in sync" comment
 * in `src/schemas/settings.ts`.
 */

export type ThemeMode = ThemeId

export type SettingsThemeDoc = z.infer<typeof settingsThemeDocSchema>

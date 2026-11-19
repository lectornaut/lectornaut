import type { settingsThemeDocSchema } from "@/schemas/settings"
import type { z } from "zod"

/**
 * Settings doc type aliases — re-exported from `src/schemas/settings.ts`.
 */

export type SettingsThemeDoc = z.infer<typeof settingsThemeDocSchema>

export type ChatWindowMode = NonNullable<SettingsThemeDoc["chatWindowMode"]>

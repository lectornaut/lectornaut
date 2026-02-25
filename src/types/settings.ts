import type {
  AccentId,
  BaseId,
  FontId,
  LanguageId,
  SizeId,
  ThemeId,
} from "@/helpers/defaults"

export type ThemeMode = ThemeId

export interface SettingsThemeDoc {
  mode?: ThemeMode
  base?: BaseId
  accent?: AccentId
  font?: FontId
  size?: SizeId
  language?: LanguageId
}

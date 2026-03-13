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
  customBaseColor?: string
  customAccentColor?: string
  font?: FontId
  size?: SizeId
  language?: LanguageId
}

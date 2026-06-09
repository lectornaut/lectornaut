import type { LanguageId } from "@/helpers/defaults"
import { defaultLanguage } from "@/helpers/defaults"
import { useThemeStore } from "@/stores/themeStore"
import messages from "@intlify/unplugin-vue-i18n/messages"
import { storeToRefs } from "pinia"
import { createI18n } from "vue-i18n"

/**
 * Internationalization Configuration
 * Sets up Vue I18n with default language and lazy-loaded messages
 */
export const i18n = createI18n({
  legacy: false,
  locale: defaultLanguage,
  fallbackLocale: defaultLanguage,
  messages,
})

export const initLanguage = () => {
  const themeStore = useThemeStore()
  const { themeSettings } = storeToRefs(themeStore)

  watch(
    () => themeSettings.value.language,
    (newLang) => {
      if (typeof newLang === "string" && i18n.global.locale.value !== newLang) {
        i18n.global.locale.value = newLang
      }
    },
    { immediate: true }
  )

  watch(i18n.global.locale, (newLang) => {
    if (
      typeof newLang === "string" &&
      themeSettings.value.language !== newLang
    ) {
      themeSettings.value.language = newLang as LanguageId
    }
  })
}

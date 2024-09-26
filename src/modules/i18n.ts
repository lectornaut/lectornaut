import { defaultLanguage } from "@/helpers/defaults"
import messages from "@intlify/unplugin-vue-i18n/messages"
import { createI18n } from "vue-i18n"

const locale = useStorage("locale", defaultLanguage)

export const i18n = createI18n({
  legacy: false,
  locale: locale.value,
  fallbackLocale: defaultLanguage,
  messages,
})

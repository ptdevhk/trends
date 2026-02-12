import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhHant from './locales/zh-Hant.json'
import zhHans from './locales/zh-Hans.json'
import en from './locales/en.json'

const resources = {
  'zh-Hant': { translation: zhHant },
  'zh-Hans': { translation: zhHans },
  'zh-TW': { translation: zhHant },
  'zh-HK': { translation: zhHant },
  'zh-CN': { translation: zhHans },
  'zh': { translation: zhHans },
  en: { translation: en },
}

const SUPPORTED_LOCALES = ['zh-Hans', 'zh-Hant', 'en']
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

function isSupportedLocale(locale: string | undefined): locale is SupportedLocale {
  return typeof locale === 'string' && SUPPORTED_LOCALES.includes(locale)
}

const envLocale = import.meta.env.VITE_DEFAULT_LOCALE
const defaultLocale: SupportedLocale = isSupportedLocale(envLocale) ? envLocale : 'zh-Hans'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: defaultLocale,
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
  })

export default i18n
